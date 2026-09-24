// Synthetic release identities by default; file records always hash the actual
// supplied app tree. Official-manifest tests supply their verified Git/package anchor.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_RELEASE_RUNTIME_FILE_COUNT, ADMIN_RELEASE_RUNTIME_FILES, ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../../server/admin-service/release-manifest.ts";
import { ADMIN_REVIEW_DATABASE_PATH, AdminDeploymentManifestSchema } from "../../server/admin-service/deployment.ts";
import { PUBLIC_RELEASE_RUNTIME_FILE_COUNT, PUBLIC_RELEASE_RUNTIME_FILES, PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256 } from "../../server/public/release-manifest.ts";
import { activateReleaseCandidate, buildReleasePairReceipt, collectReleaseFiles, fallbackV10Capabilities, fullV10Capabilities, releaseIdForRole, releasePathRoot, releaseSourcePreimageSha256, type ReleaseCandidateManifest } from "../../server/internal-operation/release.ts";
import { canonicalJson } from "../../server/db/profile.ts";
import { SOURCE_REGISTRY_MIGRATION_SHA256, SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 } from "../../server/rss/source-registry-migration.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../../server/x-page/admission-schema-identity.ts";
export const X_RELEASE_TEST_NOW = "2026-09-07T00:00:00.000Z";
export const testReleaseHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function xPageReleasePair(appRoot: string, schemaSha256: string = X_PAGE_ADMISSION_SCHEMA_SHA256,
  official: Readonly<{ gitCommit: string; gitTree: string; releaseRootSha256: string }> = { gitCommit: "a".repeat(40), gitTree: "b".repeat(40), releaseRootSha256: "c".repeat(64) }) {
  const files = collectReleaseFiles(appRoot, [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...PUBLIC_RELEASE_RUNTIME_FILES])]);
  const identity = {
    schemaVersion: 10 as const, sourceCommitSha1: official.gitCommit, sourceTreeSha1: official.gitTree, schemaSha256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256, migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    adminRuntimeFileCount: ADMIN_RELEASE_RUNTIME_FILE_COUNT, adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: PUBLIC_RELEASE_RUNTIME_FILE_COUNT, publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    packageLockSha256: files.find((file) => file.path === "package-lock.json")!.sha256,
    packageRootSha256: official.releaseRootSha256, pathRootSha256: releasePathRoot(files)
  };
  const sourcePreimageSha256 = releaseSourcePreimageSha256(identity), base = { ...identity, sourcePreimageSha256, files };
  const full: ReleaseCandidateManifest = { ...base, role: "full_v10", releaseId: releaseIdForRole("full_v10", sourcePreimageSha256), capabilities: fullV10Capabilities({ schemaSha256 }) };
  const fallback: ReleaseCandidateManifest = { ...base, role: "manual_only_fallback_v10", releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256), capabilities: fallbackV10Capabilities() };
  const receipt = buildReleasePairReceipt(full, fallback, X_RELEASE_TEST_NOW);
  const fullGate = activateReleaseCandidate(full, receipt, X_RELEASE_TEST_NOW, null);
  const fallbackGate = activateReleaseCandidate(fallback, receipt, X_RELEASE_TEST_NOW, fullGate.receipt.activationId);
  const rollbackGate = activateReleaseCandidate(full, receipt, X_RELEASE_TEST_NOW, fallbackGate.receipt.activationId);
  return { full, fallback, receipt, fullGate, fallbackGate, rollbackGate };
}

export function writeXPageReleasePair(root: string, pair: ReturnType<typeof xPageReleasePair>) {
  const files = [["full", pair.full], ["fallback", pair.fallback], ["pair", pair.receipt]] as const;
  for (const [name, value] of files) writeFileSync(join(root, `${name}.json`), canonicalJson(value), { mode: 0o600 });
  return {
    releaseRoot: root, fullManifestPath: join(root, "full.json"), fullManifestSha256: testReleaseHash(canonicalJson(pair.full)),
    fallbackManifestPath: join(root, "fallback.json"), fallbackManifestSha256: testReleaseHash(canonicalJson(pair.fallback)),
    pairReceiptPath: join(root, "pair.json"), pairReceiptSha256: testReleaseHash(canonicalJson(pair.receipt)),
    expectedSourceCommitSha1: pair.full.sourceCommitSha1, expectedSourceTreeSha1: pair.full.sourceTreeSha1,
    expectedPackageRootSha256: pair.full.packageRootSha256, activeRole: "full_v10" as const,
    activatedAt: X_RELEASE_TEST_NOW, previousActivationId: null
  };
}

export function xPageDeploymentFixture(input: Readonly<{ appRoot: string; dataRoot: string; pair: ReturnType<typeof xPageReleasePair>; configPath: string; configSha256: string }>) {
  const paths = writeXPageReleasePair(input.dataRoot, input.pair);
  return AdminDeploymentManifestSchema.parse({
    schemaVersion: "admin-service-deployment-v3", label: "com.f1plus1.admin-service", bindHost: "127.0.0.1", bindPort: 3101,
    canonicalOrigin: "https://f1-admin.example.ts.net", rpName: "F1+1 Admin", operatorRef: "synthetic-operator",
    tailscaleAppCapabilityId: "admin.example.com/cap/f1-admin-device",
    trustedIdentities: [{ login: "owner@example.invalid", operatorRef: "synthetic-operator", sourceRefs: ["A".repeat(43), "B".repeat(43), "C".repeat(43)] }],
    targetReleaseAppRoot: input.appRoot, activeReleaseRole: "full_v10", fullReleaseManifestPath: paths.fullManifestPath, fullReleaseManifestSha256: paths.fullManifestSha256,
    fallbackReleaseManifestPath: paths.fallbackManifestPath, fallbackReleaseManifestSha256: paths.fallbackManifestSha256,
    releasePairReceiptPath: paths.pairReceiptPath, releasePairReceiptSha256: paths.pairReceiptSha256,
    officialReleaseManifestPath: join(input.appRoot, ".local/release/official.json"), officialReleaseManifestSha256: "d".repeat(64),
    reviewDatabasePath: ADMIN_REVIEW_DATABASE_PATH, reviewDatabaseIdentity: { dev: 1, ino: 2, uid: 3, nlink: 1 }, reviewSchemaTarget: 10,
    reviewSchemaSha256: input.pair.full.schemaSha256, rssAutomaticCutoffIso: "2026-09-05T02:30:00.000Z",
    xPageAutomaticCutoffIso: X_RELEASE_TEST_NOW, xPageTrustConfigurationPath: input.configPath, xPageTrustConfigurationSha256: input.configSha256,
    dataRoot: input.dataRoot, staticRoot: join(input.appRoot, "src/admin-ui"), sessionHashKeyPath: join(input.dataRoot, "session-key"), recoveryFencePath: join(input.dataRoot, "recovery.json"),
    publicProjectionRoot: join(input.dataRoot, "public"), projectionSigningKeyId: "synthetic-projection", projectionSigningPrivateKeyPath: join(input.dataRoot, "projection-key.pem"), projectionVerifyKeyPath: join(input.dataRoot, "projection-public.pem"),
    projectionInternalEndpoint: "http://127.0.0.1:3102/internal/projections", publicReadMode: "public-real-snapshot",
    syntheticRollbackRelease: input.pair.fallback.releaseId, syntheticRollbackHash: input.pair.receipt.fallbackManifestSha256,
    projectionSenderServiceIdentity: "synthetic-sender", projectionReceiverServiceIdentity: "synthetic-receiver", preparedAt: X_RELEASE_TEST_NOW, serviceState: "disabled"
  });
}
