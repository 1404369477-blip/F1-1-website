import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat, statfs } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { gunzipSync } from "node:zlib";

import { HTTP_TIMEOUT_MS, MAX_HTTP_BYTES, PAGES_TIMEOUT_MS, PROCESS_TIMEOUT_MS, PUBLIC_PAGES_CURRENT_URL, PUBLIC_PAGES_HOME_URL, SAMPLE_TTL_MS, validatePublicHealthUrl, type SiteStatusConfig } from "./config.ts";
import type { PagesFeedVersion } from "./pages-contract.ts";
import type { BackupSample, DatabaseSample, SiteStatus } from "./types.ts";

export const SERVICE_LABELS = ["com.f1plus1.public-beta", "com.f1plus1.admin-service", "com.f1plus1.quick-tunnel"] as const;
export type ServiceLabel = typeof SERVICE_LABELS[number];
export type RuntimeReason =
  | "HTTP_TIMEOUT" | "HTTP_NETWORK_ERROR" | "HTTP_REDIRECT_REJECTED" | "HTTP_STATUS_UNEXPECTED" | "HTTP_BODY_TOO_LARGE" | "HTTP_HEALTH_INVALID" | "HTTP_STATIC_INVALID"
  | "PUBLIC_TARGET_IDENTITY_UNKNOWN" | "PROCESS_NOT_LOADED" | "PROCESS_NOT_RUNNING" | "PROCESS_READ_FAILED" | "PROCESS_TIMEOUT" | "PROCESS_OUTPUT_INVALID"
  | "STORAGE_READ_FAILED" | "STORAGE_CAPACITY_INVALID" | "STORAGE_LOW" | "STORAGE_CRITICAL" | "STORAGE_GROWTH_BASELINE_UNAVAILABLE";
export type EnvelopeReason = "CONFIG_INVALID" | "RUNTIME_VERSION_INVALID" | "ARGUMENTS_REJECTED" | "SAMPLER_FAILED" | "SAMPLER_TIMEOUT" | "SAMPLER_OUTPUT_LIMIT" | "SAMPLER_OUTPUT_INVALID" | "SAMPLE_EXPIRED" | "SAMPLE_CLOCK_INVALID";

export type HttpSample = Readonly<{
  status: SiteStatus; observedAt: string; reasons: readonly RuntimeReason[];
  probe: "local-public" | "public-https" | "admin-auth"; statusCode: number | null; durationMs: number;
  semantic: "public-real-snapshot" | "public-static-snapshot" | "authentication-required" | "loopback-perimeter-rejection" | null;
  authenticatedPrivateAccess: "unknown" | "not-applicable";
  targetKind?: "github-pages";
  staticSnapshot?: Readonly<{ bundleId: string; generatedAt: string; schemaVersion: PagesFeedVersion; visibleItems: number; syncFreshness: "unknown" }> | null;
}>;
export type ProcessSample = Readonly<{
  status: SiteStatus; observedAt: string; reasons: readonly RuntimeReason[];
  service: ServiceLabel; state: "running" | "not_running" | null; pid: number | null; startedAt: string | null;
}>;
export type StorageSample = Readonly<{
  status: SiteStatus; observedAt: string; reasons: readonly RuntimeReason[];
  capacityStatus: SiteStatus; availableBytes: number | null; totalBytes: number | null; filesystemRef: string | null;
  warningAvailableBytes: number; failedAvailableBytes: number;
  growth: Readonly<{ status: "unknown" | "observed"; availableBytesChangePerHour: number | null; baselineAt: string | null; baselineAvailableBytes: number | null; intervalMs: number | null; scope: "single-sample" | "in-memory-comparison" }>;
}>;
export type SiteStatusResult = Readonly<{
  schemaVersion: 1; status: SiteStatus; observedAt: string; expiresAt: string; reasons: readonly EnvelopeReason[];
  sampling: "separate-readonly-samples"; vantage: "runtime-host";
  components: Readonly<{
    database: DatabaseSample | null; backup: BackupSample | null;
    http: readonly HttpSample[] | null; processes: readonly ProcessSample[] | null; storage: StorageSample | null;
  }>;
}>;

export function combineStatus(statuses: readonly SiteStatus[]): SiteStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("unknown") || statuses.length === 0) return "unknown";
  return "healthy";
}

