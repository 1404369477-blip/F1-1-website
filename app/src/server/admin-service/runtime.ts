import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { assertSourceRegistrySchema, SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../rss/source-registry-migration.ts";
import { assertXManualInboxRuntimeSchema, XManualInboxRepository } from "../tweet-inbox/repository.ts";
import { AdminPasskeyAuth } from "./auth.ts";
import { ADMIN_REVIEW_DATABASE_PATH, type AdminDeploymentManifest } from "./deployment.ts";
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

const RecoveryFenceSchema = z.object({
  schemaVersion: z.literal("admin-recovery-fence-v1"),
  clockTrusted: z.boolean(),
  writerReady: z.boolean(),
  lastSuccessfulRecoveryPointAt: z.number().int().nonnegative().safe().nullable()
}).strict();

// The only periodic callback owned by the Admin server is the signed
// projection sender. Automatic review and automatic publish have no runtime
// registration or startup invocation in the quick-launch release. Keep this
// interval named so release observers can distinguish the allowed sender
// schedule from the two forbidden automation producers.
const PROJECTION_SENDER_INTERVAL_MS = 60_000 as const;

export type AdminRuntimeConfig = Readonly<{
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  reviewDatabaseIdentity: ExistingDatabaseIdentity;
  reviewSchemaTarget?: 10;
  reviewSchemaSha256?: typeof SOURCE_REGISTRY_SCHEMA10_SHA256;
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
  }> = {}
): AdminRuntimeConfig {
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
    if (requiredSchemaVersion === 10) assertSourceRegistrySchema(database);
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
          schemaSha256: requiredSchemaVersion === 10 ? SOURCE_REGISTRY_SCHEMA10_SHA256 : undefined
        })
      : null;
    const databaseHandoffProvider = input.releaseGate === undefined ? undefined : (): OwnerSupervisorHandoff => {
      const current = new Date().toISOString();
      const ownerProcess = input.ownerProcess ?? "admin_http";
      const row = database.prepare(`SELECT handoff_id,owner_process,issuer,one_time_nonce,release_sha256,manifest_sha256,receipt_sha256,verified_at,expires_at
        FROM owner_authorization_handoff
        WHERE owner_process=? AND consumed_by_operation_id IS NULL AND release_sha256=? AND manifest_sha256=? AND expires_at>?
        ORDER BY verified_at,handoff_id LIMIT 1`).get(ownerProcess, gatewayReleaseSha256!, gatewayManifestSha256!, current) as Record<string, unknown> | undefined;
      if (!row) throw new Error("ADMIN_OWNER_SUPERVISOR_HANDOFF_UNAVAILABLE");
      return Object.freeze({
        schemaVersion: "owner-supervisor-handoff-v1" as const,
        handoffId: String(row.handoff_id),
        ownerProcess,
        issuer: "f1plus1-owner-supervisor-v1" as const,
        oneTimeNonce: String(row.one_time_nonce),
        releaseSha256: String(row.release_sha256),
        manifestSha256: String(row.manifest_sha256),
        receiptSha256: String(row.receipt_sha256),
        verifiedAt: String(row.verified_at),
        expiresAt: String(row.expires_at)
      });
    };
    const handoffProvider = input.ownerSupervisorHandoffProvider ?? databaseHandoffProvider;
    if (input.releaseGate) handoffProvider!();
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

export function createReviewAdminRuntime(config: AdminRuntimeConfig): Readonly<{
  server: ReturnType<typeof createAdminServiceServer>;
  database: DatabaseSync;
  repository: ReviewRealRepository;
  xManualRepository: XManualInboxRepository | null;
  sender: ProjectionSender;
  gateway: SqliteInternalOperationGateway | null;
  manualBilingualEnabled: boolean;
}> {
  const dataRoot = resolve(config.dataRoot);
  if (
    (config.reviewSchemaTarget !== undefined && config.reviewSchemaTarget !== 10) ||
    (config.reviewSchemaSha256 !== undefined && config.reviewSchemaSha256 !== SOURCE_REGISTRY_SCHEMA10_SHA256)
  ) throw new Error("ADMIN_REVIEW_SCHEMA_IDENTITY_INVALID");
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
    gatewayReleaseSha256: config.gatewayReleaseSha256,
    gatewayManifestSha256: config.gatewayManifestSha256,
    ownerSupervisorHandoffProvider: config.ownerSupervisorHandoffProvider,
    releaseGate: config.releaseGate
  });
  const { database, repository, xManualRepository, gateway } = opened;
  try {
    const backend = new ReviewAdminBackend(repository, security);
    const sender = new ProjectionSender({
      repository,
      transport: new ProjectionHttpTransport({
        endpoint: config.projectionInternalEndpoint,
        serviceIdentity: config.projectionSenderServiceIdentity
      }),
      signingKeyId: config.projectionSigningKeyId,
      privateKey,
      actorRef: config.projectionSenderServiceIdentity,
      externalAttempt: opened.mutationPort?.runExternal?.bind(opened.mutationPort),
      externalReconcile: opened.mutationPort?.runReconcile?.bind(opened.mutationPort)
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
    const bilingualRoutes = new BilingualAdminRoutes(bilingualRepository, security, opened.mutationPort ?? undefined, manualPort);
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
    return { server, database, repository, xManualRepository, sender, gateway, manualBilingualEnabled: manualPort !== undefined && bilingualRepository.capability().enabled };
  } catch (error) {
    gateway?.close();
    database.close();
    throw error;
  }
}

export async function runReviewAdminRuntime(config: AdminRuntimeConfig): Promise<void> {
  const runtime = createReviewAdminRuntime(config);
  let stop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => { stop = resolve; });
  const requestStop = (): void => stop?.();
  let senderRunning = false;
  const senderTick = (): void => {
    if (senderRunning) return;
    senderRunning = true;
    const tick = (): Promise<unknown> => runtime.sender.tick();
    const running = config.releaseGate ? config.releaseGate.run("delivery_sender", tick) : tick();
    void running.catch(() => undefined).finally(() => { senderRunning = false; });
  };
  const senderInterval = setInterval(senderTick, PROJECTION_SENDER_INTERVAL_MS);
  senderInterval.unref();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    await listenAdminService(runtime.server);
    await stopped;
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    clearInterval(senderInterval);
    if (runtime.server.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        runtime.server.close((error) => error ? rejectClose(error) : resolveClose());
        runtime.server.closeAllConnections();
      });
    }
    runtime.gateway?.close();
    runtime.database.close();
  }
}
