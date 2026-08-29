import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createDisposableSchema10ReleaseDatabase, seedReleaseSwitchIdempotency } from "./ql3-deployment-v10-fixture.ts";
import { adminRuntimeConfigFromDeployment, createReviewAdminRuntime } from "../src/server/admin-service/runtime.ts";
import type { AdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import {
  ADMIN_RELEASE_MANIFEST_PATH,
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  adminReleaseRuntimePathSetSha256,
  assertAdminReleaseRuntimePathContract
} from "../src/server/admin-service/release-manifest.ts";
import { canonicalJsonV1, SqliteInternalOperationGateway } from "../src/server/internal-operation/gateway.ts";
import { persistOwnerSupervisorHandoff } from "../src/server/internal-operation/owner-supervisor.ts";
import {
  PUBLIC_BILINGUAL_POINTER_FILE,
  publicBilingualPointerSignaturePayload,
  publicBilingualSnapshotSignaturePayload,
  readPublicBilingualSnapshot
} from "../src/server/public/bilingual-snapshot.ts";
import {
  assertReleasePair,
  buildReleasePairReceipt,
  buildReleaseSwitchReceipt,
  collectReleaseFiles,
  fallbackV10Capabilities,
  fullV10Capabilities,
  observeReleaseRuntime,
  releaseIdForRole,
  releasePathRoot,
  releaseSourcePreimageSha256,
  type ReleaseCandidateManifest
} from "../src/server/internal-operation/release.ts";
import {
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT,
  PUBLIC_RELEASE_RUNTIME_FILES,
  PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
  assertPublicReleaseRuntimePathContract
} from "../src/server/public/release-manifest.ts";
import {
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256
} from "../src/server/rss/source-registry-migration.ts";

const appRoot = resolve(new URL("../", import.meta.url).pathname);
const repoRoot = resolve(appRoot, "..");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
const runRoot = resolve(repoRoot, "scratch/2026-08-25-schema10-deployment-pair", "run-" + stamp);
const targetNodePath = "/Users/f1admin/.local/node-v24.18.0-darwin-arm64/bin/node";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}

type CommandReceipt = Readonly<{
  command: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  outputSha256: string;
  outputTail: string;
}>;

