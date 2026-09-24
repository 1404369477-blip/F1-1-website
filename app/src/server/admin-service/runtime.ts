import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import {
  inspectExistingPrivateDatabase,
  openExistingSafeDatabase,
  readSqliteRuntime,
  type ExistingDatabaseIdentity
} from "../db/database.ts";
import { ReviewAdminBackend } from "../review-real/backend.ts";
import { ReviewRealRepository } from "../review-real/repository.ts";
import { getInstalledSqliteAuthorizer, installSqliteAuthorizer } from "../internal-operation/authorizer.ts";
import { SqliteInternalOperationGateway, type OwnerProcess, type OwnerSupervisorHandoff } from "../internal-operation/gateway.ts";
import { SqliteGatewayMutationPort, type GatewayMutationPort } from "../internal-operation/mutation-port.ts";
import { loadReleaseRuntimeGate, type ReleaseRuntimeGate } from "../internal-operation/release.ts";
import { ProjectionHttpTransport, ProjectionSender } from "../review-real/sender.ts";
import { ReviewAdminRoutes } from "../review-real/routes.ts";
import { ReviewAdminSecurity, type ReviewRecoveryFence } from "../review-real/security.ts";
import { RSS_DATABASE_PATH } from "../rss/repository.ts";
import { assertBilingualSchema } from "../rss/bilingual-migration.ts";
import { SqliteBilingualGatewayMutationPort } from "../rss/bilingual-gateway-port.ts";
import { assertSourceRegistrySchema, sourceRegistrySchemaFingerprint, SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../rss/source-registry-migration.ts";
import { assertXManualInboxRuntimeSchema, XManualInboxRepository } from "../tweet-inbox/repository.ts";
import { AdminPasskeyAuth } from "./auth.ts";
import { ADMIN_REVIEW_DATABASE_PATH, assertXPageDeploymentTrustConfiguration, type AdminDeploymentManifest } from "./deployment.ts";
import { readVerifiedAdminReleaseManifest } from "./release-manifest.ts";
import { BilingualAdminRepository, BilingualAdminRoutes, Schema9ReadOnlyReviewRoutes, type BilingualManualMutationPort } from "./bilingual-admin.ts";
import { AdminBilingualRetryAdapter, type BilingualRetryFixture } from "./bilingual-retry.ts";
import { AdminBilingualProjectionExporter, AdminBilingualPublicationService } from "./bilingual-projection-exporter.ts";
import { AdminBilingualProjectionWriter } from "./bilingual-projection-writer.ts";
import { createAdminServiceServer, listenAdminService, type TrustedTailnetIdentity } from "./server.ts";
import {
  assertPrivateDirectory,
  assertPrivateFile,
  BootstrapTokenStore,
  PasskeyCredentialStore
} from "./storage.ts";
import { SimpleWebAuthnAdapter } from "./webauthn.ts";
import { RSS_AUTOMATIC_SCHEMA_SHA256 } from "../rss-automatic/schema-identity.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256, isRssAutomaticSchemaSha256 } from "../rss-automatic/source-epoch-schema-identity.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../x-page/admission-schema-identity.ts";
import { runRssAutomaticCycle, type RssAutomaticCycleReceipt } from "../rss-automatic/worker.ts";
import { createRssAutomaticHandoffProvider } from "../rss-automatic/supervisor.ts";
import { createRssAutomaticCursorStore } from "../rss-automatic/cursor.ts";
import { prepareAutomaticDelivery } from "../review-real/automatic-delivery.ts";
import { loadXPageRuntimeTrust } from "../x-page/deployment-trust.ts";
import { createXPageRuntime } from "../x-page/runtime.ts";
import { createAutomaticCoordinator } from "./automatic-coordinator.ts";
import { readRefinementModelConfig, refineModelById } from "../rss/refine-model.ts";
import { refineOneCandidate } from "../rss/refinement.ts";

const RecoveryFenceSchema = z.object({
  schemaVersion: z.literal("admin-recovery-fence-v1"),
  clockTrusted: z.boolean(),
  writerReady: z.boolean(),
  lastSuccessfulRecoveryPointAt: z.number().int().nonnegative().safe().nullable()
}).strict();

// Legacy and fallback releases retain only the existing signed sender.
// RSS automatic work is explicitly registered by the real service runner.
const PROJECTION_SENDER_INTERVAL_MS = 60_000 as const;
export const RSS_AUTOMATIC_INTERVAL_MS = 60_000 as const;

export type AdminRuntimeConfig = Readonly<{
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  reviewDatabaseIdentity: ExistingDatabaseIdentity;
  reviewSchemaTarget?: 10;
  reviewSchemaSha256?: typeof SOURCE_REGISTRY_SCHEMA10_SHA256 | typeof RSS_AUTOMATIC_SCHEMA_SHA256 | typeof RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 | typeof X_PAGE_ADMISSION_SCHEMA_SHA256;
  rssAutomaticCutoffIso?: string;
  xPageAutomaticCutoffIso?: string;
  xPageTrustConfigurationPath?: string;
  xPageTrustConfigurationSha256?: string;
  expectedDeploymentManifestSha256?: string;
  expectedBackupReleaseSha256?: string;
  verifiedRssAutomaticFullManifestSha256?: string;
  verifiedRssAutomaticFallbackManifestSha256?: string;
  dataRoot: string;
  staticRoot: string;
  canonicalOrigin: string;
  rpName: string;
  operatorRef: string;
  tailscaleAppCapabilityId: string;
  trustedIdentities: readonly TrustedTailnetIdentity[];
  sessionHashKeyPath: string;
  recoveryFencePath: string;
  projectionSigningKeyId: string;
  projectionSigningPrivateKeyPath: string;
  projectionInternalEndpoint: "http://127.0.0.1:3102/internal/projections";
  projectionSenderServiceIdentity: string;
  gatewayReleaseSha256?: string;
  gatewayManifestSha256?: string;
  ownerSupervisorHandoffProvider?: () => OwnerSupervisorHandoff;
  bilingualRetryFixture?: BilingualRetryFixture;
  bilingualProjectionRoot?: string;
  releaseGate?: ReleaseRuntimeGate;
}>;

export function adminRuntimeConfigFromDeployment(
  manifest: AdminDeploymentManifest,
  options: Readonly<{
    activatedAt?: string;
    previousActivationId?: string | null;
    bilingualRetryFixture?: BilingualRetryFixture;
    allowDisposableReviewDatabase?: boolean;
    expectedDeploymentManifestSha256?: string;
  }> = {}
): AdminRuntimeConfig {
  if (options.expectedDeploymentManifestSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(options.expectedDeploymentManifestSha256)) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_INVALID");
  if (!options.allowDisposableReviewDatabase && manifest.reviewDatabasePath !== ADMIN_REVIEW_DATABASE_PATH) {
    throw new Error("ADMIN_REVIEW_DATABASE_PATH_INVALID");
  }
  const official = readVerifiedAdminReleaseManifest(
    manifest.targetReleaseAppRoot,
    manifest.officialReleaseManifestPath,
    manifest.officialReleaseManifestSha256
  );
  const loaded = loadReleaseRuntimeGate({
    releaseRoot: manifest.targetReleaseAppRoot,
    fullManifestPath: manifest.fullReleaseManifestPath,
    fullManifestSha256: manifest.fullReleaseManifestSha256,
    fallbackManifestPath: manifest.fallbackReleaseManifestPath,
    fallbackManifestSha256: manifest.fallbackReleaseManifestSha256,
    pairReceiptPath: manifest.releasePairReceiptPath,
    pairReceiptSha256: manifest.releasePairReceiptSha256,
    expectedSourceCommitSha1: official.gitCommit,
    expectedSourceTreeSha1: official.gitTree,
    expectedPackageRootSha256: official.releaseRootSha256,
    activeRole: manifest.activeReleaseRole,
    activatedAt: options.activatedAt ?? new Date().toISOString(),
    previousActivationId: options.previousActivationId ?? null
  });
  if (manifest.reviewSchemaSha256 !== loaded.gate.receipt.schemaSha256) throw new Error("ADMIN_REVIEW_SCHEMA_RELEASE_MISMATCH");
  const rollback = manifest.activeReleaseRole === "full_v10" ? loaded.fallback : loaded.full;
  const rollbackManifestSha256 = manifest.activeReleaseRole === "full_v10"
    ? loaded.pair.fallbackManifestSha256
    : loaded.pair.fullManifestSha256;
  if (
    manifest.syntheticRollbackRelease !== rollback.releaseId ||
    manifest.syntheticRollbackHash !== rollbackManifestSha256
  ) throw new Error("ADMIN_ROLLBACK_RELEASE_IDENTITY_INVALID");
  return Object.freeze({
    targetReleaseAppRoot: manifest.targetReleaseAppRoot,
    reviewDatabasePath: manifest.reviewDatabasePath,
    reviewDatabaseIdentity: manifest.reviewDatabaseIdentity,
    reviewSchemaTarget: manifest.reviewSchemaTarget,
    reviewSchemaSha256: manifest.reviewSchemaSha256,
    rssAutomaticCutoffIso: manifest.rssAutomaticCutoffIso,
    xPageAutomaticCutoffIso: manifest.xPageAutomaticCutoffIso,
    xPageTrustConfigurationPath: manifest.xPageTrustConfigurationPath,
    xPageTrustConfigurationSha256: manifest.xPageTrustConfigurationSha256,
    expectedDeploymentManifestSha256: options.expectedDeploymentManifestSha256,
    expectedBackupReleaseSha256: manifest.fullReleaseManifestSha256,
    verifiedRssAutomaticFullManifestSha256: loaded.pair.fullManifestSha256,
    verifiedRssAutomaticFallbackManifestSha256: loaded.pair.fallbackManifestSha256,
    dataRoot: manifest.dataRoot,
    staticRoot: manifest.staticRoot,
    canonicalOrigin: manifest.canonicalOrigin,
    rpName: manifest.rpName,
    operatorRef: manifest.operatorRef,
    tailscaleAppCapabilityId: manifest.tailscaleAppCapabilityId,
    trustedIdentities: manifest.trustedIdentities,
    sessionHashKeyPath: manifest.sessionHashKeyPath,
    recoveryFencePath: manifest.recoveryFencePath,
    projectionSigningKeyId: manifest.projectionSigningKeyId,
    projectionSigningPrivateKeyPath: manifest.projectionSigningPrivateKeyPath,
    projectionInternalEndpoint: manifest.projectionInternalEndpoint,
    projectionSenderServiceIdentity: manifest.projectionSenderServiceIdentity,
    bilingualProjectionRoot: manifest.publicProjectionRoot,
    bilingualRetryFixture: options.bilingualRetryFixture,
    releaseGate: loaded.gate
  });
}

function readCanonical<T>(path: string, schema: z.ZodType<T>): T {
  assertPrivateFile(path);
  let raw: string;
  let value: unknown;
  try {
    raw = readFileSync(path, "utf8");
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("ADMIN_RUNTIME_FILE_INVALID");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== raw) throw new Error("ADMIN_RUNTIME_FILE_INVALID");
  return parsed.data;
}

function readSessionKey(path: string): Buffer {
  assertPrivateFile(path);
  const raw = readFileSync(path, "utf8");
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new Error("ADMIN_SESSION_KEY_INVALID");
  const key = Buffer.from(raw, "base64url");
  if (key.byteLength !== 32) throw new Error("ADMIN_SESSION_KEY_INVALID");
  return key;
}

function readStoredOwnerHandoff(database: DatabaseSync, ownerProcess: OwnerProcess, releaseSha256: string, manifestSha256: string): OwnerSupervisorHandoff {
  const row = database.prepare(`SELECT handoff_id,one_time_nonce,receipt_sha256,verified_at,expires_at FROM owner_authorization_handoff
    WHERE owner_process=? AND consumed_by_operation_id IS NULL AND release_sha256=? AND manifest_sha256=? AND expires_at>?
    ORDER BY verified_at,handoff_id LIMIT 1`).get(ownerProcess, releaseSha256, manifestSha256, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!row) throw new Error("ADMIN_OWNER_SUPERVISOR_HANDOFF_UNAVAILABLE");
  return Object.freeze({ schemaVersion: "owner-supervisor-handoff-v1", handoffId: String(row.handoff_id), ownerProcess,
    issuer: "f1plus1-owner-supervisor-v1", oneTimeNonce: String(row.one_time_nonce), releaseSha256, manifestSha256,
    receiptSha256: String(row.receipt_sha256), verifiedAt: String(row.verified_at), expiresAt: String(row.expires_at) });
}

export function openReviewAdminDatabase(input: Readonly<{
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  reviewDatabaseIdentity: ExistingDatabaseIdentity;
  gatewayReleaseSha256?: string;
  gatewayManifestSha256?: string;
  ownerSupervisorHandoffProvider?: () => OwnerSupervisorHandoff;
  releaseGate?: ReleaseRuntimeGate;
  ownerProcess?: OwnerProcess;
  requiredSchemaVersion?: 8 | 9 | 10;
  requiredSchemaSha256?: typeof SOURCE_REGISTRY_SCHEMA10_SHA256 | typeof RSS_AUTOMATIC_SCHEMA_SHA256 | typeof RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 | typeof X_PAGE_ADMISSION_SCHEMA_SHA256;
  verifiedRssAutomaticFullManifestSha256?: string;
  verifiedRssAutomaticFallbackManifestSha256?: string;
}>): Readonly<{
  database: DatabaseSync;
  repository: ReviewRealRepository;
  xManualRepository: XManualInboxRepository | null;
  gateway: SqliteInternalOperationGateway | null;
  mutationPort: SqliteGatewayMutationPort | null;
  handoffProvider: (() => OwnerSupervisorHandoff) | null;
}> {
  if (resolve(input.targetReleaseAppRoot) !== input.targetReleaseAppRoot ||
      resolve(input.reviewDatabasePath) !== input.reviewDatabasePath) {
    throw new Error("ADMIN_REVIEW_DATABASE_PATH_INVALID");
  }
  const reviewDatabasePath = resolve(input.reviewDatabasePath);
  const requiredSchemaVersion = input.requiredSchemaVersion ?? 8;
  const database = openExistingSafeDatabase(
    reviewDatabasePath,
    RSS_DATABASE_PATH.split("/").at(-1)!,
    input.reviewDatabaseIdentity,
    [requiredSchemaVersion]
  );
  let gateway: SqliteInternalOperationGateway | null = null;
  try {
    const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    // Migration and preflight remain disposable/bootstrap responsibilities.
    // The bilingual runtime opens only an exact existing schema-9 database;
    // the legacy test/support caller retains an explicit schema-8 default.
    if (version !== requiredSchemaVersion) throw new Error("ADMIN_REVIEW_DATABASE_VERSION_INVALID");
    const requiredSchemaSha256 = input.requiredSchemaSha256 ?? input.releaseGate?.receipt.schemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256;
    if (requiredSchemaVersion === 10) {
      if (![SOURCE_REGISTRY_SCHEMA10_SHA256, RSS_AUTOMATIC_SCHEMA_SHA256, RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256, X_PAGE_ADMISSION_SCHEMA_SHA256].includes(requiredSchemaSha256) ||
        (input.releaseGate !== undefined && input.releaseGate.receipt.schemaSha256 !== requiredSchemaSha256)) throw new Error("ADMIN_REVIEW_SCHEMA_RELEASE_MISMATCH");
      assertSourceRegistrySchema(database);
      const physicalSchema = sourceRegistrySchemaFingerprint(database);
      const exactSuccessorRequired = isRssAutomaticSchemaSha256(requiredSchemaSha256) || requiredSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256;
      const physicalSuccessor = isRssAutomaticSchemaSha256(physicalSchema) || physicalSchema === X_PAGE_ADMISSION_SCHEMA_SHA256;
      if (exactSuccessorRequired ? physicalSchema !== requiredSchemaSha256 : physicalSuccessor) throw new Error("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
    }
    else if (requiredSchemaVersion === 9) assertBilingualSchema(database);
    else {
      // The X boundary is additive across schema 8 -> 10.  Runtime keeps the
      // strict schema-8 assertion for the legacy target and lets the
      // repository perform its pinned legacy-table bridge check for schema 10.
      assertXManualInboxRuntimeSchema(database);
    }
    const installed = getInstalledSqliteAuthorizer(database);
    if (installed === null) installSqliteAuthorizer(database, "worker_or_repository");
    const runtime = readSqliteRuntime(database);
    if (runtime.journalMode !== "wal" || runtime.synchronous !== 2 || runtime.foreignKeys !== 1 || runtime.userVersion !== requiredSchemaVersion) {
      throw new Error("ADMIN_REVIEW_DATABASE_RUNTIME_INVALID");
    }
    const currentIdentity = inspectExistingPrivateDatabase(
      reviewDatabasePath,
      RSS_DATABASE_PATH.split("/").at(-1)!
    );
    if (
      currentIdentity.dev !== input.reviewDatabaseIdentity.dev ||
      currentIdentity.ino !== input.reviewDatabaseIdentity.ino ||
      currentIdentity.uid !== input.reviewDatabaseIdentity.uid ||
      currentIdentity.nlink !== input.reviewDatabaseIdentity.nlink
    ) throw new Error("ADMIN_REVIEW_DATABASE_RECEIPT_MISMATCH");
    const gatedReleaseSha256 = input.releaseGate?.receipt.sourcePreimageSha256;
    const gatedManifestSha256 = input.releaseGate?.receipt.manifestSha256;
    const gatewayReleaseSha256 = gatedReleaseSha256 ?? input.gatewayReleaseSha256;
    const gatewayManifestSha256 = gatedManifestSha256 ?? input.gatewayManifestSha256;
    if (input.releaseGate && (input.gatewayReleaseSha256 !== undefined || input.gatewayManifestSha256 !== undefined || input.ownerSupervisorHandoffProvider !== undefined)) {
      throw new Error("ADMIN_GATEWAY_CONFIG_AMBIGUOUS");
    }
    const gatewayConfigProvided = gatewayReleaseSha256 !== undefined || gatewayManifestSha256 !== undefined || input.ownerSupervisorHandoffProvider !== undefined || input.releaseGate !== undefined;
    const gatewayConfigComplete = gatewayReleaseSha256 !== undefined && gatewayManifestSha256 !== undefined && (input.ownerSupervisorHandoffProvider !== undefined || input.releaseGate !== undefined);
    if (gatewayConfigProvided && !gatewayConfigComplete) throw new Error("ADMIN_GATEWAY_CONFIG_INCOMPLETE");
    if (requiredSchemaVersion === 9 && gatewayConfigProvided) throw new Error("BILINGUAL_AUTHORITY_EXTENSION_REQUIRED");
    gateway = gatewayConfigComplete
      ? new SqliteInternalOperationGateway({
          database,
          releaseSha256: gatewayReleaseSha256!,
          manifestSha256: gatewayManifestSha256!,
          schemaSha256: requiredSchemaVersion === 10 ? requiredSchemaSha256 : undefined,
          verifiedRssAutomaticFullManifestSha256: isRssAutomaticSchemaSha256(requiredSchemaSha256) || requiredSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256 ? input.verifiedRssAutomaticFullManifestSha256 : undefined,
          verifiedRssAutomaticFallbackManifestSha256: isRssAutomaticSchemaSha256(requiredSchemaSha256) || requiredSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256 ? input.verifiedRssAutomaticFallbackManifestSha256 : undefined
        })
      : null;
    const databaseHandoffProvider = input.releaseGate === undefined ? undefined : () =>
      readStoredOwnerHandoff(database, input.ownerProcess ?? "admin_http", gatewayReleaseSha256!, gatewayManifestSha256!);
    const handoffProvider = input.ownerSupervisorHandoffProvider ?? databaseHandoffProvider;
    if (input.releaseGate && !isRssAutomaticSchemaSha256(requiredSchemaSha256) && requiredSchemaSha256 !== X_PAGE_ADMISSION_SCHEMA_SHA256) handoffProvider!();
    const mutationPort = gateway === null ? null : new SqliteGatewayMutationPort({
      database,
      gateway,
      ownerProcess: input.ownerProcess ?? "admin_http",
      handoffProvider: handoffProvider!
    });
    const xManualRepository = requiredSchemaVersion === 8 || requiredSchemaVersion === 10
      ? new XManualInboxRepository(database, mutationPort ?? undefined)
      : null;
    return {
      database,
      repository: new ReviewRealRepository(database, () => new Date(), mutationPort ?? undefined),
      xManualRepository,
      gateway,
      mutationPort,
      handoffProvider: handoffProvider ?? null
    };
  } catch (error) {
    try { gateway?.close(); } catch { /* preserve the original opener failure */ }
    database.close();
    throw error;
  }
}

/** One synchronous deployment-owned import. It opens only the existing database
 * and supervisor; no HTTP listener, automatic cycle or external transport runs. */
export function runXPageCaptureImport(config: AdminRuntimeConfig, captureSha256: string) {
  if (!/^[0-9a-f]{64}$/u.test(captureSha256)) throw new Error("X_PAGE_IMPORT_CAPTURE_HASH_INVALID");
  if (config.reviewSchemaTarget !== 10 || config.reviewSchemaSha256 !== X_PAGE_ADMISSION_SCHEMA_SHA256
    || config.releaseGate?.receipt.schemaSha256 !== X_PAGE_ADMISSION_SCHEMA_SHA256
    || config.releaseGate.receipt.role !== "full_v10"
    || !config.releaseGate.allows("automatic_review") || !config.releaseGate.allows("automatic_publish")) throw new Error("ADMIN_X_PAGE_AUTOMATIC_RELEASE_CLOSED");
  for (const cutoff of [config.rssAutomaticCutoffIso, config.xPageAutomaticCutoffIso]) {
    if (cutoff === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cutoff)
      || !Number.isFinite(Date.parse(cutoff))) throw new Error("ADMIN_X_PAGE_AUTOMATIC_CUTOFF_INVALID");
  }
  if (!/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "")
    || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_INVALID");
  // The CLI's verified release-pair factory supplies both identities. The
  // active full identity must also agree with the gate used for this import.
  if (config.verifiedRssAutomaticFullManifestSha256 !== config.releaseGate.receipt.manifestSha256
    || !/^[0-9a-f]{64}$/u.test(config.verifiedRssAutomaticFallbackManifestSha256 ?? "")
    || config.verifiedRssAutomaticFallbackManifestSha256 === config.verifiedRssAutomaticFullManifestSha256) throw new Error("ADMIN_X_PAGE_RELEASE_PAIR_IDENTITY_INVALID");
  assertXPageDeploymentTrustConfiguration({ ...config, reviewSchemaSha256: config.reviewSchemaSha256 });
  const privateDir = join(resolve(config.dataRoot), "private");
  assertPrivateDirectory(resolve(config.dataRoot));
  assertPrivateDirectory(privateDir);
  const runtime = openReviewAdminDatabase({ ...config, ownerProcess: "x_page_importer",
    requiredSchemaVersion: 10, requiredSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 });
  let supervisorDatabase: DatabaseSync | undefined;
  try {
    if (!runtime.gateway) throw new Error("ADMIN_GATEWAY_CONFIG_INCOMPLETE");
    supervisorDatabase = openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
    const xPage = createXPageRuntime({ database: runtime.database, gateway: runtime.gateway, supervisorDatabase, releaseGate: config.releaseGate,
      expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256!,
      configurationPath: config.xPageTrustConfigurationPath!, expectedConfigurationSha256: config.xPageTrustConfigurationSha256!,
      releaseAppRoot: config.targetReleaseAppRoot, privateDir, cutoffIso: config.xPageAutomaticCutoffIso! });
    return xPage.importCapture(captureSha256);
  } finally {
    try { supervisorDatabase?.close(); }
    finally { try { runtime.gateway?.close(); } finally { runtime.database.close(); } }
  }
}

export function createReviewAdminRuntime(config: AdminRuntimeConfig): Readonly<{
  server: ReturnType<typeof createAdminServiceServer>;
  database: DatabaseSync;
  repository: ReviewRealRepository;
  xManualRepository: XManualInboxRepository | null;
  sender: ProjectionSender;
  gateway: SqliteInternalOperationGateway | null;
  closeBackgroundResources(): void;
  manualBilingualEnabled: boolean;
}> {
  const dataRoot = resolve(config.dataRoot);
  const automaticSchema = isRssAutomaticSchemaSha256(config.reviewSchemaSha256 ?? "") || config.reviewSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256;
  if (
    (config.reviewSchemaTarget !== undefined && config.reviewSchemaTarget !== 10) ||
    (config.reviewSchemaSha256 !== undefined && config.reviewSchemaSha256 !== SOURCE_REGISTRY_SCHEMA10_SHA256 && !automaticSchema)
  ) throw new Error("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
  if (config.releaseGate !== undefined && (config.reviewSchemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256) !== config.releaseGate.receipt.schemaSha256) throw new Error("ADMIN_REVIEW_SCHEMA_RELEASE_MISMATCH");
  if (automaticSchema !== (config.rssAutomaticCutoffIso !== undefined) ||
    (config.rssAutomaticCutoffIso !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(config.rssAutomaticCutoffIso) || !Number.isFinite(Date.parse(config.rssAutomaticCutoffIso))))) throw new Error("ADMIN_RSS_AUTOMATIC_CUTOFF_INVALID");
  const xPageSchema = config.reviewSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256;
  if (xPageSchema !== (config.xPageAutomaticCutoffIso !== undefined) ||
    (config.xPageAutomaticCutoffIso !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(config.xPageAutomaticCutoffIso) || !Number.isFinite(Date.parse(config.xPageAutomaticCutoffIso))))) throw new Error("ADMIN_X_PAGE_AUTOMATIC_CUTOFF_INVALID");
  assertXPageDeploymentTrustConfiguration({ ...config, reviewSchemaSha256: config.reviewSchemaSha256 ?? SOURCE_REGISTRY_SCHEMA10_SHA256 });
  if (xPageSchema) loadXPageRuntimeTrust({ configurationPath: config.xPageTrustConfigurationPath!, expectedConfigurationSha256: config.xPageTrustConfigurationSha256!,
    expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256 ?? "", releaseAppRoot: config.targetReleaseAppRoot });
  assertPrivateDirectory(dataRoot);
  const origin = new URL(config.canonicalOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    config.projectionSigningKeyId.length < 1 ||
    config.projectionSigningKeyId.length > 256 ||
    (config.bilingualProjectionRoot !== undefined && resolve(config.bilingualProjectionRoot) !== config.bilingualProjectionRoot) ||
    config.projectionInternalEndpoint !== "http://127.0.0.1:3102/internal/projections"
  ) {
    throw new Error("ADMIN_RUNTIME_CONFIG_INVALID");
  }
  const sessionHashKey = readSessionKey(config.sessionHashKeyPath);
  const readRecoveryFence = (): ReviewRecoveryFence => {
    const fence = readCanonical(config.recoveryFencePath, RecoveryFenceSchema);
    return {
      clockTrusted: fence.clockTrusted,
      writerReady: fence.writerReady,
      lastSuccessfulRecoveryPointAt: fence.lastSuccessfulRecoveryPointAt
    };
  };
  const security = new ReviewAdminSecurity({
    canonicalOrigin: origin.origin,
    sessionHashKey,
    readRecoveryFence
  });
  sessionHashKey.fill(0);
  assertPrivateFile(config.projectionSigningPrivateKeyPath);
  const privateKey = createPrivateKey(readFileSync(config.projectionSigningPrivateKeyPath, "utf8"));
  const opened = openReviewAdminDatabase({
    targetReleaseAppRoot: config.targetReleaseAppRoot,
    reviewDatabasePath: config.reviewDatabasePath,
    reviewDatabaseIdentity: config.reviewDatabaseIdentity,
    requiredSchemaVersion: config.reviewSchemaTarget ?? 10,
    requiredSchemaSha256: config.reviewSchemaSha256,
    verifiedRssAutomaticFullManifestSha256: config.verifiedRssAutomaticFullManifestSha256,
    verifiedRssAutomaticFallbackManifestSha256: config.verifiedRssAutomaticFallbackManifestSha256,
    gatewayReleaseSha256: config.gatewayReleaseSha256,
    gatewayManifestSha256: config.gatewayManifestSha256,
    ownerSupervisorHandoffProvider: config.ownerSupervisorHandoffProvider,
    releaseGate: config.releaseGate
  });
  const { database, repository, xManualRepository, gateway } = opened;
  try {
    const backend = new ReviewAdminBackend(repository, security);
    let senderSupervisorDatabase: DatabaseSync | undefined;
    let senderHandoffProvider: (() => OwnerSupervisorHandoff) | undefined;
    let deliveryHandoffProvider: (() => OwnerSupervisorHandoff) | undefined;
    let xDeliveryHandoffProvider: (() => OwnerSupervisorHandoff) | undefined;
    let reconcilerHandoffProvider: (() => OwnerSupervisorHandoff) | undefined;
    let backgroundResourcesClosed = false;
    const closeBackgroundResources = (): void => {
      if (backgroundResourcesClosed) return;
      backgroundResourcesClosed = true;
      senderSupervisorDatabase?.close();
    };
    const senderPort = gateway === null ? null : new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "projection_sender",
      handoffProvider: () => {
        if (backgroundResourcesClosed) throw new Error("ADMIN_BACKGROUND_RESOURCES_CLOSED");
        if (automaticSchema) {
          if (senderHandoffProvider === undefined) {
            if (config.releaseGate === undefined || !/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "") || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_REQUIRED");
            senderSupervisorDatabase ??= openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
            senderHandoffProvider = createRssAutomaticHandoffProvider({ supervisorDatabase: senderSupervisorDatabase, releaseGate: config.releaseGate,
              ownerProcess: "projection_sender", expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! });
          }
          return senderHandoffProvider();
        }
        return readStoredOwnerHandoff(database, "projection_sender", config.releaseGate?.receipt.sourcePreimageSha256 ?? config.gatewayReleaseSha256!, config.releaseGate?.receipt.manifestSha256 ?? config.gatewayManifestSha256!);
      }
    });
    const senderRepository = senderPort === null ? repository : new ReviewRealRepository(database, () => new Date(), senderPort);
    const deliverySupervisorPort = gateway === null || !automaticSchema ? null : new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "system_supervisor",
      handoffProvider: () => {
        if (backgroundResourcesClosed) throw new Error("ADMIN_BACKGROUND_RESOURCES_CLOSED");
        if (deliveryHandoffProvider === undefined) {
          if (config.releaseGate === undefined || !/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "") || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_REQUIRED");
          senderSupervisorDatabase ??= openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
          deliveryHandoffProvider = createRssAutomaticHandoffProvider({ supervisorDatabase: senderSupervisorDatabase, releaseGate: config.releaseGate,
            ownerProcess: "system_supervisor", purpose: "committed_projection_delivery", expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! });
        }
        return deliveryHandoffProvider();
      }
    });
    const xDeliverySupervisorPort = gateway === null || !xPageSchema ? null : new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "system_supervisor",
      handoffProvider: () => {
        if (backgroundResourcesClosed) throw new Error("ADMIN_BACKGROUND_RESOURCES_CLOSED");
        if (xDeliveryHandoffProvider === undefined) {
          if (config.releaseGate === undefined || !/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "") || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_REQUIRED");
          senderSupervisorDatabase ??= openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
          xDeliveryHandoffProvider = createRssAutomaticHandoffProvider({ supervisorDatabase: senderSupervisorDatabase, releaseGate: config.releaseGate,
            ownerProcess: "system_supervisor", purpose: "x_page_committed_projection_delivery", expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! });
        }
        return xDeliveryHandoffProvider();
      }
    });
    const reconcilerPort = gateway === null || !automaticSchema ? null : new SqliteGatewayMutationPort({ database, gateway, ownerProcess: "reconciler",
      handoffProvider: () => {
        if (backgroundResourcesClosed) throw new Error("ADMIN_BACKGROUND_RESOURCES_CLOSED");
        if (reconcilerHandoffProvider === undefined) {
          if (config.releaseGate === undefined || !/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "") || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_REQUIRED");
          senderSupervisorDatabase ??= openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
          reconcilerHandoffProvider = createRssAutomaticHandoffProvider({ supervisorDatabase: senderSupervisorDatabase, releaseGate: config.releaseGate,
            ownerProcess: "reconciler", purpose: "committed_projection_delivery", expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! });
        }
        return reconcilerHandoffProvider();
      }
    });
    const sender = new ProjectionSender({
      repository: senderRepository,
      transport: new ProjectionHttpTransport({
        endpoint: config.projectionInternalEndpoint,
        serviceIdentity: config.projectionSenderServiceIdentity
      }),
      signingKeyId: config.projectionSigningKeyId,
      privateKey,
      actorRef: config.projectionSenderServiceIdentity,
      externalAttempt: senderPort?.runExternal.bind(senderPort),
      externalReconcile: reconcilerPort?.runProjectionReconcile.bind(reconcilerPort) ?? senderPort?.runReconcile.bind(senderPort),
      prepareDeliveryAuthority: deliverySupervisorPort === null || gateway === null ? undefined : () => {
        if (backgroundResourcesClosed) throw new Error("ADMIN_BACKGROUND_RESOURCES_CLOSED");
        prepareAutomaticDelivery({ database, gateway, rssSupervisorPort: deliverySupervisorPort, xPageSupervisorPort: xDeliverySupervisorPort ?? undefined });
      }
    });
    const legacyReviewRoutes = new ReviewAdminRoutes(backend, security, xManualRepository);
    const runtimeGate = config.releaseGate;
    const runManual = <T>(callback: () => T): T => runtimeGate ? runtimeGate.run("manual_safety_review_publish_withdraw", callback) : callback();
    const runOutbox = <T>(callback: () => T): T => runtimeGate ? runtimeGate.run("manual_outbox_create", callback) : callback();
    const runLkg = <T>(callback: () => T): T => runtimeGate ? runtimeGate.run("public_lkg", callback) : callback();
    const manualPort: BilingualManualMutationPort | undefined = opened.mutationPort !== null && gateway !== null && opened.handoffProvider !== null
      ? Object.freeze({
          ...(config.bilingualProjectionRoot ? (() => {
            const releaseSha256 = runtimeGate?.receipt.sourcePreimageSha256 ?? config.gatewayReleaseSha256!;
            const manifestSha256 = runtimeGate?.receipt.manifestSha256 ?? config.gatewayManifestSha256!;
            const service = new AdminBilingualPublicationService(database, new AdminBilingualProjectionWriter(database, opened.mutationPort!), new AdminBilingualProjectionExporter(database, resolve(config.bilingualProjectionRoot), config.projectionSigningKeyId, privateKey), releaseSha256, manifestSha256);
            return {
              publish: (...args: Parameters<typeof service.publish>) => runManual(() => runOutbox(() => runLkg(() => service.publish(...args)))),
              withdraw: (...args: Parameters<typeof service.withdraw>) => runManual(() => runOutbox(() => runLkg(() => service.withdraw(...args))))
            };
          })() : {}),
          ...(config.bilingualRetryFixture ? {
            retryLanguage: async (authorization: Parameters<NonNullable<BilingualManualMutationPort["retryLanguage"]>>[0], input: Parameters<NonNullable<BilingualManualMutationPort["retryLanguage"]>>[1]) => {
              if (runtimeGate) {
                runtimeGate.run("retry_model_call", () => undefined);
                runtimeGate.run("model_network", () => undefined);
              }
              const activation = database.prepare("SELECT updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id='bilingual_auto_refine' AND state='enabled'").get() as Record<string, unknown> | undefined;
              if (!activation || typeof activation.updated_by_operation_id !== "string" || typeof activation.authority_receipt_sha256 !== "string") throw new Error("BILINGUAL_AUTO_AUTHORITY_INVALID");
              const port = new SqliteBilingualGatewayMutationPort({ database, gateway, handoffProvider: () => opened.handoffProvider!(), activation: { operationId: activation.updated_by_operation_id, receiptSha256: activation.authority_receipt_sha256 } });
              return await new AdminBilingualRetryAdapter(database, port, config.bilingualRetryFixture!).retryLanguage(authorization, input);
            }
          } : {}),
          commitApproval: (authorization, input) => runManual(() => opened.mutationPort!.commitBilingualApproval(authorization, input)),
          commitSafetyDecision: (authorization, input) => runManual(() => {
            const receipt = opened.mutationPort!.commitBilingualSafetyDecision(authorization, input);
            if (input.action !== "clear") return Object.freeze({ receipt, bundle: null });
            const activation = database.prepare(
              "SELECT updated_by_operation_id,authority_receipt_sha256 FROM quick_launch_authority_v2 WHERE capability_id='bilingual_manual_mutation' AND state='enabled'",
            ).get() as Record<string, unknown> | undefined;
            if (activation === undefined || typeof activation.updated_by_operation_id !== "string" || typeof activation.authority_receipt_sha256 !== "string") {
              throw new Error("BILINGUAL_MANUAL_AUTHORITY_INVALID");
            }
            const materializer = new SqliteBilingualGatewayMutationPort({
              database,
              gateway,
              handoffProvider: () => opened.handoffProvider!(),
              activation: { operationId: activation.updated_by_operation_id, receiptSha256: activation.authority_receipt_sha256 }
            });
            return Object.freeze({ receipt, bundle: materializer.materializeReviewableBundleAfterSafetyDecision(receipt) });
          })
        })
      : undefined;
    const bilingualRepository = new BilingualAdminRepository(database, () => manualPort !== undefined);
    const reviewRoutes = new Schema9ReadOnlyReviewRoutes(
      legacyReviewRoutes,
      security,
      () => opened.mutationPort !== null && bilingualRepository.capability().enabled
    );
    const bilingualRoutes = new BilingualAdminRoutes(
      bilingualRepository,
      security,
      opened.mutationPort ?? undefined,
      manualPort,
      join(dataRoot, "private"),
      undefined,
      () => config.releaseGate?.allows("model_network") === true
    );
    const credentialStore = new PasskeyCredentialStore(dataRoot);
    const bootstrapStore = new BootstrapTokenStore(dataRoot);
    const auth = new AdminPasskeyAuth({
      credentialStore,
      bootstrapStore,
      security,
      webauthn: new SimpleWebAuthnAdapter(),
      canonicalOrigin: origin.origin,
      rpName: config.rpName,
      operatorRef: config.operatorRef
    });
    const server = createAdminServiceServer({
      canonicalOrigin: origin.origin,
      tailscaleAppCapabilityId: config.tailscaleAppCapabilityId,
      trustedIdentities: config.trustedIdentities,
      auth,
      reviewRoutes,
      bilingualRoutes,
      security,
      projectionDeliveryReceipt: (deliveryId) => repository.deliveryReceipt(deliveryId),
      staticRoot: config.staticRoot
    });
    return { server, database, repository, xManualRepository, sender, gateway, closeBackgroundResources, manualBilingualEnabled: manualPort !== undefined && bilingualRepository.capability().enabled };
  } catch (error) {
    gateway?.close();
    database.close();
    throw error;
  }
}