export function unknownSiteStatus(reason: EnvelopeReason, now = new Date()): SiteStatusResult {
  return {
    schemaVersion: 1, status: "unknown", observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + SAMPLE_TTL_MS).toISOString(),
    reasons: [reason], sampling: "separate-readonly-samples", vantage: "runtime-host",
    components: { database: null, backup: null, http: null, processes: null, storage: null },
  };
}

function publicHealth(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const runtime = body.runtime as Record<string, unknown> | null;
  return body.status === "ready" && body.reasonCode === "ok" && body.dataGate === "accepted-public-real-snapshot"
    && runtime !== null && typeof runtime === "object" && runtime.migration === "public-real-snapshot-v1" && runtime.seed === "signed-active-snapshot";
}

/** The probe ID selects its fixed GET target; request data is never accepted from MCP callers. */
export function sampleHttp(probe: HttpSample["probe"], config: SiteStatusConfig, tunnel?: ProcessSample): Promise<HttpSample> {
  if (probe === "public-https" && config.publicTarget.kind === "github-pages") return samplePagesHttp();
  const observedAt = new Date().toISOString();
  const begin = performance.now();
  const make = (status: SiteStatus, reason: RuntimeReason | null, statusCode: number | null, semantic: HttpSample["semantic"] = null): HttpSample => ({
    status, observedAt, reasons: reason ? [reason] : [], probe, statusCode, durationMs: Math.round(performance.now() - begin), semantic,
    authenticatedPrivateAccess: probe === "admin-auth" ? "unknown" : "not-applicable",
  });
  if (probe === "public-https" && config.publicTarget.kind !== "github-pages" && (!tunnel || tunnel.status !== "healthy" || tunnel.pid !== config.publicTarget.tunnelPid || tunnel.startedAt !== config.publicTarget.tunnelStartedAt)) {
    return Promise.resolve(make("unknown", "PUBLIC_TARGET_IDENTITY_UNKNOWN", null));
  }
  const url = probe === "admin-auth" ? "http://127.0.0.1:3101/api/admin/bilingual/reviews"
    : probe === "local-public" ? "http://127.0.0.1:3000/api/health" : validatePublicHealthUrl(config.publicTarget.url);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (sample: HttpSample): void => {
      if (!settled) {
        settled = true; clearTimeout(timer);
        resolve(performance.now() - begin >= HTTP_TIMEOUT_MS && sample.status === "healthy" ? make("failed", "HTTP_TIMEOUT", sample.statusCode) : sample);
      }
    };
    const request = (probe === "public-https" ? httpsRequest : httpRequest)(url, {
      method: "GET", agent: false, headers: { accept: "application/json", "cache-control": "no-cache", "accept-encoding": "identity" },
      maxHeaderSize: 16_384,
    }, (response) => {
      const code = response.statusCode ?? null;
      if (code !== null && code >= 300 && code < 400) {
        finish(make("failed", "HTTP_REDIRECT_REJECTED", code)); response.destroy(); return;
      }
      if (probe === "admin-auth" ? code !== 401 && code !== 404 : code !== 200) {
        finish(make("failed", "HTTP_STATUS_UNEXPECTED", code)); response.destroy(); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_HTTP_BYTES) { finish(make("failed", "HTTP_BODY_TOO_LARGE", code)); response.destroy(); return; }
        chunks.push(chunk);
      });
      response.on("error", () => finish(make("failed", "HTTP_NETWORK_ERROR", code)));
      response.on("end", () => {
        if (settled) return;
        try {
          if (!(response.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new Error("INVALID");
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (probe === "admin-auth") {
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID");
            const error = body as Record<string, unknown>;
            if (error.schemaVersion !== "admin-service-error-v1" || error.reasonCode !== (code === 404 ? "ADMIN_REQUEST_INVALID" : "ADMIN_SESSION_REQUIRED")) throw new Error("INVALID");
            finish(make("healthy", null, code, code === 404 ? "loopback-perimeter-rejection" : "authentication-required")); return;
          }
          if (!publicHealth(body)) throw new Error("INVALID");
          finish(make("healthy", null, code, "public-real-snapshot"));
        } catch { finish(make("failed", "HTTP_HEALTH_INVALID", code)); }
      });
    });
    timer = setTimeout(() => { finish(make("failed", "HTTP_TIMEOUT", null)); request.destroy(); }, HTTP_TIMEOUT_MS);
    request.on("error", () => finish(make("failed", "HTTP_NETWORK_ERROR", null)));
    request.end();
  });
}

