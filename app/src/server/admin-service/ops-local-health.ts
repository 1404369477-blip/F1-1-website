import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const OPS_LOCAL_HEALTH_SCHEMA = "admin-ops-local-health-v1" as const;
export const OPS_LOCAL_HEALTH_PATH = "/api/admin/ops/health" as const;
export const DEFAULT_OPS_ROOT = "/Users/chanai/F1-1-website/ops" as const;
export const FULL_OPS_UI_URL = "http://127.0.0.1:8764/" as const;

const MAX_STATUS_BYTES = 512 * 1024;
const SECRET_KEY = /^(?:.*(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key).*)$/iu;

export type OpsLocalHealth = Readonly<{
  schemaVersion: typeof OPS_LOCAL_HEALTH_SCHEMA;
  generatedAt: string;
  opsRoot: string;
  fullOpsUi: typeof FULL_OPS_UI_URL;
  note: string;
  dashboard: Readonly<Record<string, unknown>> | null;
  admin: Readonly<Record<string, unknown>> | null;
  errors: readonly string[];
}>;

function resolveOpsRoot(override?: string): string {
  const raw = typeof override === "string" && override.trim() !== ""
    ? override.trim()
    : (typeof process.env.F1PLUS1_OPS_ROOT === "string" && process.env.F1PLUS1_OPS_ROOT.trim() !== ""
      ? process.env.F1PLUS1_OPS_ROOT.trim()
      : DEFAULT_OPS_ROOT);
  return resolve(raw);
}