export function rssAutomaticRuntimeEnabled(config: Pick<AdminRuntimeConfig, "reviewSchemaSha256" | "releaseGate" | "rssAutomaticCutoffIso">): boolean {
  const gate = config.releaseGate;
  return gate !== undefined && (isRssAutomaticSchemaSha256(config.reviewSchemaSha256 ?? "") || config.reviewSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256) &&
    gate.receipt.schemaSha256 === config.reviewSchemaSha256 && gate.receipt.role === "full_v10" &&
    typeof config.rssAutomaticCutoffIso === "string" && Number.isFinite(Date.parse(config.rssAutomaticCutoffIso)) &&
    gate.allows("automatic_review") && gate.allows("automatic_publish") && gate.allows("model_network");
}

function assertAutomaticRuntime(config: AdminRuntimeConfig, runtime: Pick<ReturnType<typeof createReviewAdminRuntime>, "database" | "gateway">): void {
  if (!rssAutomaticRuntimeEnabled(config) || runtime.gateway === null || runtime.gateway.expectedSchemaSha256() !== config.reviewSchemaSha256) throw new Error("ADMIN_RSS_AUTOMATIC_RELEASE_CLOSED");
  if (!/^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256 ?? "") || !/^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256 ?? "")) throw new Error("ADMIN_DEPLOYMENT_IDENTITY_REQUIRED");
}
function rssAutomaticRunner(config: AdminRuntimeConfig, runtime: Pick<ReturnType<typeof createReviewAdminRuntime>, "database" | "gateway">, supervisorDatabase: DatabaseSync) {
    const gate = config.releaseGate!;
    const port = (ownerProcess: Parameters<typeof createRssAutomaticHandoffProvider>[0]["ownerProcess"]) => new SqliteGatewayMutationPort({
      database: runtime.database, gateway: runtime.gateway!, ownerProcess,
      handoffProvider: createRssAutomaticHandoffProvider({ supervisorDatabase, releaseGate: gate, ownerProcess, expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! })
    });
    const supervisorPort = port("system_supervisor");
    const refinerPort = port("rss_refiner");
    const reviewer = new ReviewRealRepository(runtime.database, () => new Date(), port("automatic_reviewer"));
    const publisher = new ReviewRealRepository(runtime.database, () => new Date(), port("automatic_publisher"));
    const privateDir = join(resolve(config.dataRoot), "private");
    const cursorStore = createRssAutomaticCursorStore({ privateDir });
    return async (): Promise<RssAutomaticCycleReceipt> => {
      if (!rssAutomaticRuntimeEnabled(config)) throw new Error("ADMIN_RSS_AUTOMATIC_RELEASE_CLOSED");
        const model = readRefinementModelConfig(join(privateDir, "refinement-model.json"));
        const apiKeyPath = join(privateDir, refineModelById(model.modelId).keyFileName);
        return await runRssAutomaticCycle({ database: runtime.database, gateway: runtime.gateway!, supervisorPort, reviewer, publisher,
          cutoffIso: config.rssAutomaticCutoffIso!, cursorStore, limit: 5,
          refine: target => {
            if (!rssAutomaticRuntimeEnabled(config)) throw new Error("ADMIN_RSS_AUTOMATIC_RELEASE_CLOSED");
            return refineOneCandidate({ database: runtime.database, mutationPort: refinerPort, target, apiKeyPath, modelId: model.modelId, budgetAccountId: "acct-rss" });
          }
        });
    };
}

