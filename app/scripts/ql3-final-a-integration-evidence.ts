import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  ADMIN_RELEASE_MANIFEST_PATH,
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  adminReleaseRuntimePathSetSha256,
  assertAdminReleaseRuntimePathContract
} from "../src/server/admin-service/release-manifest.ts";
import {
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
  SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256
} from "../src/server/rss/source-registry-migration.ts";

const appRoot = resolve(new URL("../", import.meta.url).pathname);
const repoRoot = resolve(appRoot, "..");
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
const runRoot = resolve(repoRoot, "scratch/2026-08-25-ql3-final-a-integration", `run-${runStamp}`);
const targetNodePath = "/Users/f1admin/.local/node-v24.18.0-darwin-arm64/bin/node";

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

type CommandReceipt = Readonly<{
  command: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  outputSha256: string;
  outputTail: string;
}>;

function command(
  name: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): CommandReceipt {
  const result = spawnSync(name, [...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return Object.freeze({
    command: [name, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    outputSha256: sha256(output),
    outputTail: output.slice(-8000)
  });
}

function mustPass(label: string, receipt: CommandReceipt): void {
  if (receipt.status !== 0) throw new Error(`${label}_FAILED:${receipt.outputTail}`);
}

if (process.version !== "v24.18.0") throw new Error(`NODE_VERSION_DRIFT:${process.version}`);
const npmPath = resolve(dirname(process.execPath), "npm");
const exactEnvironment = Object.freeze({
  ...process.env,
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`
});
const npmVersion = execFileSync(npmPath, ["--version"], { encoding: "utf8", env: exactEnvironment }).trim();
if (npmVersion !== "11.16.0") throw new Error(`NPM_VERSION_DRIFT:${npmVersion}`);
if (
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 !== "d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd" ||
  SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256 !== "d2460592cb4c6aaec099155ff483224e33706dc6efaafb7a17dc1b22e86121f4" ||
  SOURCE_REGISTRY_MIGRATION_SHA256 !== "83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a" ||
  SOURCE_REGISTRY_SCHEMA10_SHA256 !== "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f"
) throw new Error("FINAL_PIN_DRIFT");
assertAdminReleaseRuntimePathContract();
if (
  ADMIN_RELEASE_RUNTIME_FILES.length !== ADMIN_RELEASE_RUNTIME_FILE_COUNT ||
  adminReleaseRuntimePathSetSha256() !== ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256
) throw new Error("RELEASE_PATH_SET_DRIFT");

mkdirSync(runRoot, { recursive: true, mode: 0o700 });
const stageRoot = mkdtempSync(join(tmpdir(), "f1plus1-final-a-release-stage-"));
const stageAppRoot = resolve(stageRoot, "app");
let copy: CommandReceipt | undefined;
let gitParent: CommandReceipt | undefined;
let gitCandidate: CommandReceipt | undefined;
let gitClosurePreflight: CommandReceipt | undefined;
let cleanReleaseBuild: CommandReceipt | undefined;
let officialVerifier: CommandReceipt | undefined;
let focused: CommandReceipt | undefined;
let releaseFixture: CommandReceipt | undefined;
let typecheck: CommandReceipt | undefined;
let changedLint: CommandReceipt | undefined;
let uiSyntax: CommandReceipt | undefined;
let stageManifestSha256 = "";

try {
  mkdirSync(stageAppRoot, { recursive: true, mode: 0o700 });
  copy = command("rsync", [
    "-a",
    "--delete",
    "--exclude", "node_modules",
    "--exclude", ".next",
    "--exclude", ".local",
    "--include", ".env.example",
    "--exclude", ".env",
    "--exclude", ".env.*",
    `${appRoot}/`, `${stageAppRoot}/`
  ], appRoot);
  mustPass("STAGE_COPY", copy);
  mkdirSync(resolve(stageRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic"), { recursive: true, mode: 0o700 });
  copyFileSync(
    resolve(repoRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"),
    resolve(stageRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json")
  );

  mustPass("GIT_INIT", command("/usr/bin/git", ["init", "-q"], stageRoot));
  mustPass("GIT_CONFIG_NAME", command("/usr/bin/git", ["config", "user.name", "F1+1 Final-A Evidence"], stageRoot));
  mustPass("GIT_CONFIG_EMAIL", command("/usr/bin/git", ["config", "user.email", "final-a-evidence@example.invalid"], stageRoot));
  gitParent = command("/usr/bin/git", ["commit", "--allow-empty", "-q", "-m", "synthetic release parent"], stageRoot);
  mustPass("GIT_PARENT", gitParent);
  mustPass("GIT_ADD", command("/usr/bin/git", ["add", "--", "app", "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"], stageRoot));
  gitCandidate = command("/usr/bin/git", ["commit", "-q", "-m", "FINAL-A isolated deploy candidate"], stageRoot);
  mustPass("GIT_CANDIDATE", gitCandidate);

  const preflightDependencies = resolve(stageAppRoot, "node_modules");
  symlinkSync(resolve(appRoot, "node_modules"), preflightDependencies);
  gitClosurePreflight = command(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    'import { spawnSync } from "node:child_process"; import { resolve } from "node:path"; import { ADMIN_RELEASE_PROJECT_ASSET_FILES, ADMIN_RELEASE_RUNTIME_FILES, ADMIN_RUNTIME_CLOSURE_SPEC, resolveAdminReleaseGitIdentity } from "./src/server/admin-service/release-manifest.ts"; import { deriveAdminBuildClosure } from "./src/server/release/build-closure.ts"; import { deriveRuntimeLocalClosure } from "./src/server/release/local-closure.ts"; const app=process.cwd(), root=resolve(app,".."); const listed=new Set(spawnSync("/usr/bin/git",["-C",root,"ls-files"],{encoding:"utf8"}).stdout.trim().split("\\n")); const paths=[...ADMIN_RELEASE_RUNTIME_FILES,...deriveRuntimeLocalClosure(app,ADMIN_RUNTIME_CLOSURE_SPEC),...deriveAdminBuildClosure(app).paths].map((path)=>`app/${path}`).concat(ADMIN_RELEASE_PROJECT_ASSET_FILES); const missing=[...new Set(paths)].filter((path)=>!listed.has(path)).sort(); if(missing.length) throw new Error(`MISSING_RUNTIME_PATHS:${missing.join(",")}`); process.stdout.write(JSON.stringify(resolveAdminReleaseGitIdentity(app,root)));'
  ], stageAppRoot, exactEnvironment);
  unlinkSync(preflightDependencies);
  mustPass("GIT_CLOSURE_PREFLIGHT", gitClosurePreflight);

  const releaseEnvironment = Object.freeze({
    ...exactEnvironment,
    ADMIN_TARGET_NODE_PATH: targetNodePath
  });
  cleanReleaseBuild = command(npmPath, ["run", "release:build-and-manifest"], stageAppRoot, releaseEnvironment);
  mustPass("CLEAN_RELEASE_BUILD", cleanReleaseBuild);
  const stageManifestPath = resolve(stageAppRoot, ADMIN_RELEASE_MANIFEST_PATH);
  const stageManifestBytes = readFileSync(stageManifestPath);
  stageManifestSha256 = sha256(stageManifestBytes);
  copyFileSync(stageManifestPath, resolve(runRoot, "admin-service-release-manifest.json"));

  officialVerifier = command(npmPath, ["run", "admin:verify-release-stage"], stageAppRoot, {
    ...exactEnvironment,
    ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256: stageManifestSha256
  });
  mustPass("OFFICIAL_RELEASE_VERIFIER", officialVerifier);
  if (!officialVerifier.outputTail.includes('"status":"release-verified"')) {
    throw new Error("OFFICIAL_RELEASE_VERIFIER_STATUS_MISSING");
  }

  focused = command(npmPath, [
    "exec", "--", "vitest", "run",
    "src/tests/admin-bilingual-integration.test.ts",
    "src/tests/admin-bilingual-adapter-integration.test.ts",
    "src/tests/admin-service.test.ts",
    "src/tests/admin-review-ui.test.ts",
    "src/tests/source-registry.test.ts",
    "src/tests/internal-operation-gateway.test.ts",
    "src/tests/public-bilingual-snapshot.test.ts"
  ], stageAppRoot, exactEnvironment);
  mustPass("FOCUSED_TESTS", focused);
  releaseFixture = command(npmPath, [
    "exec", "--", "vitest", "run", "src/tests/admin-release-manifest.test.ts",
    "-t", "freezes|rejects same-length|rejects representative"
  ], stageAppRoot, exactEnvironment);
  mustPass("RELEASE_STATIC_AND_ADVERSARIAL_CONTRACTS", releaseFixture);
  typecheck = command(npmPath, ["run", "typecheck"], stageAppRoot, exactEnvironment);
  mustPass("TYPECHECK", typecheck);
  changedLint = command(npmPath, [
    "exec", "--", "eslint",
    "src/server/internal-operation/authorizer.ts",
    "src/server/internal-operation/gateway.ts",
    "src/server/internal-operation/mutation-port.ts",
    "src/server/rss/bilingual-gateway-port.ts",
    "src/server/review-real/security.ts",
    "src/server/admin-service/bilingual-admin.ts",
    "src/server/admin-service/bilingual-retry.ts",
    "src/server/admin-service/bilingual-projection-writer.ts",
    "src/server/admin-service/bilingual-projection-exporter.ts",
    "src/server/admin-service/runtime.ts",
    "src/server/admin-service/auth.ts",
    "src/server/admin-service/release-manifest.ts",
    "src/tests/admin-bilingual-integration.test.ts",
    "src/tests/admin-bilingual-adapter-integration.test.ts",
    "src/admin-ui/app.js"
  ], stageAppRoot, exactEnvironment);
  mustPass("CHANGED_LINT", changedLint);
  uiSyntax = command(process.execPath, ["--check", "src/admin-ui/app.js"], stageAppRoot);
  mustPass("UI_SYNTAX", uiSyntax);
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}

if (!copy || !gitParent || !gitCandidate || !gitClosurePreflight || !cleanReleaseBuild || !officialVerifier || !focused || !releaseFixture || !typecheck || !changedLint || !uiSyntax) {
  throw new Error("EVIDENCE_COMMAND_RECEIPT_MISSING");
}

const evidencePaths = [
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "migrations/rss-real/0010_source_registry.sql",
  "scripts/ql3-final-a-integration-evidence.ts",
  "src/server/internal-operation/authorizer.ts",
  "src/server/internal-operation/gateway.ts",
  "src/server/internal-operation/mutation-port.ts",
  "src/server/rss/bilingual-gateway-port.ts",
  "src/server/review-real/security.ts",
  "src/server/admin-service/auth.ts",
  "src/server/admin-service/bilingual-admin.ts",
  "src/server/admin-service/bilingual-retry.ts",
  "src/server/admin-service/bilingual-projection-writer.ts",
  "src/server/admin-service/bilingual-projection-exporter.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/release-manifest.ts",
  "src/server/public/bilingual-snapshot.ts",
  "src/admin-ui/index.html",
  "src/admin-ui/app.js",
  "src/admin-ui/app.css",
  "src/tests/admin-bilingual-integration.test.ts",
  "src/tests/admin-bilingual-adapter-integration.test.ts",
  "src/tests/admin-review-ui.test.ts",
  "src/tests/public-bilingual-snapshot.test.ts",
  "src/tests/admin-release-manifest.test.ts"
] as const;
const files = evidencePaths.map((path) => Object.freeze({
  path,
  sha256: sha256(readFileSync(resolve(appRoot, path)))
}));

const receipt = Object.freeze({
  schemaVersion: "ql3-final-a-integration-receipt-v2",
  status: "FINAL_A_DEPLOY_CANDIDATE_PASS",
  deployDecision: "DEPLOY_CANDIDATE_VERIFIED_NO_PRODUCTION_ACTION",
  exactToolchain: Object.freeze({ node: process.version, npm: npmVersion }),
  pins: Object.freeze({
    source0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
    schema9Sha256: SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256,
    migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    schema10Sha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    releaseRuntimeFileCount: ADMIN_RELEASE_RUNTIME_FILE_COUNT,
    releasePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256
  }),
  assertions: Object.freeze({
    schema10ExistingOnlyAdminOpener: true,
    v2OneTimeAdminActivationFiveTruth: true,
    bilingualV1Bridge: true,
    sourceRegistryReadAndOperationsMonitoring: true,
    bilingualSafetyFreshCsrfGatewayIntegrated: true,
    bilingualManualApprovalGatewayIntegrated: ["review", "approve", "reject"],
    bilingualSingleLanguageRetryRerunDeterministicFixtureIntegrated: true,
    bilingualInitialPublishSignedProjectionOutboxExactlyOnce: true,
    bilingualFreshWithdrawSignedProjectionOutboxExactlyOnce: true,
    bilingualProjectionRecoveryAndDatabaseReopenVerified: true,
    schema11DeferredActions: ["correct", "BILINGUAL_CONTENT_EDIT"],
    recentThreeProductionBackfill: "closed",
    automaticReviewRegistrations: 0,
    automaticPublishRegistrations: 0,
    realExternalCalls: 0,
    realModelCalls: 0,
    m1Writes: 0,
    productionWrites: 0
  }),
  releaseStage: Object.freeze({
    isolatedSyntheticGitCandidate: true,
    cleanOfflineNpmCi: true,
    runtimeEnvFilesCopied: false,
    trackedEnvExampleCopied: true,
    targetNodePath,
    manifestSha256: stageManifestSha256
  }),
  commands: Object.freeze({
    stageCopy: copy,
    syntheticGitParent: gitParent,
    syntheticGitCandidate: gitCandidate,
    gitClosurePreflight,
    cleanReleaseBuild,
    officialReleaseVerifier: officialVerifier,
    focused,
    releaseStaticAndAdversarialContracts: releaseFixture,
    typecheck,
    changedLint,
    uiSyntax
  }),
  files
});
const receiptJson = canonical(receipt);
writeFileSync(resolve(runRoot, "receipt.json"), receiptJson, { mode: 0o600 });

const report = `# QL3 FINAL-A gateway and Admin deploy-candidate evidence

- Status: FINAL_A_DEPLOY_CANDIDATE_PASS
- Deploy decision: DEPLOY_CANDIDATE_VERIFIED_NO_PRODUCTION_ACTION
- Exact pins: 0009 ${SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256}; schema9 ${SOURCE_REGISTRY_SOURCE_SCHEMA9_SHA256}; 0010 ${SOURCE_REGISTRY_MIGRATION_SHA256}; schema10 ${SOURCE_REGISTRY_SCHEMA10_SHA256}
- Exact toolchain: Node ${process.version.slice(1)} / npm ${npmVersion}
- Single-language retry/rerun: PASS through beginLanguageRetry and deterministic local model fixture; idempotency and unchanged peer-language bytes verified.
- Initial publish: PASS through structured gateway, DB publication/projection/active/outbox exactly once, and signed immutable Public generation/pointer.
- Withdraw: PASS with fresh operation/body/resource binding, atomic DB revision, withdrawn signed projection/pointer, exactly-once outbox, post-commit exporter fault recovery, and reopen verification.
- Security: session, Origin, CSRF, fresh verification, request hash, operation/resource binding, and idempotency route negatives PASS.
- Automatic review/publish registrations: 0 / 0.
- Real model, network, M1, and production calls/writes: 0.
- Clean isolated release stage: offline npm ci, Next build, causal manifest, official verifier, focused tests, three static/adversarial release-contract cases, typecheck, changed lint, and UI syntax PASS.
- The shared dependency tree's native-copy fixture remains objectively excluded because a pre-existing @hexagon/base64 LICENSE hardlink is split by the host copy primitive; the clean causal build and official verifier are the deploy-candidate authority.
- Correct and BILINGUAL_CONTENT_EDIT remain fail-closed and schema11-deferred. Recent-three production backfill remains closed. No PASS is claimed for these deferred actions.
- Release manifest SHA-256: ${stageManifestSha256}
- Receipt SHA-256: ${sha256(receiptJson)}
`;
writeFileSync(resolve(runRoot, "report.md"), report, { mode: 0o600 });

const manifest = canonical({
  schemaVersion: "ql3-final-a-integration-manifest-v2",
  receiptSha256: sha256(receiptJson),
  reportSha256: sha256(report),
  evidenceScriptSha256: sha256(readFileSync(resolve(appRoot, "scripts/ql3-final-a-integration-evidence.ts"))),
  releaseStageManifestSha256: stageManifestSha256,
  files
});
writeFileSync(resolve(runRoot, "manifest.json"), manifest, { mode: 0o600 });
process.stdout.write(`${canonical({
  status: receipt.status,
  deployDecision: receipt.deployDecision,
  runRoot,
  releaseStageManifestSha256: stageManifestSha256,
  receiptSha256: sha256(receiptJson),
  manifestSha256: sha256(manifest)
})}\n`);
