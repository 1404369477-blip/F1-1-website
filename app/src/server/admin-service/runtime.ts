import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { ReviewAdminBackend } from "../review-real/backend.ts";
import { applyReviewRealAdminMigration } from "../review-real/migration.ts";
import { ProjectionReceiver } from "../review-real/projection.ts";
import { ReviewRealRepository } from "../review-real/repository.ts";
import { ReviewAdminRoutes } from "../review-real/routes.ts";
import { ReviewAdminSecurity, type ReviewRecoveryFence } from "../review-real/security.ts";
import { applyRssMigration, openRssDatabase } from "../rss/repository.ts";
import { AdminPasskeyAuth } from "./auth.ts";
import { createAdminServiceServer, listenAdminService, type TrustedTailnetIdentity } from "./server.ts";
import {
  assertPrivateDirectory,
  assertPrivateFile,
  BootstrapTokenStore,
  PasskeyCredentialStore
} from "./storage.ts";
import { SimpleWebAuthnAdapter } from "./webauthn.ts";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RecoveryFenceSchema = z.object({
  schemaVersion: z.literal("admin-recovery-fence-v1"),
  clockTrusted: z.boolean(),
  writerReady: z.boolean(),
  lastSuccessfulRecoveryPointAt: z.number().int().nonnegative().safe().nullable()
}).strict();

export type AdminRuntimeConfig = Readonly<{
  appRoot: string;
  dataRoot: string;
  staticRoot: string;
  canonicalOrigin: string;
  rpName: string;
  operatorRef: string;
  trustedIdentities: readonly TrustedTailnetIdentity[];
  sessionHashKeyPath: string;
  recoveryFencePath: string;
  projectionRoot: string;
  projectionSigningKeyId: string;
  projectionVerifyKeyPath: string;
  projectionBootstrapGeneration: number;
  projectionBootstrapHash: string;
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

export function openReviewAdminDatabase(appRoot: string): Readonly<{
  database: DatabaseSync;
  repository: ReviewRealRepository;
}> {
  const root = resolve(appRoot);
  const database = openRssDatabase(root);
  try {
    const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    if (version === 0 || version === 1) {
      applyRssMigration(database, readFileSync(join(root, "migrations/rss-real/0001_rss_real.sql"), "utf8"));
    }
    applyReviewRealAdminMigration(
      database,
      readFileSync(join(root, "migrations/rss-real/0002_admin_review_publish.sql"), "utf8")
    );
    return { database, repository: new ReviewRealRepository(database) };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function createReviewAdminRuntime(config: AdminRuntimeConfig): Readonly<{
  server: ReturnType<typeof createAdminServiceServer>;
  database: DatabaseSync;
}> {
  const dataRoot = resolve(config.dataRoot);
  const projectionRoot = resolve(config.projectionRoot);
  assertPrivateDirectory(dataRoot);
  if (existsSync(projectionRoot)) assertPrivateDirectory(projectionRoot);
  const origin = new URL(config.canonicalOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    config.projectionSigningKeyId.length < 1 ||
    config.projectionSigningKeyId.length > 256 ||
    !Number.isSafeInteger(config.projectionBootstrapGeneration) ||
    config.projectionBootstrapGeneration < 1 ||
    !HashSchema.safeParse(config.projectionBootstrapHash).success
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
  assertPrivateFile(config.projectionVerifyKeyPath);
  const publicKey = createPublicKey(readFileSync(config.projectionVerifyKeyPath, "utf8"));
  const receiver = new ProjectionReceiver({
    root: projectionRoot,
    signingKeyId: config.projectionSigningKeyId,
    publicKey,
    bootstrapPin: {
      snapshotGeneration: config.projectionBootstrapGeneration,
      snapshotManifestHash: config.projectionBootstrapHash
    }
  });
  const { database, repository } = openReviewAdminDatabase(config.appRoot);
  try {
    const backend = new ReviewAdminBackend(repository, security);
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
      trustedIdentities: config.trustedIdentities,
      auth,
      reviewRoutes,
      security,
      projectionReceiver: receiver,
      staticRoot: config.staticRoot
    });
    return { server, database };
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
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    await listenAdminService(runtime.server);
    await stopped;
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    if (runtime.server.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        runtime.server.close((error) => error ? rejectClose(error) : resolveClose());
        runtime.server.closeAllConnections();
      });
    }
    runtime.database.close();
  }
}