/** Legacy RSS-only caller; close drains an in-flight model operation. */
export function createRssAutomaticRuntime(config: AdminRuntimeConfig, runtime: Pick<ReturnType<typeof createReviewAdminRuntime>, "database" | "gateway">): Readonly<{
  tick(): Promise<RssAutomaticCycleReceipt>; close(): Promise<void>;
}> {
  assertAutomaticRuntime(config, runtime);
  const supervisorDatabase = openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
  try {
    const run = rssAutomaticRunner(config, runtime, supervisorDatabase);
    let pending: Promise<RssAutomaticCycleReceipt> | null = null, closing = false, closed: Promise<void> | undefined;
    return Object.freeze({ tick: () => {
      if (closing) return Promise.reject(new Error("ADMIN_RSS_AUTOMATIC_RELEASE_CLOSED"));
      pending ??= run().finally(() => { pending = null; }); return pending;
    }, close: () => {
      if (closed) return closed; closing = true;
      if (pending === null) { supervisorDatabase.close(); return closed = Promise.resolve(); }
      closed = Promise.resolve(pending).then(() => undefined, () => undefined).then(() => { supervisorDatabase.close(); }); return closed;
    } });
  } catch (error) { supervisorDatabase.close(); throw error; }
}

/** Actual service factory retains RSS and adds X through one fair coordinator. */
export function createAdminAutomaticRuntime(config: AdminRuntimeConfig, runtime: Pick<ReturnType<typeof createReviewAdminRuntime>, "database" | "gateway">) {
  if (config.reviewSchemaSha256 !== X_PAGE_ADMISSION_SCHEMA_SHA256) return createRssAutomaticRuntime(config, runtime);
  assertAutomaticRuntime(config, runtime);
  const supervisorDatabase = openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
  try {
    const privateDir = join(resolve(config.dataRoot), "private");
    const xPage = createXPageRuntime({ database: runtime.database, gateway: runtime.gateway!, supervisorDatabase, releaseGate: config.releaseGate!,
      expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256!,
      configurationPath: config.xPageTrustConfigurationPath!, expectedConfigurationSha256: config.xPageTrustConfigurationSha256!,
      releaseAppRoot: config.targetReleaseAppRoot, privateDir, cutoffIso: config.xPageAutomaticCutoffIso! });
    return createAutomaticCoordinator({ database: runtime.database, privateDir, schemaSha256: config.reviewSchemaSha256,
      rssCutoffIso: config.rssAutomaticCutoffIso!, xPageCutoffIso: config.xPageAutomaticCutoffIso!,
      rss: rssAutomaticRunner(config, runtime, supervisorDatabase), xPage: xPage.tick, closeResources: () => supervisorDatabase.close() });
  } catch (error) { supervisorDatabase.close(); throw error; }
}

