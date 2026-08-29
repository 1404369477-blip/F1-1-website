import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import {
  assertAutoAutomationZeroVector,
  autoProcessIdentitySetSha256,
  collectAutoAutomationZeroVector,
  readAutoZeroMigrationManifest,
  scheduleInventorySha256,
  type AutoProcessIdentityAllowlistEntry,
  type AutoZeroMigrationManifest,
  type AutoZeroScheduleInventory,
  type ReviewDatabaseIdentity
} from "../src/server/quick-launch/auto-zero-vector.ts";
import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";

const OBSERVER_SCHEMA = "quick-launch-auto-zero-process-observer-v1" as const;
const CONFIG_SCHEMA = "quick-launch-auto-zero-process-observer-config-v1" as const;
const MINIMUM_WINDOW_MS = 61_000;
const PLANNED_WINDOW_MS = 62_000;
const HASH = /^[0-9a-f]{64}$/u;

type ObserverConfig = Readonly<{
  schemaVersion: typeof CONFIG_SCHEMA;
  migrationManifestPath: string;
  releaseRoot: string;
  releasePaths: readonly string[];
  releaseSha256: string;
  manifestSha256: string;
  processIdentityAllowlist: readonly AutoProcessIdentityAllowlistEntry[];
  targetUid: number;
  reviewDatabasePath: string;
  expectedReviewDatabaseIdentity: ReviewDatabaseIdentity;
  quickLaunchCutoverAt: string;
  scheduleInventoryTemplate: Omit<AutoZeroScheduleInventory, "asOf">;
  expectedProcessSetSha256: string;
  plannedObservationMs: number;
}>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string): never {
  throw new Error(message);
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    fail(`AUTO_ZERO_OBSERVER_CONFIG_INVALID:${error instanceof Error ? error.message : "JSON"}`);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function assertMigrationManifestBound(config: ObserverConfig): AutoZeroMigrationManifest {
  const manifest = readAutoZeroMigrationManifest(resolve(config.migrationManifestPath));
  for (const entry of manifest.migrationInputs) {
    const bytes = readFileSync(resolve(config.releaseRoot, entry.path));
    if (sha256(bytes) !== entry.sha256) fail(`AUTO_ZERO_MIGRATION_INPUT_DRIFT:${entry.path}`);
  }
  return manifest;
}

function assertReleaseClosureBound(config: ObserverConfig): void {
  const root = resolve(config.releaseRoot);
  const entries = config.releasePaths.map((path) => {
    const absolute = resolve(root, path);
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) fail("AUTO_ZERO_RELEASE_PATH_OUTSIDE_ROOT");
    return { path: relativePath, sha256: sha256(readFileSync(absolute)) };
  });
  if (sha256(canonicalJsonV1(entries)) !== config.releaseSha256) fail("AUTO_ZERO_RELEASE_CLOSURE_DRIFT");
}

function parseConfig(path: string): ObserverConfig {
  if (!path.startsWith("/")) fail("AUTO_ZERO_OBSERVER_CONFIG_PATH_INVALID");
  const config = readJson<ObserverConfig>(path);
  if (config.schemaVersion !== CONFIG_SCHEMA) fail("AUTO_ZERO_OBSERVER_CONFIG_SCHEMA_INVALID");
  if (!Number.isSafeInteger(config.plannedObservationMs) || config.plannedObservationMs !== PLANNED_WINDOW_MS) fail("AUTO_ZERO_OBSERVER_WINDOW_PLAN_INVALID");
  if (!HASH.test(config.releaseSha256) || !HASH.test(config.manifestSha256) || !HASH.test(config.expectedProcessSetSha256)) fail("AUTO_ZERO_OBSERVER_HASH_INVALID");
  if (!Array.isArray(config.releasePaths) || config.releasePaths.length === 0) fail("AUTO_ZERO_OBSERVER_RELEASE_PATHS_INVALID");
  if (!Number.isSafeInteger(config.targetUid) || config.targetUid < 0) fail("AUTO_ZERO_OBSERVER_UID_INVALID");
  assertReleaseClosureBound(config);
  assertMigrationManifestBound(config);
  const computedProcessSet = autoProcessIdentitySetSha256(config.processIdentityAllowlist);
  if (computedProcessSet !== config.expectedProcessSetSha256) fail("AUTO_ZERO_OBSERVER_PROCESS_SET_DRIFT");
  return config;
}

function main(configPath: string): Promise<Readonly<Record<string, unknown>>> {
  const config = parseConfig(configPath);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  return sleep(config.plannedObservationMs).then(() => {
    const observedMs = Date.now();
    const observedAt = new Date(observedMs).toISOString();
    const durationMs = observedMs - startedMs;
    const template = config.scheduleInventoryTemplate;
    const scheduleInventory: AutoZeroScheduleInventory = {
      schemaVersion: template.schemaVersion,
      asOf: observedAt,
      releaseClosureSha256: config.releaseSha256,
      inspectedEntryCount: template.inspectedEntryCount,
      scope: template.scope,
      findings: template.findings,
      complete: template.complete
    };
    const scheduleHash = scheduleInventorySha256(scheduleInventory);
    const runtimeScheduleObservation = {
      observedAt,
      durationMs,
      registeredSchedules: [],
      registrySealed: true,
      runtimeError: null
    } as const;
    const vector = collectAutoAutomationZeroVector({
      releaseRoot: config.releaseRoot,
      releasePaths: config.releasePaths,
      quickLaunchCutoverAt: config.quickLaunchCutoverAt,
      observedAt,
      releaseSha256: config.releaseSha256,
      manifestSha256: config.manifestSha256,
      autoProcessIdentitySetSha256: config.expectedProcessSetSha256,
      scheduleInventorySha256: scheduleHash,
      targetUid: config.targetUid,
      reviewDatabasePath: config.reviewDatabasePath,
      expectedReviewDatabaseIdentity: config.expectedReviewDatabaseIdentity,
      processIdentityAllowlist: config.processIdentityAllowlist,
      scheduleInventory,
      runtimeScheduleObservation
    });
    assertAutoAutomationZeroVector(vector);
    const migrationManifestBytes = readFileSync(resolve(config.migrationManifestPath));
    return Object.freeze({
      schemaVersion: OBSERVER_SCHEMA,
      startedAt,
      observedAt,
      durationMs,
      plannedObservationMs: config.plannedObservationMs,
      minimumObservationMs: MINIMUM_WINDOW_MS,
      migrationManifestPath: resolve(config.migrationManifestPath),
      migrationManifestSha256: sha256(migrationManifestBytes),
      scheduleInventorySha256: scheduleHash,
      runtimeScheduleObservation,
      vector,
      state: durationMs >= MINIMUM_WINDOW_MS && durationMs >= config.plannedObservationMs && vector.state === "pass" ? "pass" : "fail"
    });
  });
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--config" || !args[1]?.startsWith("/")) {
  process.stderr.write("AUTO_ZERO_OBSERVER_ARGUMENTS_INVALID\n");
  process.exitCode = 1;
} else {
  try {
    const output = await main(args[1]);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.state !== "pass") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "AUTO_ZERO_OBSERVER_FAILED"}\n`);
    process.exitCode = 1;
  }
}
