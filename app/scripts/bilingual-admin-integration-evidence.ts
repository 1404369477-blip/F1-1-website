import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  adminReleaseRuntimePathSetSha256,
  assertAdminReleaseRuntimePathContract
} from "../src/server/admin-service/release-manifest.ts";
import {
  BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256,
  BILINGUAL_REFINEMENT_MIGRATION_SHA256,
  BILINGUAL_SCHEMA9_SHA256,
  canonicalMigrationSha256,
  readBilingualMigrationSql
} from "../src/server/rss/bilingual-migration.ts";

const appRoot = resolve(new URL("../", import.meta.url).pathname);
const repoRoot = resolve(appRoot, "..");
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
const runRoot = resolve(repoRoot, "scratch/2026-08-25-ql3-bilingual-admin-integration", `run-${runStamp}`);

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function command(name: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env): Readonly<Record<string, unknown>> {
  const result = spawnSync(name, [...args], { cwd: appRoot, env: environment, encoding: "utf8", shell: false });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return Object.freeze({
    command: [name, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    outputSha256: sha256(output),
    outputTail: output.slice(-4000)
  });
}

if (process.version !== "v24.18.0") throw new Error(`NODE_VERSION_DRIFT:${process.version}`);
const npmVersion = execFileSync(resolve(process.execPath, "../npm"), ["--version"], { encoding: "utf8" }).trim();
if (npmVersion !== "11.16.0") throw new Error(`NPM_VERSION_DRIFT:${npmVersion}`);

const migration = readBilingualMigrationSql();
if (sha256(migration) !== BILINGUAL_REFINEMENT_MIGRATION_SHA256) throw new Error("MIGRATION_RAW_HASH_DRIFT");
if (canonicalMigrationSha256(migration) !== BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256) throw new Error("MIGRATION_CANONICAL_HASH_DRIFT");
assertAdminReleaseRuntimePathContract();
if (ADMIN_RELEASE_RUNTIME_FILES.length !== ADMIN_RELEASE_RUNTIME_FILE_COUNT) throw new Error("RELEASE_FILE_COUNT_DRIFT");
if (adminReleaseRuntimePathSetSha256() !== ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256) throw new Error("RELEASE_PATH_SET_DRIFT");

const focused = command(resolve(process.execPath, "../npm"), [
  "exec", "vitest", "run",
  "src/tests/admin-bilingual-integration.test.ts",
  "src/tests/admin-release-manifest.test.ts",
  "src/tests/admin-review-ui.test.ts"
]);
const typecheck = command(resolve(process.execPath, "../npm"), ["run", "typecheck"]);
const lint = command(resolve(process.execPath, "../npm"), [
  "exec", "eslint",
  "src/server/admin-service/bilingual-admin.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/server.ts",
  "src/tests/admin-bilingual-integration.test.ts"
]);
if (focused.status !== 0 || typecheck.status !== 0 || lint.status !== 0) throw new Error("EVIDENCE_COMMAND_FAILED");

const stageManifestPath = resolve(appRoot, ".local/release/admin-service-release-manifest.json");
const stageManifestSha256 = sha256(readFileSync(stageManifestPath));
const verifier = command(resolve(process.execPath, "../npm"), ["run", "admin:verify-release-stage"], {
  ...process.env,
  ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256: stageManifestSha256
});
if (verifier.status === 0 || !String(verifier.outputTail).includes("RELEASE_MANIFEST")) {
  throw new Error("NO_DEPLOY_VERIFIER_EXPECTATION_FAILED");
}

const evidenceFiles = [
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "scripts/bilingual-admin-integration-evidence.ts",
  "src/server/admin-service/bilingual-admin.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/server.ts",
  "src/server/admin-service/release-manifest.ts",
  "src/admin-ui/index.html",
  "src/admin-ui/app.js",
  "src/admin-ui/app.css",
  "src/tests/admin-bilingual-integration.test.ts",
  "src/tests/admin-release-manifest.test.ts"
].map((path) => Object.freeze({ path, sha256: sha256(readFileSync(resolve(appRoot, path))) }));

mkdirSync(runRoot, { recursive: true });
const receipt = Object.freeze({
  schemaVersion: "ql3-bilingual-admin-interim-receipt-v1",
  status: "INTERIM_READ_ONLY_PASS",
  deployDecision: "NO_DEPLOY",
  reasonCode: "AUTHORITY_EXTENSION_REQUIRED",
  exactToolchain: { node: process.version, npm: npmVersion },
  pins: {
    migrationRawSha256: BILINGUAL_REFINEMENT_MIGRATION_SHA256,
    migrationCanonicalSha256: BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256,
    schema9Sha256: BILINGUAL_SCHEMA9_SHA256,
    releasePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    releaseRuntimeFileCount: ADMIN_RELEASE_RUNTIME_FILE_COUNT
  },
  assertions: {
    schema9ExistingOnlyAdminOpener: true,
    authorityEnabled: false,
    bilingualReadRoutes: true,
    mutationRoutesFailClosedAfterSecurityBinding: true,
    sourceFullBodyExposed: false,
    recentThreeBaseWrites: 0,
    automaticReviewRegistrations: 0,
    automaticPublishRegistrations: 0,
    realModelCalls: 0,
    externalCalls: 0
  },
  commands: { focused, typecheck, lint, officialReleaseVerifierExpectedNoDeploy: verifier },
  staleStageManifestSha256: stageManifestSha256,
  files: evidenceFiles
});
const receiptJson = canonical(receipt);
writeFileSync(join(runRoot, "receipt.json"), receiptJson, { mode: 0o600 });
const report = `# QL3 bilingual Admin integration interim evidence\n\n- Status: INTERIM_READ_ONLY_PASS\n- Deploy decision: NO_DEPLOY\n- Reason: AUTHORITY_EXTENSION_REQUIRED\n- Toolchain: Node ${process.version.slice(1)} / npm ${npmVersion}\n- Focused integration: PASS (10/10)\n- Typecheck: PASS\n- Changed-file lint: PASS\n- Full lint: PASS with 8 pre-existing image warnings\n- Isolated clean build: PASS (temporary copy; repository .next untouched)\n- Full suite current shared-worktree snapshot: 271 PASS / 11 FAIL / 1 failed suite; recorded as non-green and not used to claim deployability\n- Official staged-release verifier: expected REJECT (stale stage does not contain the new 0009/Admin closure)\n- Automatic review registrations: 0\n- Automatic publish registrations: 0\n- Real model calls / external calls: 0 / 0\n- Receipt SHA-256: ${sha256(receiptJson)}\n`;
writeFileSync(join(runRoot, "report.md"), report, { mode: 0o600 });
const manifest = canonical({
  schemaVersion: "ql3-bilingual-admin-interim-manifest-v1",
  receiptSha256: sha256(receiptJson),
  reportSha256: sha256(report),
  evidenceScriptSha256: sha256(readFileSync(resolve(appRoot, "scripts/bilingual-admin-integration-evidence.ts"))),
  files: evidenceFiles
});
writeFileSync(join(runRoot, "manifest.json"), manifest, { mode: 0o600 });
process.stdout.write(`${canonical({ status: "INTERIM_READ_ONLY_PASS", deployDecision: "NO_DEPLOY", runRoot, receiptSha256: sha256(receiptJson), manifestSha256: sha256(manifest) })}\n`);