type AutomaticBackgroundRuntime = Readonly<{ tick(): Promise<unknown>; close(): void | Promise<void> }>;

/** One sender and at most one automatic cycle. Stop drains both before releasing storage. */
export function startAdminBackgroundTasks(input: Readonly<{
  senderTick(): Promise<unknown>;
  automaticEnabled: boolean;
  createAutomatic(): AutomaticBackgroundRuntime;
  reportFailure?(task: "sender" | "rss_automatic"): void;
}>): Readonly<{ automaticReviewRegistrations: 0 | 1; automaticPublishRegistrations: 0 | 1; stop(): Promise<void> }> {
  const automatic = input.automaticEnabled ? input.createAutomatic() : null;
  let stopping = false;
  let stoppingPromise: Promise<void> | undefined;
  const jobs = [
    { name: "sender" as const, tick: input.senderTick, intervalMs: PROJECTION_SENDER_INTERVAL_MS, pending: null as Promise<unknown> | null },
    ...(automatic === null ? [] : [{ name: "rss_automatic" as const, tick: () => automatic.tick(), intervalMs: RSS_AUTOMATIC_INTERVAL_MS, pending: null as Promise<unknown> | null }])
  ];
  const tick = (job: typeof jobs[number]): void => {
    if (stopping || job.pending !== null) return;
    job.pending = Promise.resolve().then(() => stopping ? undefined : job.tick()).catch(() => {
      try { input.reportFailure?.(job.name); } catch { /* reporting cannot strand the running-task guard */ }
    }).finally(() => { job.pending = null; });
  };
  const intervals = jobs.map(job => { const interval = setInterval(() => tick(job), job.intervalMs); interval.unref(); return interval; });
  for (const job of jobs) tick(job);
  return Object.freeze({
    automaticReviewRegistrations: automatic === null ? 0 : 1,
    automaticPublishRegistrations: automatic === null ? 0 : 1,
    stop: () => {
      if (stoppingPromise !== undefined) return stoppingPromise;
      stopping = true;
      for (const interval of intervals) clearInterval(interval);
      // Signal the coordinator immediately so its in-flight lane cannot start
      // another lane after stop. Its close promise drains before storage closes.
      let automaticClosing: Promise<void>;
      try { automaticClosing = Promise.resolve(automatic?.close()); }
      catch (error) { automaticClosing = Promise.reject(error); }
      stoppingPromise = Promise.allSettled([...jobs.map(job => job.pending), automaticClosing]).then(results => {
        const closed = results.at(-1)!;
        if (closed.status === "rejected") throw closed.reason;
      });
      return stoppingPromise;
    }
  });
}