class PagesProbeError extends Error {
  readonly reason: RuntimeReason;
  readonly statusCode: number | null;
  constructor(reason: RuntimeReason, statusCode: number | null = null) { super(reason); this.reason = reason; this.statusCode = statusCode; }
}

/** A fixed public origin, identity-bound paths and one deadline for the entire read chain. */
async function samplePagesHttp(): Promise<HttpSample> {
  const observedAt = new Date().toISOString();
  const begin = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGES_TIMEOUT_MS);
  let lastStatusCode: number | null = null;
  const base = { observedAt, probe: "public-https" as const, targetKind: "github-pages" as const, authenticatedPrivateAccess: "not-applicable" as const };
  const checkDeadline = (): void => {
    if (controller.signal.aborted || performance.now() - begin >= PAGES_TIMEOUT_MS) throw new PagesProbeError("HTTP_TIMEOUT");
  };
  const read = (url: string, maximum: number): Promise<Buffer> => {
    checkDeadline();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: PagesProbeError | null, bytes?: Buffer): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(bytes!);
      };
      const requestOptions: RequestOptions & { autoSelectFamilyAttemptTimeout: number } = {
        method: "GET", agent: false, signal: controller.signal, maxHeaderSize: 16_384,
        // Give a reachable address time to connect before trying the next family; the total deadline stays fixed.
        autoSelectFamilyAttemptTimeout: 1_000,
        headers: { accept: "application/json", "cache-control": "no-cache", "accept-encoding": "gzip" },
      };
      const request = httpsRequest(url, requestOptions, (response) => {
        const code = response.statusCode ?? null;
        lastStatusCode = code;
        const stop = (reason: RuntimeReason): void => { finish(new PagesProbeError(reason, code)); response.destroy(); request.destroy(); };
        if (code !== null && code >= 300 && code < 400) { stop("HTTP_REDIRECT_REJECTED"); return; }
        if (code !== 200) { stop("HTTP_STATUS_UNEXPECTED"); return; }
        if (!(response.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")
          || (response.headers["content-encoding"] !== undefined && response.headers["content-encoding"] !== "identity" && response.headers["content-encoding"] !== "gzip")) { stop("HTTP_STATIC_INVALID"); return; }
        if (Number(response.headers["content-length"]) > maximum) { stop("HTTP_BODY_TOO_LARGE"); return; }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) { stop("HTTP_BODY_TOO_LARGE"); return; }
          if (!settled) chunks.push(chunk);
        });
        response.on("error", () => finish(new PagesProbeError(controller.signal.aborted ? "HTTP_TIMEOUT" : "HTTP_NETWORK_ERROR", code)));
        response.on("end", () => {
          if (settled) return;
          try {
            const wire = Buffer.concat(chunks);
            // Both compressed input and decoded output use the resource's original byte cap.
            finish(null, response.headers["content-encoding"] === "gzip" ? gunzipSync(wire, { maxOutputLength: maximum }) : wire);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            finish(new PagesProbeError(code === "ERR_BUFFER_TOO_LARGE" ? "HTTP_BODY_TOO_LARGE" : "HTTP_STATIC_INVALID", response.statusCode ?? null));
          }
        });
      });
      request.on("error", () => finish(new PagesProbeError(controller.signal.aborted ? "HTTP_TIMEOUT" : "HTTP_NETWORK_ERROR")));
      request.end();
    });
  };
  const parse = (bytes: Buffer): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const verify = (bytes: Buffer, expected: string): void => {
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new PagesProbeError("HTTP_STATIC_INVALID", 200);
  };
  try {
    const { parsePagesIndex, parsePagesPointer, validatePagesFeed } = await import("./pages-contract.ts");
    // Cache bust only the pointer; generation files are immutable and are verified before use.
    const pointer = parsePagesPointer(parse(await read(`${PUBLIC_PAGES_CURRENT_URL}?read=${Date.now()}`, 4096)));
    const indexBytes = await read(`${PUBLIC_PAGES_HOME_URL}${pointer.indexPath}`, 16 * 1024 * 1024);
    verify(indexBytes, pointer.indexSha256);
    const index = parsePagesIndex(parse(indexBytes));
    if (index.generatedAt !== pointer.generatedAt) throw new PagesProbeError("HTTP_STATIC_INVALID", 200);
    const directory = pointer.indexPath.slice(0, -"index.json".length);
    let version: PagesFeedVersion = "public-read-bilingual-v2";
    const feed = async (key: string) => {
      const reference = index.responses[key];
      if (!reference) throw new PagesProbeError("HTTP_STATIC_INVALID", 200);
      const bytes = await read(`${PUBLIC_PAGES_HOME_URL}${directory}${reference.path}`, 2 * 1024 * 1024);
      verify(bytes, reference.sha256);
      const result = await validatePagesFeed(parse(bytes), reference.status, version);
      checkDeadline();
      return result;
    };
    let result = await feed("/api/public/feed?limit=12&v=2");
    if (result.fallback) { version = "public-read-v0.1"; result = await feed("/api/public/feed"); }
    checkDeadline();
    return { ...base, status: "healthy", reasons: [], statusCode: 200, durationMs: Math.round(performance.now() - begin), semantic: "public-static-snapshot",
      staticSnapshot: { bundleId: pointer.bundleId, generatedAt: pointer.generatedAt, schemaVersion: version, visibleItems: result.visibleItems, syncFreshness: "unknown" } };
  } catch (error) {
    const reason = controller.signal.aborted || performance.now() - begin >= PAGES_TIMEOUT_MS ? "HTTP_TIMEOUT" : error instanceof PagesProbeError ? error.reason : "HTTP_STATIC_INVALID";
    return { ...base, status: "failed", reasons: [reason], statusCode: error instanceof PagesProbeError ? error.statusCode : lastStatusCode,
      durationMs: Math.round(performance.now() - begin), semantic: null, staticSnapshot: null };
  } finally { clearTimeout(timer); controller.abort(); }
}

