import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  assertAutoAutomationZeroVector,
  collectAutoAutomationZeroVector,
  type AutoProcessIdentityAllowlistEntry,
  type AutoAutomationZeroVector,
  type AutoZeroScheduleInventory,
  type AutoZeroRuntimeScheduleObservation,
  type ReviewDatabaseIdentity
} from "../src/server/quick-launch/auto-zero-vector.ts";

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`QUICK_LAUNCH_AUTO_ZERO_INPUT_INVALID:${path}:${error instanceof Error ? error.message : "UNKNOWN"}`);
  }
}

function requiredString(values: Record<string, string | undefined>, name: string): string {
  const value = values[name];
  if (value === undefined || value.length === 0) fail(`QUICK_LAUNCH_AUTO_ZERO_ARG_MISSING:${name}`);
  return value;
}

function main(): AutoAutomationZeroVector {
  const parsed = parseArgs({
    options: {
      "release-root": { type: "string" },
      "release-path": { type: "string", multiple: true },
      database: { type: "string" },
      cutover: { type: "string" },
      observed: { type: "string" },
      "release-sha": { type: "string" },
      "manifest-sha": { type: "string" },
      "process-set-sha": { type: "string" },
      "schedule-set-sha": { type: "string" },
      "process-allowlist": { type: "string" },
      "target-uid": { type: "string" },
      "runtime-observation": { type: "string" },
      "schedule-inventory": { type: "string" },
      "expected-db-identity": { type: "string" }
    },
    allowPositionals: false,
    strict: true
  });
  const values = parsed.values as Record<string, string | string[] | undefined>;
  const scalar = (name: string): string => {
    const value = values[name];
    return requiredString({ [name]: typeof value === "string" ? value : undefined }, name);
  };
  const processPath = scalar("process-allowlist");
  const runtimePath = scalar("runtime-observation");
  const scheduleInventoryPath = scalar("schedule-inventory");
  const processIdentityAllowlist = readJson<readonly AutoProcessIdentityAllowlistEntry[]>(processPath);
  const runtimeScheduleObservation = readJson<AutoZeroRuntimeScheduleObservation>(runtimePath);
  const scheduleInventory = readJson<AutoZeroScheduleInventory>(scheduleInventoryPath);
  const expectedReviewDatabaseIdentity = readJson<ReviewDatabaseIdentity>(scalar("expected-db-identity"));
  const releasePaths = values["release-path"];
  const vector = collectAutoAutomationZeroVector({
    releaseRoot: scalar("release-root"),
    releasePaths: Array.isArray(releasePaths) ? releasePaths : undefined,
    quickLaunchCutoverAt: scalar("cutover"),
    observedAt: scalar("observed"),
    releaseSha256: scalar("release-sha"),
    manifestSha256: scalar("manifest-sha"),
    autoProcessIdentitySetSha256: scalar("process-set-sha"),
    scheduleInventorySha256: scalar("schedule-set-sha"),
    targetUid: Number(scalar("target-uid")),
    reviewDatabasePath: scalar("database"),
    expectedReviewDatabaseIdentity,
    processIdentityAllowlist,
    scheduleInventory,
    runtimeScheduleObservation
  });
  assertAutoAutomationZeroVector(vector);
  return vector;
}

try {
  const vector = main();
  process.stdout.write(`${JSON.stringify(vector, null, 2)}\n`);
  if (vector.state !== "pass") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "QUICK_LAUNCH_AUTO_ZERO_FAILED"}\n`);
  process.exitCode = 1;
}