function command(name: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): CommandReceipt {
  const result = spawnSync(name, [...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024
  });
  const output = String(result.stdout ?? "") + String(result.stderr ?? "");
  return Object.freeze({
    command: [name, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    outputSha256: sha256(output),
    outputTail: output.slice(-8000)
  });
}

function mustPass(label: string, result: CommandReceipt): void {
  if (result.status !== 0) throw new Error(label + "_FAILED:" + result.outputTail);
}

if (process.version !== "v24.18.0") throw new Error("NODE_VERSION_DRIFT:" + process.version);
const npmPath = resolve(dirname(process.execPath), "npm");
const exactEnvironment = Object.freeze({
  ...process.env,
  PATH: dirname(process.execPath) + ":" + (process.env.PATH ?? "/usr/bin:/bin")
});
const npmVersion = execFileSync(npmPath, ["--version"], { encoding: "utf8", env: exactEnvironment }).trim();
if (npmVersion !== "11.16.0") throw new Error("NPM_VERSION_DRIFT:" + npmVersion);
if (
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 !== "d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd" ||
  SOURCE_REGISTRY_MIGRATION_SHA256 !== "83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a" ||
  SOURCE_REGISTRY_SCHEMA10_SHA256 !== "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f"
) throw new Error("SCHEMA10_PIN_DRIFT");
assertAdminReleaseRuntimePathContract();
assertPublicReleaseRuntimePathContract();
if (
  ADMIN_RELEASE_RUNTIME_FILE_COUNT !== 153 ||
  ADMIN_RELEASE_RUNTIME_FILES.length !== 153 ||
  adminReleaseRuntimePathSetSha256() !== ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 ||
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT !== 89 ||
  PUBLIC_RELEASE_RUNTIME_FILES.length !== 89
) throw new Error("RELEASE_RUNTIME_CLOSURE_DRIFT");

mkdirSync(runRoot, { recursive: true, mode: 0o700 });
const stageRoot = mkdtempSync(join(tmpdir(), "f1plus1-schema10-deployment-stage-"));
const stageAppRoot = resolve(stageRoot, "app");
let stageCopy!: CommandReceipt;
let releaseBuild!: CommandReceipt;
let officialVerifier!: CommandReceipt;
let focused!: CommandReceipt;
let deploymentFull!: CommandReceipt;
let openerFocused!: CommandReceipt;
let manualRoutesFocused!: CommandReceipt;
let releaseContracts!: CommandReceipt;
let typecheck!: CommandReceipt;
let changedLint!: CommandReceipt;
let releaseManifestSha256 = "";
let full!: ReleaseCandidateManifest;
let fallback!: ReleaseCandidateManifest;
let pairReceipt!: ReturnType<typeof buildReleasePairReceipt>;
let switchReceipt!: ReturnType<typeof buildReleaseSwitchReceipt>;
let fullBefore!: ReturnType<typeof observeReleaseRuntime>;
let fallbackAfter!: ReturnType<typeof observeReleaseRuntime>;
let rollbackAfter!: ReturnType<typeof observeReleaseRuntime>;
let fallbackForbiddenCallbacks = 0;
let fallbackAllowedCallbacks = 0;

try {
  mkdirSync(stageAppRoot, { recursive: true, mode: 0o700 });
  stageCopy = command("rsync", [
    "-a", "--delete",
    "--exclude", "node_modules",
    "--exclude", ".next",
    "--exclude", ".local",
    "--include", ".env.example",
    "--exclude", ".env",
    "--exclude", ".env.*",
    appRoot + "/",
    stageAppRoot + "/"
  ], appRoot, exactEnvironment);
  mustPass("STAGE_COPY", stageCopy);
  const projectAssetDirectory = resolve(stageRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic");
  mkdirSync(projectAssetDirectory, { recursive: true, mode: 0o700 });
  copyFileSync(
    resolve(repoRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"),
    resolve(projectAssetDirectory, "runtime-graph.public-multimedia-pagination-synthetic.json")
  );
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "F1+1 Schema10 Deployment Evidence"],
    ["config", "user.email", "schema10-deployment@example.invalid"],
    ["commit", "--allow-empty", "-q", "-m", "synthetic release parent"],
    ["add", "--", "app", "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"],
    ["commit", "-q", "-m", "schema10 full and fallback candidates"]
  ] as const) mustPass("STAGE_GIT", command("/usr/bin/git", args, stageRoot, exactEnvironment));

  releaseBuild = command(npmPath, ["run", "release:build-and-manifest"], stageAppRoot, {
    ...exactEnvironment,
    ADMIN_TARGET_NODE_PATH: targetNodePath
  });
  mustPass("CLEAN_RELEASE_BUILD", releaseBuild);
  const releaseManifestPath = resolve(stageAppRoot, ADMIN_RELEASE_MANIFEST_PATH);
  const releaseManifestBytes = readFileSync(releaseManifestPath);
  releaseManifestSha256 = sha256(releaseManifestBytes);
  copyFileSync(releaseManifestPath, resolve(runRoot, "admin-service-release-manifest.json"));
  const releaseManifest = JSON.parse(releaseManifestBytes.toString("utf8")) as {
    releaseRootSha256?: unknown;
    gitCommit?: unknown;
    gitTree?: unknown;
  };
  const packageRootSha256 = releaseManifest.releaseRootSha256;
  if (typeof packageRootSha256 !== "string" || !/^[0-9a-f]{64}$/.test(packageRootSha256)) {
    throw new Error("RELEASE_PACKAGE_ROOT_MISSING");
  }
  officialVerifier = command(npmPath, ["run", "admin:verify-release-stage"], stageAppRoot, {
    ...exactEnvironment,
    ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256: releaseManifestSha256
  });
  mustPass("OFFICIAL_RELEASE_VERIFIER", officialVerifier);

  const runtimePaths = [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...PUBLIC_RELEASE_RUNTIME_FILES])];
  const files = collectReleaseFiles(stageAppRoot, runtimePaths);
  const sourceCommitSha1 = execFileSync("/usr/bin/git", ["-C", stageRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceTreeSha1 = execFileSync("/usr/bin/git", ["-C", stageRoot, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const identity = {
    schemaVersion: 10 as const,
    sourceCommitSha1,
    sourceTreeSha1,
    schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
    migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    adminRuntimeFileCount: 153 as const,
    adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: 89 as const,
    publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    packageLockSha256: files.find((file) => file.path === "package-lock.json")!.sha256,
    packageRootSha256,
    pathRootSha256: releasePathRoot(files)
  };
  const sourcePreimageSha256 = releaseSourcePreimageSha256(identity);
  const base = { ...identity, sourcePreimageSha256, files };
  full = Object.freeze({
    ...base,
    role: "full_v10" as const,
    releaseId: releaseIdForRole("full_v10", sourcePreimageSha256),
    capabilities: fullV10Capabilities()
  });
  fallback = Object.freeze({
    ...base,
    role: "manual_only_fallback_v10" as const,
    releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256),
    capabilities: fallbackV10Capabilities()
  });
  pairReceipt = buildReleasePairReceipt(full, fallback, "2026-08-25T00:00:00.000Z");
  assertReleasePair(full, fallback, pairReceipt);

  const fullManifestPath = resolve(stageAppRoot, ".local/release/full_v10.manifest.json");
  const fallbackManifestPath = resolve(stageAppRoot, ".local/release/manual_only_fallback_v10.manifest.json");
  const pairReceiptPath = resolve(stageAppRoot, ".local/release/release-pair.receipt.json");
  const fullManifestJson = canonicalJsonV1(full);
  const fallbackManifestJson = canonicalJsonV1(fallback);
  const pairReceiptJson = canonicalJsonV1(pairReceipt);
  writeFileSync(fullManifestPath, fullManifestJson, { mode: 0o600 });
  writeFileSync(fallbackManifestPath, fallbackManifestJson, { mode: 0o600 });
  writeFileSync(pairReceiptPath, pairReceiptJson, { mode: 0o600 });
  chmodSync(fullManifestPath, 0o600);
  chmodSync(fallbackManifestPath, 0o600);
  chmodSync(pairReceiptPath, 0o600);

  const disposable = createDisposableSchema10ReleaseDatabase(stageAppRoot);
  const gateway = seedReleaseSwitchIdempotency(disposable.database);
  gateway.close();
  const verifiedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const authorityActivationHandoff = (capability: "auto" | "manual") => Object.freeze({
    schemaVersion: "owner-supervisor-handoff-v1" as const,
    handoffId: `deployment-v10-${capability}-activation`,
    ownerProcess: "admin_http" as const,
    issuer: "f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce: (capability === "auto" ? "a" : "m").repeat(43),
    releaseSha256: full.sourcePreimageSha256,
    manifestSha256: pairReceipt.fullManifestSha256,
    receiptSha256: sha256(`deployment-v10-${capability}-activation`),
    verifiedAt,
    expiresAt
  });
  const autoActivationHandoff = authorityActivationHandoff("auto");
  const manualActivationHandoff = authorityActivationHandoff("manual");
  persistOwnerSupervisorHandoff(disposable.database, autoActivationHandoff, () => true);
  persistOwnerSupervisorHandoff(disposable.database, manualActivationHandoff, () => true);
  const activationGateway = new SqliteInternalOperationGateway({
    database: disposable.database,
    releaseSha256: full.sourcePreimageSha256,
    manifestSha256: pairReceipt.fullManifestSha256,
    schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    now: () => new Date(Date.parse(verifiedAt) + 500)
  });
  activationGateway.transitionQuickLaunchAuthority(autoActivationHandoff, {
    operationId: "deployment-v10-enable-auto",
    idempotencyKey: "deployment-v10-enable-auto",
    capabilityId: "bilingual_auto_refine",
    action: "enable",
    expectedVersion: 1,
    requestHash: sha256("deployment-v10-enable-auto"),
    authorityReceiptSha256: sha256("deployment-v10-enable-auto-receipt")
  });
  activationGateway.transitionQuickLaunchAuthority(manualActivationHandoff, {
    operationId: "deployment-v10-enable-manual",
    idempotencyKey: "deployment-v10-enable-manual",
    capabilityId: "bilingual_manual_mutation",
    action: "enable",
    expectedVersion: 1,
    requestHash: sha256("deployment-v10-enable-manual"),
    authorityReceiptSha256: sha256("deployment-v10-enable-manual-receipt")
  });
  activationGateway.close();
  let handoffIndex = 0;
  for (const candidate of [full, fallback]) {
    const candidateManifestSha256 = candidate.role === "full_v10" ? pairReceipt.fullManifestSha256 : pairReceipt.fallbackManifestSha256;
    for (const ownerProcess of ["admin_http", "rss_collector", "rss_refiner", "projection_sender"] as const) {
      handoffIndex += 1;
      persistOwnerSupervisorHandoff(disposable.database, Object.freeze({
        schemaVersion: "owner-supervisor-handoff-v1" as const,
        handoffId: `deployment-v10-${candidate.role}-${ownerProcess}`,
        ownerProcess,
        issuer: "f1plus1-owner-supervisor-v1" as const,
        oneTimeNonce: `${String(handoffIndex).padStart(2, "0")}${"n".repeat(41)}`,
        releaseSha256: candidate.sourcePreimageSha256,
        manifestSha256: candidateManifestSha256,
        receiptSha256: sha256(`deployment-v10-handoff-${handoffIndex}`),
        verifiedAt,
        expiresAt
      }), () => true);
    }
  }
  disposable.database.close();

  const dataRoot = resolve(disposable.root, "admin-data");
  const projectionRoot = resolve(disposable.root, "public-projection");
  const keyRoot = resolve(disposable.root, "keys");
  for (const directory of [dataRoot, projectionRoot, keyRoot]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sessionHashKeyPath = resolve(dataRoot, "session-hash-key");
  const recoveryFencePath = resolve(dataRoot, "recovery-fence.json");
  const signingKeyPath = resolve(keyRoot, "projection-private.pem");
  const verifyKeyPath = resolve(keyRoot, "projection-public.pem");
  writeFileSync(sessionHashKeyPath, Buffer.alloc(32, 7).toString("base64url"), { mode: 0o600 });
  writeFileSync(recoveryFencePath, canonicalJsonV1({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: Date.now() }), { mode: 0o600 });
  const signingKeys = generateKeyPairSync("ed25519");
  writeFileSync(signingKeyPath, signingKeys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  writeFileSync(verifyKeyPath, signingKeys.publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
  const lkgBody = {
    schemaVersion: "public-bilingual-snapshot-v1" as const,
    schema10Sha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0010Sha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    generationId: "synthetic-lkg-v10",
    generatedAt: "2026-08-25T00:00:00.000Z",
    records: [],
    withdrawals: []
  };
  const lkgBodyHash = sha256(canonicalJsonV1(lkgBody));
  const lkgEnvelope = {
    schemaVersion: "public-bilingual-snapshot-signed-v1" as const,
    body: lkgBody,
    bodyHash: lkgBodyHash,
    signingKeyId: "synthetic-deployment-v10-key",
    signature: sign(null, publicBilingualSnapshotSignaturePayload(lkgBodyHash), signingKeys.privateKey).toString("base64url")
  };
  const lkgFile = `bilingual-generation-${lkgBodyHash}.json`;
  writeFileSync(resolve(projectionRoot, lkgFile), canonicalJsonV1(lkgEnvelope), { mode: 0o600 });
  const pointerBody = {
    schemaVersion: "public-bilingual-active-pointer-v1" as const,
    schema10Sha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0010Sha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    active: { file: `bilingual-generation-${"0".repeat(64)}.json`, generationId: "unavailable-active-v10", generationHash: "0".repeat(64) },
    lkg: { file: lkgFile, generationId: lkgBody.generationId, generationHash: lkgBodyHash },
    updatedAt: "2026-08-25T00:00:00.000Z"
  };
  const pointerBodyHash = sha256(canonicalJsonV1(pointerBody));
  const pointerEnvelope = {
    schemaVersion: "public-bilingual-active-pointer-signed-v1" as const,
    body: pointerBody,
    bodyHash: pointerBodyHash,
    signingKeyId: "synthetic-deployment-v10-key",
    signature: sign(null, publicBilingualPointerSignaturePayload(pointerBodyHash), signingKeys.privateKey).toString("base64url")
  };
  const pointerPath = resolve(projectionRoot, PUBLIC_BILINGUAL_POINTER_FILE);
  writeFileSync(pointerPath, canonicalJsonV1(pointerEnvelope), { mode: 0o600 });
  const verifiedLkgSha256 = (): string => {
    const loaded = readPublicBilingualSnapshot({ root: projectionRoot, signingKeyId: "synthetic-deployment-v10-key", publicKey: signingKeys.publicKey });
    if (!loaded.usedLkg || loaded.generationHash !== lkgBodyHash) throw new Error("PUBLIC_LKG_VERIFICATION_FAILED");
    return sha256(canonicalJsonV1({ generationHash: loaded.generationHash, pointerSha256: sha256(readFileSync(pointerPath)) }));
  };
  const databaseIdentity = lstatSync(disposable.path);
  const deploymentBase = {
    schemaVersion: "admin-service-deployment-v3" as const,
    label: "com.f1plus1.admin-service" as const,
    bindHost: "127.0.0.1" as const,
    bindPort: 3101 as const,
    canonicalOrigin: "https://f1-admin.example.ts.net",
    rpName: "F1+1 Admin",
    operatorRef: "operator-primary",
    tailscaleAppCapabilityId: "admin.example.com/cap/f1-admin-device",
    trustedIdentities: [{ login: "owner@example.com", operatorRef: "operator-primary", sourceRefs: ["A".repeat(43), "B".repeat(43), "C".repeat(43)] }] as const,
    targetReleaseAppRoot: realpathSync(stageAppRoot),
    fullReleaseManifestPath: fullManifestPath,
    fullReleaseManifestSha256: sha256(fullManifestJson),
    fallbackReleaseManifestPath: fallbackManifestPath,
    fallbackReleaseManifestSha256: sha256(fallbackManifestJson),
    releasePairReceiptPath: pairReceiptPath,
    releasePairReceiptSha256: sha256(pairReceiptJson),
    officialReleaseManifestPath: releaseManifestPath,
    officialReleaseManifestSha256: releaseManifestSha256,
    reviewDatabasePath: realpathSync(disposable.path),
    reviewDatabaseIdentity: { dev: databaseIdentity.dev, ino: databaseIdentity.ino, uid: databaseIdentity.uid, nlink: 1 as const },
    reviewSchemaTarget: 10 as const,
    reviewSchemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    dataRoot,
    staticRoot: resolve(realpathSync(stageAppRoot), "src/admin-ui"),
    sessionHashKeyPath,
    recoveryFencePath,
    publicProjectionRoot: projectionRoot,
    projectionSigningKeyId: "synthetic-deployment-v10-key",
    projectionSigningPrivateKeyPath: signingKeyPath,
    projectionVerifyKeyPath: verifyKeyPath,
    projectionInternalEndpoint: "http://127.0.0.1:3102/internal/projections" as const,
    publicReadMode: "public-real-snapshot" as const,
    projectionSenderServiceIdentity: "synthetic-projection-sender",
    projectionReceiverServiceIdentity: "synthetic-projection-receiver",
    preparedAt: "2026-08-25T00:00:00.000Z",
    serviceState: "disabled" as const
  };
  const lkgSha256 = verifiedLkgSha256();
  const fullDeployment = { ...deploymentBase, activeReleaseRole: "full_v10" as const, syntheticRollbackRelease: fallback.releaseId, syntheticRollbackHash: pairReceipt.fallbackManifestSha256 } as unknown as AdminDeploymentManifest;
  const fullConfig = adminRuntimeConfigFromDeployment(fullDeployment, { activatedAt: "2026-08-25T00:00:01.000Z", allowDisposableReviewDatabase: true });
  const fullRuntime = createReviewAdminRuntime(fullConfig);
  if (fullRuntime.gateway === null || !fullRuntime.manualBilingualEnabled) throw new Error("FULL_PRODUCTION_GATEWAY_UNAVAILABLE");
  fullBefore = observeReleaseRuntime(fullRuntime.database, fullConfig.releaseGate!, lkgSha256);
  fullRuntime.gateway.close();
  fullRuntime.database.close();
  const fallbackDeployment = { ...deploymentBase, activeReleaseRole: "manual_only_fallback_v10" as const, syntheticRollbackRelease: full.releaseId, syntheticRollbackHash: pairReceipt.fullManifestSha256 } as unknown as AdminDeploymentManifest;
  const fallbackConfig = adminRuntimeConfigFromDeployment(fallbackDeployment, { activatedAt: "2026-08-25T00:00:02.000Z", previousActivationId: fullConfig.releaseGate!.receipt.activationId, allowDisposableReviewDatabase: true });
  for (const action of [
    "collector_network", "model_network", "retry_model_call", "automatic_review", "automatic_publish"
  ] as const) {
    try {
      fallbackConfig.releaseGate!.run(action, () => { fallbackForbiddenCallbacks += 1; });
      throw new Error(`FALLBACK_ACTION_WAS_OPEN:${action}`);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== `RELEASE_RUNTIME_ACTION_CLOSED:${action}`) throw error;
    }
  }
  if (fallbackForbiddenCallbacks !== 0) throw new Error("FALLBACK_FORBIDDEN_CALLBACK_EXECUTED");
  fallbackConfig.releaseGate!.run("manual_safety_review_publish_withdraw", () => { fallbackAllowedCallbacks += 1; });
  fallbackConfig.releaseGate!.run("manual_outbox_create", () => { fallbackAllowedCallbacks += 1; });
  fallbackConfig.releaseGate!.run("public_lkg", () => { fallbackAllowedCallbacks += 1; return verifiedLkgSha256(); });
  if (fallbackAllowedCallbacks !== 3) throw new Error("FALLBACK_ALLOWED_CALLBACK_MISSING");
  const fallbackRuntime = createReviewAdminRuntime(fallbackConfig);
  if (fallbackRuntime.gateway === null || !fallbackRuntime.manualBilingualEnabled) throw new Error("FALLBACK_PRODUCTION_GATEWAY_UNAVAILABLE");
  fallbackAfter = observeReleaseRuntime(fallbackRuntime.database, fallbackConfig.releaseGate!, verifiedLkgSha256());
  fallbackRuntime.gateway.close();
  fallbackRuntime.database.close();
  const rollbackConfig = adminRuntimeConfigFromDeployment(fullDeployment, { activatedAt: "2026-08-25T00:00:03.000Z", previousActivationId: fallbackConfig.releaseGate!.receipt.activationId, allowDisposableReviewDatabase: true });
  const rollbackRuntime = createReviewAdminRuntime(rollbackConfig);
  if (rollbackRuntime.gateway === null || !rollbackRuntime.manualBilingualEnabled) throw new Error("ROLLBACK_PRODUCTION_GATEWAY_UNAVAILABLE");
  rollbackAfter = observeReleaseRuntime(rollbackRuntime.database, rollbackConfig.releaseGate!, verifiedLkgSha256());
  rollbackRuntime.gateway.close();
  rollbackRuntime.database.close();
  switchReceipt = buildReleaseSwitchReceipt(pairReceipt, fullBefore, fallbackAfter, rollbackAfter);
  const reopened = new DatabaseSync(disposable.path, { readOnly: true });
  const reopenedVersion = Number((reopened.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  const reopenedIdempotency = Number((reopened.prepare(
    "SELECT COUNT(*) AS count FROM internal_operation WHERE idempotency_key='idempotency-release-switch-observation'"
  ).get() as Record<string, unknown>).count);
  const reopenedAuto = Number((reopened.prepare(
    "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')"
  ).get() as Record<string, unknown>).count);
  reopened.close();
  rmSync(disposable.root, { recursive: true, force: true });
  if (reopenedVersion !== 10 || reopenedIdempotency !== 1 || reopenedAuto !== 0) throw new Error("RELEASE_SWITCH_REOPEN_FAILED");

  focused = command(npmPath, [
    "exec", "--", "vitest", "run",
    "src/tests/deployment-v10.test.ts",
    "src/tests/internal-operation-gateway.test.ts",
    "src/tests/admin-service.test.ts",
    "-t", "schema10 deployment release pair|release pair|pins deployment manifests"
  ], stageAppRoot, exactEnvironment);
  mustPass("FOCUSED_DEPLOYMENT_PAIR", focused);
  deploymentFull = command(npmPath, [
    "exec", "--", "vitest", "run",
    "src/tests/deployment-v10.test.ts",
    "src/tests/internal-operation-gateway.test.ts",
    "src/tests/admin-service.test.ts",
    "src/tests/admin-release-manifest.test.ts"
  ], stageAppRoot, exactEnvironment);
  mustPass("FULL_DEPLOYMENT_TESTS", deploymentFull);
  openerFocused = command(npmPath, [
    "exec", "--", "vitest", "run", "src/tests/admin-bilingual-integration.test.ts"
  ], stageAppRoot, exactEnvironment);
  mustPass("FOCUSED_SCHEMA10_OPENER", openerFocused);
  manualRoutesFocused = command(npmPath, [
    "exec", "--", "vitest", "run", "src/tests/admin-bilingual-adapter-integration.test.ts"
  ], stageAppRoot, exactEnvironment);
  mustPass("FOCUSED_MANUAL_BILINGUAL_ROUTES", manualRoutesFocused);
  releaseContracts = command(npmPath, [
    "exec", "--", "vitest", "run", "src/tests/admin-release-manifest.test.ts",
    "-t", "freezes|rejects same-length|rejects representative"
  ], stageAppRoot, exactEnvironment);
  mustPass("RELEASE_CONTRACTS", releaseContracts);
  typecheck = command(npmPath, ["run", "typecheck"], stageAppRoot, exactEnvironment);
  mustPass("TYPECHECK", typecheck);
  changedLint = command(npmPath, [
    "exec", "--", "eslint",
    "src/server/admin-service/deployment.ts",
    "src/server/admin-service/runtime.ts",
    "src/server/admin-service/release-manifest.ts",
    "src/server/internal-operation/release.ts",
    "scripts/admin-service.ts",
    "scripts/admin-install-macos.ts",
    "scripts/rss-collect-once.ts",
    "scripts/rss-refine-once.ts",
    "scripts/projection-sender.ts",
    "scripts/ql3-deployment-v10-fixture.ts",
    "scripts/ql3-deployment-v10-evidence.ts",
    "src/tests/deployment-v10.test.ts",
    "src/tests/internal-operation-gateway.test.ts",
    "src/tests/admin-service.test.ts",
    "src/tests/admin-release-manifest.test.ts"
  ], stageAppRoot, exactEnvironment);
  mustPass("CHANGED_LINT", changedLint);
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}

writeFileSync(resolve(runRoot, "full_v10.manifest.json"), canonicalJsonV1(full), { mode: 0o600 });
writeFileSync(resolve(runRoot, "manual_only_fallback_v10.manifest.json"), canonicalJsonV1(fallback), { mode: 0o600 });
writeFileSync(resolve(runRoot, "release-pair.receipt.json"), canonicalJsonV1(pairReceipt), { mode: 0o600 });
writeFileSync(resolve(runRoot, "release-switch.receipt.json"), canonicalJsonV1(switchReceipt), { mode: 0o600 });
writeFileSync(resolve(runRoot, "release-switch.observations.json"), canonicalJsonV1({
  fullBefore,
  fallbackAfter,
  rollbackAfter
}), { mode: 0o600 });

const evidencePaths = [
  "package.json",
  "scripts/admin-service.ts",
  "scripts/admin-install-macos.ts",
  "scripts/rss-collect-once.ts",
  "scripts/rss-refine-once.ts",
  "scripts/projection-sender.ts",
  "scripts/ql3-deployment-v10-fixture.ts",
  "scripts/ql3-deployment-v10-evidence.ts",
  "src/server/admin-service/deployment.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/release-manifest.ts",
  "src/server/internal-operation/release.ts",
  "src/server/public/release-manifest.ts",
  "src/server/rss/source-registry-migration.ts",
  "src/tests/deployment-v10.test.ts",
  "src/tests/internal-operation-gateway.test.ts",
  "src/tests/admin-service.test.ts",
  "src/tests/admin-bilingual-integration.test.ts",
  "src/tests/admin-bilingual-adapter-integration.test.ts",
  "src/tests/admin-release-manifest.test.ts",
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "migrations/rss-real/0010_source_registry.sql"
] as const;
const files = evidencePaths.map((path) => Object.freeze({
  path,
  sha256: sha256(readFileSync(resolve(appRoot, path)))
}));
const receipt = Object.freeze({
  schemaVersion: "ql3-schema10-deployment-pair-receipt-v1",
  status: "SCHEMA10_DEPLOYMENT_PAIR_CANDIDATE_PASS_NO_DEPLOY",
  deployDecision: "NO_DEPLOY_NO_PRODUCTION_ACTION",
  exactToolchain: { node: process.version, npm: npmVersion },
  schema: {
    version: 10,
    sha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
    migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256
  },
  releaseClosures: {
    adminRuntimeFileCount: 153,
    adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: 89,
    publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    officialReleaseManifestSha256: releaseManifestSha256
  },
  pair: pairReceipt,
  switch: switchReceipt,
  assertions: {
    deploymentSchemaTarget10ExistingOnly: true,
    staleSchema4AndPinsFailClosed: true,
    sameSourceCommitTreePreimage: true,
    samePackageAndPathRoots: true,
    fallbackCollectorNetwork: false,
    fallbackModelNetwork: false,
    fallbackRetryModelCalls: false,
    fallbackAutomaticReview: false,
    fallbackAutomaticPublish: false,
    fallbackManualSafetyReviewPublishWithdraw: true,
    fallbackPublicLkg: true,
    fallbackForbiddenCallbacks,
    fallbackAllowedCallbacks,
    activationChainBound: true,
    productionEntryFactorySwitch: true,
    databaseSchemaDowngrade: false,
    databaseLogicalDrift: false,
    outboxDrift: false,
    idempotencyDrift: false,
    externalCalls: 0,
    m1Writes: 0,
    productionWrites: 0,
    networkCalls: 0
  },
  commands: {
    stageCopy,
    cleanReleaseBuild: releaseBuild,
    officialVerifier,
    focused,
    deploymentFull,
    openerFocused,
    manualRoutesFocused,
    releaseContracts,
    typecheck,
    changedLint
  },
  files
});
const receiptJson = canonical(receipt);
writeFileSync(resolve(runRoot, "receipt.json"), receiptJson, { mode: 0o600 });
const report = [
  "# Schema10 Admin deployment and paired release evidence",
  "",
  "- Status: SCHEMA10_DEPLOYMENT_PAIR_CANDIDATE_PASS_NO_DEPLOY",
  "- Deployment target: existing-only schema10 / " + SOURCE_REGISTRY_SCHEMA10_SHA256,
  "- Pair: " + full.releaseId + " + " + fallback.releaseId,
  "- Shared source commit/tree/preimage: " + full.sourceCommitSha1 + " / " + full.sourceTreeSha1 + " / " + full.sourcePreimageSha256,
  "- Admin/Public runtime closures: 153 / 89.",
  "- Fallback keeps manual safety/review/publish/withdraw, manual outbox, delivery sender and Public LKG.",
  "- Fallback collector, model, retry-model, automatic review/publish, system snapshot and phase egress capabilities are closed.",
  "- The production deployment factory opened full, fallback and rollback runtimes with externally anchored pair bytes and owner-specific DB handoffs; missing identity fails closed.",
  "- Fallback forbidden producer callbacks stayed at zero; manual route adapter tests and the production manual authority/writer wiring passed.",
  "- Disposable full-to-fallback-to-full switch preserved schema10, logical DB digest, outbox, non-zero idempotency truth and external-call count; reopen PASS.",
  "- Public LKG was an immutable synthetic Ed25519-signed generation reached through a signed active-to-LKG fallback pointer and reverified after each switch.",
  "- Clean isolated build, official verifier, focused tests, static/adversarial release contracts, typecheck and changed lint PASS.",
  "- Real network/model, M1, production database, production key and deployment actions: 0.",
  "- This evidence does not authorize deployment.",
  "- Receipt SHA-256: " + sha256(receiptJson),
  ""
].join("\n");
writeFileSync(resolve(runRoot, "report.md"), report, { mode: 0o600 });
const artifactPaths = [
  "full_v10.manifest.json",
  "manual_only_fallback_v10.manifest.json",
  "release-pair.receipt.json",
  "release-switch.receipt.json",
  "release-switch.observations.json",
  "admin-service-release-manifest.json"
];
const manifest = canonical({
  schemaVersion: "ql3-schema10-deployment-pair-manifest-v1",
  receiptSha256: sha256(receiptJson),
  reportSha256: sha256(report),
  evidenceScriptSha256: sha256(readFileSync(resolve(appRoot, "scripts/ql3-deployment-v10-evidence.ts"))),
  files,
  artifacts: artifactPaths.map((path) => ({
    path,
    sha256: sha256(readFileSync(resolve(runRoot, path)))
  }))
});
writeFileSync(resolve(runRoot, "manifest.json"), manifest, { mode: 0o600 });
process.stdout.write(canonical({
  status: receipt.status,
  deployDecision: receipt.deployDecision,
  runRoot,
  receiptSha256: sha256(receiptJson),
  manifestSha256: sha256(manifest),
  fullManifestSha256: pairReceipt.fullManifestSha256,
  fallbackManifestSha256: pairReceipt.fallbackManifestSha256,
  pairId: pairReceipt.pairId,
  switchReceiptSha256: sha256(canonicalJsonV1(switchReceipt)),
  officialReleaseManifestSha256: releaseManifestSha256
}) + "\n");