type CommandResult = Readonly<{ status: "ok" | "timeout" | "missing" | "error"; stdout: string }>;
export type ProcessReader = (kind: "launchctl" | "ps", argument: ServiceLabel | number) => Promise<CommandResult>;

export const readFixedProcess: ProcessReader = (kind, argument) => new Promise((resolve) => {
  // Both the executable and command verb are code constants. Numeric PIDs come only from launchctl output.
  if ((kind === "launchctl" && !SERVICE_LABELS.includes(argument as ServiceLabel)) || (kind === "ps" && (!Number.isSafeInteger(argument) || Number(argument) <= 0))) {
    resolve({ status: "error", stdout: "" }); return;
  }
  const executable = kind === "launchctl" ? "/bin/launchctl" : "/bin/ps";
  const args = kind === "launchctl" ? ["print", `gui/501/${argument}`] : ["-p", String(argument), "-o", "lstart="];
  execFile(executable, args, { timeout: PROCESS_TIMEOUT_MS, maxBuffer: MAX_HTTP_BYTES, encoding: "utf8", killSignal: "SIGKILL", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" } }, (error, stdout) => {
    resolve({ status: !error ? "ok" : error.killed ? "timeout" : typeof error.code === "number" ? "missing" : "error", stdout: error ? "" : stdout });
  });
});

export async function sampleProcess(service: ServiceLabel, read: ProcessReader = readFixedProcess): Promise<ProcessSample> {
  const observedAt = new Date().toISOString();
  const make = (status: SiteStatus, reason: RuntimeReason | null, state: ProcessSample["state"] = null, pid: number | null = null, startedAt: string | null = null): ProcessSample => ({ status, observedAt, reasons: reason ? [reason] : [], service, state, pid, startedAt });
  try {
    const result = await read("launchctl", service);
    if (result.status !== "ok") return make(result.status === "missing" ? "failed" : "unknown", result.status === "timeout" ? "PROCESS_TIMEOUT" : result.status === "missing" ? "PROCESS_NOT_LOADED" : "PROCESS_READ_FAILED");
    const states = [...result.stdout.matchAll(/^\tstate = ([^\r\n]+)$/gm)];
    const pids = [...result.stdout.matchAll(/^\tpid = (\d+)$/gm)];
    if (states.length !== 1) return make("unknown", "PROCESS_OUTPUT_INVALID");
    if (states[0][1] === "not running") return make("failed", "PROCESS_NOT_RUNNING", "not_running");
    if (states[0][1] !== "running" || pids.length !== 1) return make("unknown", "PROCESS_OUTPUT_INVALID");
    const pid = Number(pids[0][1]);
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647) return make("unknown", "PROCESS_OUTPUT_INVALID");
    const started = await read("ps", pid);
    if (started.status !== "ok") return make("unknown", started.status === "timeout" ? "PROCESS_TIMEOUT" : "PROCESS_READ_FAILED", "running", pid);
    const startedAt = started.stdout.trim();
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) \d{2}:\d{2}:\d{2} 20\d{2}$/.test(startedAt)) return make("unknown", "PROCESS_OUTPUT_INVALID", "running", pid);
    return make("healthy", null, "running", pid, startedAt);
  } catch { return make("unknown", "PROCESS_READ_FAILED"); }
}