export async function runReviewAdminRuntime(config: AdminRuntimeConfig): Promise<void> {
  const runtime = createReviewAdminRuntime(config);
  let stop: (() => void) | undefined;
  let stopRequested = false;
  const stopped = new Promise<void>((resolve) => { stop = resolve; });
  const requestStop = (): void => { stopRequested = true; stop?.(); };
  let tasks: ReturnType<typeof startAdminBackgroundTasks> | undefined;
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    await listenAdminService(runtime.server);
    if (!stopRequested) tasks = startAdminBackgroundTasks({
      automaticEnabled: rssAutomaticRuntimeEnabled(config),
      senderTick: () => config.releaseGate ? config.releaseGate.run("delivery_sender", () => runtime.sender.tick()) : runtime.sender.tick(),
      createAutomatic: () => {
        const automatic = createAdminAutomaticRuntime(config, runtime);
        return { close: automatic.close, tick: async () => {
          const result = await automatic.tick();
          if (result.status !== "idle") process.stdout.write(`${JSON.stringify({ event: result.schemaVersion === "automatic-coordinator-cycle-v1" ? "automatic_coordinator_cycle" : "rss_automatic_cycle", status: result.status,
            reasonCode: result.reasonCode, ...(result.schemaVersion === "automatic-coordinator-cycle-v1" ? { cycles: result.cycles } : { considered: result.considered, refined: result.refined, approved: result.approved, published: result.published }) })}\n`);
          return result;
        } };
      },
      reportFailure: task => { process.stderr.write(`${JSON.stringify({ event: "admin_background_task_failed", task, reasonCode: "BACKGROUND_TASK_FAILED" })}\n`); }
    });
    await stopped;
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    const draining = tasks?.stop();
    try {
      if (runtime.server.listening) {
        await new Promise<void>((resolveClose, rejectClose) => {
          runtime.server.close((error) => error ? rejectClose(error) : resolveClose());
          runtime.server.closeAllConnections();
        });
      }
    } finally {
      try { await draining; }
      finally { try { runtime.closeBackgroundResources(); } finally { try { runtime.gateway?.close(); } finally { runtime.database.close(); } } }
    }
  }
}
