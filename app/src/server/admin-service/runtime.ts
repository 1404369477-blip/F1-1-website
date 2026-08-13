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
import {
  applyProjectionDeliveryRuntimeMigration,
  applyReviewRealAdminMigration,
  applyRssMediaRefinementMigration,
  assertRssMediaRefinementSchema
} from "../review-real/migration.ts";
import { ReviewRealRepository } from "../review-real/repository.ts";
import { ProjectionHttpTransport, ProjectionSender } from "../review-real/sender.ts";
import { ReviewAdminRoutes } from "../review-real/routes.ts";
import { ReviewAdminSecurity, type ReviewRecoveryFence } from "../review-real/security.ts";
import { RSS_DATABASE_PATH } from "../rss/repository.ts";
import { AdminPasskeyAuth } from "./auth.ts";
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

export type AdminRuntimeConfig = Readonly<{
  targetReleaseAppRoot: string;
  reviewDatabasePath: string;
  reviewDatabaseIdentity: ExistingDatabaseIdentity;
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
}>;

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
}>): Readonly<{
  database: DatabaseSync;
  repository: ReviewRealRepository;
}> {
  if (resolve(input.targetReleaseAppRoot) !== input.targetReleaseAppRoot ||
      resolve(input.reviewDatabasePath) !== input.reviewDatabasePath) {
    throw new Error("ADMIN_REVIEW_DATABASE_PATH_INVALID");
  }
  const targetReleaseAppRoot = resolve(input.targetReleaseAppRoot);
  const reviewDatabasePath = resolve(input.reviewDatabasePath);
  const database = openExistingSafeDatabase(
    reviewDatabasePath,
    RSS_DATABASE_PATH.split("/").at(-1)!,
    input.reviewDatabaseIdentity,
    [1, 2, 3, 4]
  );
  try {
    const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    if (version === 1) {
      applyReviewRealAdminMigration(
        database,
        readFileSync(join(targetReleaseAppRoot, "migrations/rss-real/0002_admin_review_publish.sql"), "utf8")
      );
    }
    if (version < 4) {
      applyProjectionDeliveryRuntimeMigration(
        database,
        readFileSync(join(targetReleaseAppRoot, "migrations/rss-real/0003_projection_delivery_runtime.sql"), "utf8")
      );
      applyRssMediaRefinementMigration(
        database,
        readFileSync(join(targetReleaseAppRoot, "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql"), "utf8")
      );
    } else {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;");
      assertRssMediaRefinementSchema(database);
    }
    const runtime = readSqliteRuntime(database);
    if (runtime.journalMode !== "wal" || runtime.synchronous !== 2 || runtime.foreignKeys !== 1 || runtime.userVersion !== 4) {
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
    return { database, repository: new ReviewRealRepository(database) };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function createReviewAdminRuntime(config: AdminRuntimeConfig): Readonly<{
  server: ReturnType<typeof createAdminServiceServer>;
  database: DatabaseSync;
  sender: ProjectionSender;
}> {
  const dataRoot = resolve(config.dataRoot);
  assertPrivateDirectory(dataRoot);
  const origin = new URL(config.canonicalOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    config.projectionSigningKeyId.length < 1 ||
    config.projectionSigningKeyId.length > 256 ||
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
  const { database, repository } = openReviewAdminDatabase({
    targetReleaseAppRoot: config.targetReleaseAppRoot,
    reviewDatabasePath: config.reviewDatabasePath,
    reviewDatabaseIdentity: config.reviewDatabaseIdentity
  });
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
      actorRef: config.projectionSenderServiceIdentity
    });
    const reviewRoutes = new ReviewAdminRoutes(backend);
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
      security,
      projectionDeliveryReceipt: (deliveryId) => repository.deliveryReceipt(deliveryId),
      staticRoot: config.staticRoot
    });
    return { server, database, sender };
  } catch (error) {
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
    void runtime.sender.tick().finally(() => { senderRunning = false; });
  };
  const senderInterval = setInterval(senderTick, 60_000);
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
    runtime.database.close();
  }
}