export type CapacityReader = (path: string) => Promise<{ bsize: bigint; blocks: bigint; bavail: bigint; device: bigint }>;
async function readCapacity(path: string): ReturnType<CapacityReader> {
  const before = await stat(path, { bigint: true });
  const info = await statfs(path, { bigint: true });
  const after = await stat(path, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || !before.isDirectory() || !after.isDirectory()) throw new Error("STORAGE_IDENTITY_CHANGED");
  return { ...info, device: after.dev };
}
export async function sampleStorage(config: SiteStatusConfig["storage"], read: CapacityReader = readCapacity): Promise<StorageSample> {
  const observedAt = new Date().toISOString();
  const base = { observedAt, warningAvailableBytes: config.warningAvailableBytes, failedAvailableBytes: config.failedAvailableBytes,
    growth: { status: "unknown" as const, availableBytesChangePerHour: null, baselineAt: null, baselineAvailableBytes: null, intervalMs: null, scope: "single-sample" as const } };
  try {
    const info = await read(config.path);
    const total = info.blocks * info.bsize;
    const available = info.bavail * info.bsize;
    if (info.bsize <= BigInt(0) || total <= BigInt(0) || available < BigInt(0) || available > total || total > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ...base, status: "unknown", reasons: ["STORAGE_CAPACITY_INVALID", "STORAGE_GROWTH_BASELINE_UNAVAILABLE"], capacityStatus: "unknown", availableBytes: null, totalBytes: null, filesystemRef: null };
    }
    const availableBytes = Number(available);
    const capacityStatus = availableBytes < config.failedAvailableBytes ? "failed" : availableBytes < config.warningAvailableBytes ? "degraded" : "healthy";
    const reasons: RuntimeReason[] = ["STORAGE_GROWTH_BASELINE_UNAVAILABLE"];
    if (capacityStatus === "failed") reasons.unshift("STORAGE_CRITICAL");
    if (capacityStatus === "degraded") reasons.unshift("STORAGE_LOW");
    const filesystemRef = createHash("sha256").update(`${config.path}\0${info.device}`).digest("hex");
    return { ...base, status: combineStatus([capacityStatus, "unknown"]), reasons, capacityStatus, availableBytes, totalBytes: Number(total), filesystemRef };
  } catch {
    return { ...base, status: "unknown", reasons: ["STORAGE_READ_FAILED", "STORAGE_GROWTH_BASELINE_UNAVAILABLE"], capacityStatus: "unknown", availableBytes: null, totalBytes: null, filesystemRef: null };
  }
}

export function assembleSiteStatus(database: DatabaseSample, backup: BackupSample, http: readonly HttpSample[], processes: readonly ProcessSample[], storage: StorageSample, now = new Date()): SiteStatusResult {
  const observations = [database.observedAt, backup.observedAt, ...http.map((x) => x.observedAt), ...processes.map((x) => x.observedAt), storage.observedAt];
  if (observations.some((time) => !Number.isFinite(Date.parse(time)) || Date.parse(time) > now.getTime() + 1_000)) return unknownSiteStatus("SAMPLE_CLOCK_INVALID", now);
  // The envelope uses the earliest observation so no old component receives a renewed lease.
  const observedMs = Math.min(...observations.map(Date.parse));
  if (now.getTime() - observedMs >= SAMPLE_TTL_MS) return unknownSiteStatus("SAMPLE_EXPIRED", now);
  return {
    schemaVersion: 1, status: combineStatus([database.status, backup.status, ...http.map((x) => x.status), ...processes.map((x) => x.status), storage.status]),
    observedAt: new Date(observedMs).toISOString(), expiresAt: new Date(observedMs + SAMPLE_TTL_MS).toISOString(), reasons: [],
    sampling: "separate-readonly-samples", vantage: "runtime-host", components: { database, backup, http, processes, storage },
  };
}