function readJsonObject(path: string): Readonly<Record<string, unknown>> {
  if (!existsSync(path)) throw new Error(`missing:${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`unsafe:${path}`);
  if (stat.size < 2 || stat.size > MAX_STATUS_BYTES) throw new Error(`size:${path}`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`shape:${path}`);
  return parsed as Readonly<Record<string, unknown>>;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown, limit = 20): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .filter((item): item is string => typeof item === "string")
      .slice(0, limit)
      .map((item) => item.slice(0, 200))
  );
}

function pickLaunchAgents(value: unknown): Readonly<Record<string, unknown>> {
  const agents = asRecord(value);
  if (agents === null) return Object.freeze({});
  const out: Record<string, unknown> = {};
  for (const [label, info] of Object.entries(agents)) {
    const row = asRecord(info);
    if (row === null) continue;
    out[label] = Object.freeze({
      loaded: asBoolean(row.loaded),
      state: asString(row.state),
      lastExitCode: row.last_exit_code === null || typeof row.last_exit_code === "number" ? row.last_exit_code : null,
      runs: asNumber(row.runs),
      plistExists: asBoolean(row.plist_exists)
    });
  }
  return Object.freeze(out);
}

function sanitizeDashboard(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const publicInfo = asRecord(raw.public) ?? {};
  const lastCycle = asRecord(raw.lastCycle) ?? {};
  const refined = asRecord(lastCycle.refined) ?? {};
  const site = asRecord(lastCycle.site) ?? {};
  const sources = asRecord(lastCycle.sources) ?? {};
  const rsshub = asRecord(raw.rsshub) ?? {};
  const counts = asRecord(raw.counts) ?? {};
  return Object.freeze({
    generatedAt: asString(raw.generatedAt),
    overall: asString(raw.overall),
    public: Object.freeze({
      ok: asBoolean(publicInfo.ok),
      lagHours: asNumber(publicInfo.lagHours),
      stale: asBoolean(publicInfo.stale),
      level: asString(publicInfo.level),
      httpCode: asNumber(publicInfo.httpCode)
    }),
    lastCycle: Object.freeze({
      ok: asBoolean(lastCycle.ok),
      finishedAt: asString(lastCycle.finishedAt),
      ageMinutes: asNumber(lastCycle.ageMinutes),
      stale: asBoolean(lastCycle.stale),
      level: asString(lastCycle.level),
      refined: Object.freeze({
        ready: asNumber(refined.ready),
        failed: asNumber(refined.failed),
        skipped: asNumber(refined.skipped)
      }),
      site: Object.freeze({
        published: asBoolean(site.published),
        reason: asString(site.reason),
        items: asNumber(site.items)
      }),
      sources: Object.freeze({
        ok: asNumber(sources.ok),
        failedCount: asNumber(sources.failedCount)
      })
    }),
    launchAgents: pickLaunchAgents(raw.launchAgents),
    rsshub: Object.freeze({
      ok: asBoolean(rsshub.ok),
      httpCode: asNumber(rsshub.httpCode),
      level: asString(rsshub.level)
    }),
    counts: Object.freeze({
      pending: asNumber(counts.pending),
      ready: asNumber(counts.ready),
      held: asNumber(counts.held),
      skipped: asNumber(counts.skipped),
      failed: asNumber(counts.failed)
    }),
    alerts: asStringArray(raw.alerts),
    warns: asStringArray(raw.warns),
    infos: asStringArray(raw.infos)
  });
}

function sanitizeAdmin(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const countsStore = asRecord(raw.countsStore) ?? {};
  const lastCycle = asRecord(raw.lastCycle) ?? {};
  const refined = asRecord(lastCycle.refined) ?? {};
  const site = asRecord(lastCycle.site) ?? {};
  return Object.freeze({
    generatedAt: asString(raw.generatedAt),
    overall: asString(raw.overall),
    mode: asString(raw.mode),
    countsStore: Object.freeze({
      pending: asNumber(countsStore.pending),
      ready: asNumber(countsStore.ready),
      skipped: asNumber(countsStore.skipped),
      failed: asNumber(countsStore.failed),
      total: asNumber(countsStore.total)
    }),
    lastCycle: Object.freeze({
      finishedAt: asString(lastCycle.finishedAt),
      refined: Object.freeze({
        ready: asNumber(refined.ready),
        failed: asNumber(refined.failed),
        skipped: asNumber(refined.skipped)
      }),
      site: Object.freeze({
        published: asBoolean(site.published),
        reason: asString(site.reason)
      })
    }),
    alerts: asStringArray(raw.alerts),
    warns: asStringArray(raw.warns),
    infos: asStringArray(raw.infos),
    notes: asStringArray(raw.notes, 8)
  });
}

/** Drop accidental secret-looking keys from a JSON tree (defense in depth). */
export function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = stripSecretKeys(child);
  }
  return out;
}

export function readOpsLocalHealth(opsRootOverride?: string): OpsLocalHealth {
  const opsRoot = resolveOpsRoot(opsRootOverride);
  const errors: string[] = [];
  let dashboard: Readonly<Record<string, unknown>> | null = null;
  let admin: Readonly<Record<string, unknown>> | null = null;

  try {
    dashboard = sanitizeDashboard(readJsonObject(join(opsRoot, "dashboard", "status.json")));
  } catch (error) {
    errors.push(`dashboard:${error instanceof Error ? error.message : "read_failed"}`);
  }

  try {
    admin = sanitizeAdmin(readJsonObject(join(opsRoot, "admin", "status.json")));
  } catch (error) {
    errors.push(`admin:${error instanceof Error ? error.message : "read_failed"}`);
  }

  return Object.freeze({
    schemaVersion: OPS_LOCAL_HEALTH_SCHEMA,
    generatedAt: new Date().toISOString(),
    opsRoot,
    fullOpsUi: FULL_OPS_UI_URL,
    note: "只读摘要。完整交互运维 UI 仅本机 http://127.0.0.1:8764/（勿 iframe / 勿反代写端口）。",
    dashboard: dashboard === null ? null : (stripSecretKeys(dashboard) as Readonly<Record<string, unknown>>),
    admin: admin === null ? null : (stripSecretKeys(admin) as Readonly<Record<string, unknown>>),
    errors: Object.freeze(errors)
  });
}
