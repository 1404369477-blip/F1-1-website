import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import {
  assertSameVolume,
  promoteStagedProduction,
  rollbackProductionPromotion,
  stageSchema6To10,
  stageSchema6To10ForTest,
  StageApplyError,
  stageProductionApply,
  stageProductionApplyForTest,
  validateStageSchema10,
  type StageTestHooks
} from "../server/admin-service/production-apply.ts";
import {
  acquireQuiescedLive,
  acquireQuiescedLiveForTest,
  acquireQuiescedSchema6,
  acquireQuiescedSchema6ForTest,
  isQuiescedLive,
  QuiesceError,
  QUIESCE_MAX_AGE_MS,
  type AcquireTestHooks,
  type QuiescedLive
} from "../server/admin-service/quiesce-fence.ts";
import {
  applyIndependentRssSourcesMigration,
  applyInternalOperationMigration,
  applySecondRssAutosportMigration
} from "../server/review-real/migration.ts";
import {
  applyBilingualMigration,
  readBilingualMigrationSql
} from "../server/rss/bilingual-migration.ts";
import {
  applySourceRegistryMigration,
  readSourceRegistryMigrationSql,
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256
} from "../server/rss/source-registry-migration.ts";
import { applyXManualInboxMigration } from "../server/tweet-inbox/repository.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const MIGRATION_ROOT = join(APP_ROOT, "migrations/rss-real");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSql(file: string): string {
  return readFileSync(join(MIGRATION_ROOT, file), "utf8");
}

function sourceRegistryManifest(): Parameters<typeof applySourceRegistryMigration>[2] {
  const common = {
    scheduleSeconds: 900,
    routeIdentitySha256: "1".repeat(64),
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: "4".repeat(64),
    sourcePolicySha256: "5".repeat(64)
  };
  return {
    schemaVersion: "source-registry-migration-manifest-v1",
    migratedAt: "2026-08-25T00:00:00.000Z",
    rss: [
      { ...common, sourceId: "motorsport-f1-news", displayName: "Motorsport F1 News", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
      { ...common, sourceId: "autosport-f1-news", displayName: "Autosport F1 News", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
      { ...common, sourceId: "racefans-f1-news", displayName: "RaceFans F1 News", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
      { ...common, sourceId: "the-race-f1-news", displayName: "The Race F1 News", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
    ]
  };
}

function openSchema4(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  for (const file of [
    "0001_rss_real.sql",
    "0002_admin_review_publish.sql",
    "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql"
  ]) {
    db.exec(readSql(file));
  }
  chmodSync(path, 0o600);
  return db;
}

function buildSchemaN(path: string, target: number): void {
  const db = openSchema4(path);
  if (target >= 5) applySecondRssAutosportMigration(db, readSql("0005_second_rss_autosport.sql"));
  if (target >= 6) applyIndependentRssSourcesMigration(db, readSql("0006_independent_rss_racefans_the_race.sql"));
  if (target >= 7) applyInternalOperationMigration(db, readSql("0007_internal_operation_recovery_phase.sql"));
  if (target >= 8) applyXManualInboxMigration(db, readSql("0008_x_manual_inbox.sql"));
  if (target >= 9) applyBilingualMigration(db, readBilingualMigrationSql(), { applyEnabled: true });
  if (target >= 10) applySourceRegistryMigration(db, readSourceRegistryMigrationSql(), sourceRegistryManifest(), { applyEnabled: true });
  db.close();
}

function newSchema4Env(): { dir: string; livePath: string; stageRoot: string } {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-"));
  const livePath = join(dir, "live.sqlite");
  const stageRootRaw = join(dir, "stage-root");
  mkdirSync(stageRootRaw, { mode: 0o700, recursive: true });
  const stageRoot = realpathSync(stageRootRaw);
  const db = openSchema4(livePath);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
  return { dir, livePath, stageRoot };
}

function newSchema6Env(): { dir: string; livePath: string; stageRoot: string } {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-schema6-"));
  const livePath = join(dir, "live.sqlite");
  const stageRootRaw = join(dir, "stage-root");
  mkdirSync(stageRootRaw, { mode: 0o700, recursive: true });
  const stageRoot = realpathSync(stageRootRaw);
  buildSchemaN(livePath, 6);
  return { dir, livePath, stageRoot };
}

function baseInput(handle: QuiescedLive, stageRoot: string, overrides: Record<string, unknown> = {}): Parameters<typeof stageProductionApply>[0] {
  return {
    stageRoot,
    migrationRoot: MIGRATION_ROOT,
    sourceRegistryManifest: sourceRegistryManifest(),
    quiescedLive: handle,
    ...overrides
  } as Parameters<typeof stageProductionApply>[0];
}

function baseSchema6Input(handle: ReturnType<typeof acquireQuiescedSchema6>, stageRoot: string, overrides: Record<string, unknown> = {}): Parameters<typeof stageSchema6To10>[0] {
  return {
    stageRoot,
    migrationRoot: MIGRATION_ROOT,
    sourceRegistryManifest: sourceRegistryManifest(),
    quiescedLive: handle,
    ...overrides
  };
}

async function expectStageError(input: Parameters<typeof stageProductionApply>[0], codes: readonly string[], useTestEntry = false, hooks: StageTestHooks = {}): Promise<void> {
  const rawHandle = (input as { quiescedLive?: unknown }).quiescedLive;
  try {
    await (useTestEntry ? stageProductionApplyForTest(input, hooks) : stageProductionApply(input));
    throw new Error(`expected StageApplyError ${codes.join("|")}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StageApplyError);
    expect(codes).toContain((error as StageApplyError).code);
  } finally {
    if (rawHandle && isQuiescedLive(rawHandle)) {
      try {
        rawHandle.abortAndRelease();
      } catch {
        // already released by the failure path
      }
    }
  }
}

async function expectQuiesce(codes: readonly string[], fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error(`expected QuiesceError ${codes.join("|")}`);
  } catch (error) {
    expect(error).toBeInstanceOf(QuiesceError);
    expect(codes).toContain((error as QuiesceError).code);
  }
}

function liveSnapshot(path: string): { dev: number; ino: number; nlink: number; sha256: string; version: number } {
  const stat = statSync(path);
  const db = new DatabaseSync(path, { readOnly: true });
  const version = Number((db.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  db.close();
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, sha256: sha256(readFileSync(path)), version };
}

function stageResidue(stageRoot: string): string[] {
  return existsSync(stageRoot) ? readdirSync(stageRoot).filter((name) => name.startsWith("apply-stage-")) : [];
}

describe("admin production-apply M1 slice B1 with quiesced-live handle", () => {
  test("positive: lease O_EXCL, held writer lock, schema10 stage, consume leaves consumed receipt", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const leasePath = `${realpathSync(livePath)}.quiesce`;
    expect(existsSync(leasePath)).toBe(false);

    const handle = acquireQuiescedLive(livePath);
    expect(isQuiescedLive(handle)).toBe(true);
    expect(handle.state).toBe("held");
    expect(handle.schemaVersion).toBe("f1plus1-admin-quiesce-v3");
    expect(handle.base.userVersion).toBe(4);
    expect(handle.base.walState).toBe("absent_or_empty");
    expect(existsSync(leasePath)).toBe(true);
    expect(statSync(leasePath).mode & 0o077).toBe(0);

    const second = new DatabaseSync(livePath);
    try {
      second.exec("PRAGMA busy_timeout=0");
      expect(() => second.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      try {
        second.close();
      } catch {
        // ignore
      }
    }

    const before = liveSnapshot(livePath);
    const result = await stageProductionApply(baseInput(handle, stageRoot));
    expect(result.live.userVersion).toBe(4);
    expect(result.live.sha256).toBe(handle.base.sha256);
    expect(result.quiesceId).toBe(handle.quiesceId);
    expect(result.quiesceReceiptSha256).toBe(handle.receiptSha256);
    expect(result.migrationsApplied).toEqual([5, 6, 7, 8, 9, 10]);
    expect(result.stage.userVersion).toBe(10);
    expect(result.stage.schemaFingerprintSha256).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    expect(result.stage.integrityCheck).toBe("ok");
    expect(result.stage.foreignKeyCheckOk).toBe(true);
    expect(result.stage.phase).toBe("disabled");
    expect(result.stage.globalStop).toBe("stopped");
    expect(result.stage.recovery).toBe("fenced");
    expect(result.stage.automaticReviewerOperations).toBe(0);
    expect(result.stage.automaticPublisherOperations).toBe(0);
    expect(result.stage.automaticOutboxOperations).toBe(0);
    expect(result.stage.sourceRegistryCount).toBe(63);
    expect(result.stage.rssSourceCount).toBe(4);
    expect(result.stage.xManualSourceCount).toBe(59);
    expect(result.stage.sourceRssConfigCount).toBe(4);
    expect(result.migrationSqlSha256[10]).toBe(SOURCE_REGISTRY_MIGRATION_SHA256);
    expect(result.sourceRegistryManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sourceSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);

    const stage = new DatabaseSync(result.stage.path, { readOnly: true });
    try {
      const motorsport = Number((stage.prepare("SELECT count(*) AS count FROM source_registry_v1 WHERE source_id='motorsport-f1-news'").get() as Record<string, unknown>).count);
      expect(motorsport).toBe(1);
    } finally {
      stage.close();
    }

    const after = liveSnapshot(livePath);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(after.nlink).toBe(before.nlink);
    expect(after.sha256).toBe(before.sha256);
    expect(after.version).toBe(4);

    handle.consumeAndRelease();
    expect(existsSync(leasePath)).toBe(false);
    expect(existsSync(`${leasePath}.${handle.quiesceId}.consumed`)).toBe(true);
    const consumed = JSON.parse(readFileSync(`${leasePath}.${handle.quiesceId}.consumed`, "utf8")) as Record<string, unknown>;
    expect(consumed.state).toBe("consumed");
    expect(consumed.quiesceId).toBe(handle.quiesceId);
    expect(consumed.receiptSha256).toBe(handle.receiptSha256);
  });

  test("pure-JSON forged handle is rejected", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const real = acquireQuiescedLive(livePath);
    const forged: QuiescedLive = {
      livePath: real.livePath,
      livePathSha256: real.livePathSha256,
      leasePath: real.leasePath,
      quiesceId: real.quiesceId,
      tokenSha256: real.tokenSha256,
      receiptSha256: real.receiptSha256,
      schemaVersion: real.schemaVersion,
      state: "held",
      issuedAt: real.issuedAt,
      expiresAt: real.expiresAt,
      base: real.base,
      backupTo: real.backupTo,
      consumeAndRelease: real.consumeAndRelease,
      abortAndRelease: real.abortAndRelease
    };
    expect(isQuiescedLive(forged)).toBe(false);
    await expectStageError(baseInput(forged, stageRoot), ["QUIESCE_HANDLE_INVALID"]);
    real.abortAndRelease();
  });

  test("old v2 receipt cannot be authority; production entry ignores extra fields", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const handle = acquireQuiescedLive(livePath);
    const v2 = {
      schemaVersion: "f1plus1-admin-quiesce-v2",
      dev: 0,
      ino: 0,
      pathSha256: "",
      hash: "",
      userVersion: 4,
      fenceHeld: true,
      fenceTokenSha256: "a".repeat(64),
      checkpointMode: "TRUNCATE",
      checkpointLogFrames: 0,
      checkpointedFrames: 0,
      walState: "absent_or_empty",
      at: new Date().toISOString()
    };
    const input = baseInput(handle, stageRoot) as Record<string, unknown>;
    input.quiesceReceipt = v2;
    input.backupFn = async () => {
      throw new Error("backupFn must not be accepted");
    };
    input.clock = () => {
      throw new Error("clock must not be accepted");
    };
    const result = await stageProductionApply(input as Parameters<typeof stageProductionApply>[0]);
    expect(result.stage.userVersion).toBe(10);
    expect(result.migrationsApplied).toEqual([5, 6, 7, 8, 9, 10]);

    await expectStageError(baseInput(v2 as unknown as QuiescedLive, stageRoot), ["QUIESCE_HANDLE_INVALID"]);
    handle.consumeAndRelease();
  });

  test("lease already exists is rejected without overwrite", async () => {
    const { livePath } = newSchema4Env();
    const leasePath = `${realpathSync(livePath)}.quiesce`;
    writeFileSync(leasePath, "preexisting", { mode: 0o600 });
    const before = readFileSync(leasePath, "utf8");
    await expectQuiesce(["QUIESCE_LEASE_EXISTS"], () => acquireQuiescedLive(livePath));
    expect(readFileSync(leasePath, "utf8")).toBe(before);
  });

  test("checkpoint busy and frame rollup fail closed", async () => {
    const env = newSchema4Env();
    const blocker = new DatabaseSync(env.livePath);
    blocker.exec("PRAGMA busy_timeout=0");
    blocker.exec("BEGIN IMMEDIATE");
    try {
      const leasePath = `${realpathSync(env.livePath)}.quiesce`;
      await expectQuiesce(["QUIESCE_CHECKPOINT_BUSY"], () => acquireQuiescedLive(env.livePath));
      expect(existsSync(leasePath)).toBe(false);
    } finally {
      try {
        blocker.exec("ROLLBACK");
      } catch {
        // ignore
      }
      blocker.close();
    }

    const env2 = newSchema4Env();
    const leasePath2 = `${realpathSync(env2.livePath)}.quiesce`;
    const hooks: AcquireTestHooks = { checkpointResult: () => ({ busy: 0, log: 3, checkpointed: 0 }) };
    await expectQuiesce(["QUIESCE_CHECKPOINT_FRAMES"], () => acquireQuiescedLiveForTest(env2.livePath, hooks));
    expect(existsSync(leasePath2)).toBe(false);
  });

  test("checkpoint-to-BEGIN narrow window: committed hook data is captured; held writer lock fails BEGIN", async () => {
    const env = newSchema4Env();
    const hooks: AcquireTestHooks = {
      afterCheckpoint: (livePath: string) => {
        const w = new DatabaseSync(livePath);
        w.exec("PRAGMA journal_mode=WAL; UPDATE source SET last_success_at='2026-08-26T07:00:00.000Z' WHERE source_id='motorsport-f1-news';");
        w.close();
      }
    };
    const handle = acquireQuiescedLiveForTest(env.livePath, hooks);
    const probe = new DatabaseSync(env.livePath, { readOnly: true });
    try {
      const row = probe.prepare("SELECT last_success_at FROM source WHERE source_id='motorsport-f1-news'").get() as Record<string, unknown>;
      expect(row.last_success_at).toBe("2026-08-26T07:00:00.000Z");
    } finally {
      probe.close();
    }
    const result = await stageProductionApply(baseInput(handle, env.stageRoot));
    const stage = new DatabaseSync(result.stage.path, { readOnly: true });
    try {
      const row = stage.prepare("SELECT last_success_at FROM source WHERE source_id='motorsport-f1-news'").get() as Record<string, unknown>;
      expect(row.last_success_at).toBe("2026-08-26T07:00:00.000Z");
    } finally {
      stage.close();
    }
    handle.consumeAndRelease();

    const env2 = newSchema4Env();
    let blocker: DatabaseSync | null = null;
    try {
      await expectQuiesce(["QUIESCE_WRITER_BUSY"], () =>
        acquireQuiescedLiveForTest(env2.livePath, {
          afterCheckpoint: () => {
            blocker = new DatabaseSync(env2.livePath);
            blocker.exec("PRAGMA busy_timeout=0");
            blocker.exec("BEGIN IMMEDIATE");
          }
        })
      );
      expect(existsSync(`${realpathSync(env2.livePath)}.quiesce`)).toBe(false);
    } finally {
      if (blocker) {
        try {
          (blocker as DatabaseSync).exec("ROLLBACK");
        } catch {
          // ignore
        }
        (blocker as DatabaseSync).close();
      }
    }
  });

  test("second writer BEGIN IMMEDIATE fails while backup lock is held", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const handle = acquireQuiescedLive(livePath);
    const dest = join(stageRoot, "direct-backup.sqlite");
    await handle.backupTo(dest);
    expect(existsSync(dest)).toBe(true);
    const second = new DatabaseSync(livePath);
    try {
      second.exec("PRAGMA busy_timeout=0");
      expect(() => second.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      try {
        second.close();
      } catch {
        // ignore
      }
    }
    handle.consumeAndRelease();
  });

  test("post-backup live does not drift and backup replay is rejected", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const handle = acquireQuiescedLive(livePath);
    const before = liveSnapshot(livePath);
    const dest = join(stageRoot, "b1.sqlite");
    await handle.backupTo(dest);
    const afterBackup = liveSnapshot(livePath);
    expect(afterBackup.dev).toBe(before.dev);
    expect(afterBackup.ino).toBe(before.ino);
    expect(afterBackup.nlink).toBe(before.nlink);
    expect(afterBackup.sha256).toBe(before.sha256);
    await expectQuiesce(["QUIESCE_BACKUP_REPLAY"], () => handle.backupTo(join(stageRoot, "b2.sqlite")));
    handle.consumeAndRelease();
  });

  test("lease replaced with a symlink is not removed and raises a safe error", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const handle = acquireQuiescedLive(livePath);
    await handle.backupTo(join(stageRoot, "c.sqlite"));
    const leasePath = handle.leasePath;
    const target = join(dirname(livePath), "replacement-target");
    writeFileSync(target, "replacement");
    unlinkSync(leasePath);
    symlinkSync(target, leasePath);
    await expectQuiesce(["QUIESCE_LEASE_MUTATED"], () => handle.consumeAndRelease());
    expect(lstatSync(leasePath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(leasePath)).toBe(target);
    handle.abortAndRelease();
  });

  test("freshness/expiry reject backup; abort and consume release cleanly", async () => {
    const env = newSchema4Env();
    let now = 1_800_000_000_000;
    const handle = acquireQuiescedLiveForTest(env.livePath, { clock: () => now });
    now += QUIESCE_MAX_AGE_MS + 1;
    await expectQuiesce(["QUIESCE_EXPIRED"], () => handle.backupTo(join(env.stageRoot, "exp.sqlite")));
    handle.abortAndRelease();
    expect(existsSync(handle.leasePath)).toBe(false);
    handle.abortAndRelease();

    const env2 = newSchema4Env();
    let now2 = 1_800_000_000_000;
    const h2 = acquireQuiescedLiveForTest(env2.livePath, { clock: () => now2 });
    now2 -= 1;
    await expectQuiesce(["QUIESCE_STALE"], () => h2.backupTo(join(env2.stageRoot, "stale.sqlite")));
    h2.abortAndRelease();

    const env3 = newSchema4Env();
    const h3 = acquireQuiescedLive(env3.livePath);
    await h3.backupTo(join(env3.stageRoot, "c.sqlite"));
    h3.consumeAndRelease();
    expect(existsSync(h3.leasePath)).toBe(false);
    expect(existsSync(`${h3.leasePath}.${h3.quiesceId}.consumed`)).toBe(true);
    const w = new DatabaseSync(env3.livePath);
    try {
      w.exec("PRAGMA busy_timeout=0");
      w.exec("BEGIN IMMEDIATE");
      w.exec("ROLLBACK");
    } finally {
      w.close();
    }
  });

  test("backup crossing expiresAt fails closed and keeps lock/lease held", async () => {
    const env = newSchema4Env();
    const base = 1_800_000_000_000;
    let tick = 0;
    const clock = () => {
      const values = [base, base, base + QUIESCE_MAX_AGE_MS + 1];
      return values[Math.min(tick++, values.length - 1)];
    };
    const before = liveSnapshot(env.livePath);
    const handle = acquireQuiescedLiveForTest(env.livePath, { clock });
    const dest = join(env.stageRoot, "cross.sqlite");
    await expectQuiesce(["QUIESCE_EXPIRED"], () => handle.backupTo(dest));
    const after = liveSnapshot(env.livePath);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(after.sha256).toBe(before.sha256);
    expect(after.version).toBe(4);
    expect(existsSync(handle.leasePath)).toBe(true);
    const w = new DatabaseSync(env.livePath);
    try {
      w.exec("PRAGMA busy_timeout=0");
      expect(() => w.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      w.close();
    }
    expect(existsSync(`${handle.leasePath}.${handle.quiesceId}.consumed`)).toBe(false);
    handle.abortAndRelease();
    expect(existsSync(handle.leasePath)).toBe(false);
  });

  test("consume after migration expires fails closed, keeps lock/lease, no sidecar", async () => {
    const env = newSchema4Env();
    const base = 1_800_000_000_000;
    let tick = 0;
    const clock = () => {
      const values = [base, base, base, base + QUIESCE_MAX_AGE_MS + 1];
      return values[Math.min(tick++, values.length - 1)];
    };
    const before = liveSnapshot(env.livePath);
    const handle = acquireQuiescedLiveForTest(env.livePath, { clock });
    const result = await stageProductionApply(baseInput(handle, env.stageRoot));
    expect(result.stage.userVersion).toBe(10);
    await expectQuiesce(["QUIESCE_EXPIRED"], () => handle.consumeAndRelease());
    const after = liveSnapshot(env.livePath);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(after.sha256).toBe(before.sha256);
    expect(after.version).toBe(4);
    expect(existsSync(handle.leasePath)).toBe(true);
    const w = new DatabaseSync(env.livePath);
    try {
      w.exec("PRAGMA busy_timeout=0");
      expect(() => w.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      w.close();
    }
    expect(existsSync(`${handle.leasePath}.${handle.quiesceId}.consumed`)).toBe(false);
    handle.abortAndRelease();
    expect(existsSync(handle.leasePath)).toBe(false);
  });

  test("consume before backup is rejected and lock/lease stay held", async () => {
    const env = newSchema4Env();
    const handle = acquireQuiescedLive(env.livePath);
    await expectQuiesce(["QUIESCE_CONSUME_BEFORE_BACKUP"], () => handle.consumeAndRelease());
    expect(existsSync(handle.leasePath)).toBe(true);
    const w = new DatabaseSync(env.livePath);
    try {
      w.exec("PRAGMA busy_timeout=0");
      expect(() => w.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      w.close();
    }
    handle.abortAndRelease();
    expect(existsSync(handle.leasePath)).toBe(false);
  });

  test("consumed receipt conflict is rejected and lock/lease stay held", async () => {
    const env = newSchema4Env();
    const handle = acquireQuiescedLive(env.livePath);
    await handle.backupTo(join(env.stageRoot, "c.sqlite"));
    const consumedPath = `${handle.leasePath}.${handle.quiesceId}.consumed`;
    writeFileSync(consumedPath, "occupied", { mode: 0o600 });
    await expectQuiesce(["QUIESCE_ALREADY_CONSUMED"], () => handle.consumeAndRelease());
    expect(existsSync(handle.leasePath)).toBe(true);
    const w = new DatabaseSync(env.livePath);
    try {
      w.exec("PRAGMA busy_timeout=0");
      expect(() => w.exec("BEGIN IMMEDIATE")).toThrow();
    } finally {
      w.close();
    }
    handle.abortAndRelease();
  });

  test("two full acquire->backup->consume cycles succeed on the same live", async () => {
    const env = newSchema4Env();
    const h1 = acquireQuiescedLive(env.livePath);
    await h1.backupTo(join(env.stageRoot, "first.sqlite"));
    h1.consumeAndRelease();
    expect(existsSync(`${h1.leasePath}.${h1.quiesceId}.consumed`)).toBe(true);
    expect(existsSync(h1.leasePath)).toBe(false);

    const h2 = acquireQuiescedLive(env.livePath);
    expect(h2.quiesceId).not.toBe(h1.quiesceId);
    await h2.backupTo(join(env.stageRoot, "second.sqlite"));
    h2.consumeAndRelease();
    expect(existsSync(`${h2.leasePath}.${h2.quiesceId}.consumed`)).toBe(true);
    expect(existsSync(h2.leasePath)).toBe(false);
    expect(existsSync(`${h1.leasePath}.${h1.quiesceId}.consumed`)).toBe(true);
  });

  test("unsafe destination or lease parent is rejected", async () => {
    const env = newSchema4Env();
    const base = realpathSync(dirname(env.livePath));
    const handle = acquireQuiescedLive(env.livePath);

    const existing = join(env.stageRoot, "exists.sqlite");
    writeFileSync(existing, "occupied");
    await expectQuiesce(["QUIESCE_DEST_EXISTS"], () => handle.backupTo(existing));

    const dangling = join(env.stageRoot, "dangling.sqlite");
    symlinkSync(join(base, "no-such-target"), dangling);
    await expectQuiesce(["QUIESCE_DEST_EXISTS"], () => handle.backupTo(dangling));
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true);

    const symlinkDest = join(env.stageRoot, "symlink.sqlite");
    symlinkSync(existing, symlinkDest);
    await expectQuiesce(["QUIESCE_DEST_EXISTS"], () => handle.backupTo(symlinkDest));
    expect(lstatSync(symlinkDest).isSymbolicLink()).toBe(true);

    const unsafeDir = join(base, "unsafe-dest");
    mkdirSync(unsafeDir, { mode: 0o755, recursive: true });
    chmodSync(unsafeDir, 0o755);
    await expectQuiesce(["QUIESCE_DEST_PARENT_NOT_PRIVATE"], () => handle.backupTo(join(unsafeDir, "out.sqlite")));

    const linkedDir = join(base, "linked-dest");
    symlinkSync(unsafeDir, linkedDir);
    await expectQuiesce(["QUIESCE_DEST_PARENT_NOT_CANONICAL"], () => handle.backupTo(join(linkedDir, "out2.sqlite")));

    const unsafeLeaseParent = join(base, "unsafe-lease");
    mkdirSync(unsafeLeaseParent, { mode: 0o755, recursive: true });
    chmodSync(unsafeLeaseParent, 0o755);
    await expectQuiesce(["QUIESCE_LEASE_PARENT_NOT_PRIVATE"], () =>
      acquireQuiescedLiveForTest(env.livePath, { leasePath: join(unsafeLeaseParent, "x.quiesce") })
    );

    const linkedLeaseParent = join(base, "linked-lease");
    symlinkSync(unsafeLeaseParent, linkedLeaseParent);
    await expectQuiesce(["QUIESCE_LEASE_PARENT_NOT_CANONICAL"], () =>
      acquireQuiescedLiveForTest(env.livePath, { leasePath: join(linkedLeaseParent, "y.quiesce") })
    );

    handle.abortAndRelease();
  });

  test("create-time lease validation failure leaves no fd or lease residue", async () => {
    const env = newSchema4Env();
    const hardlink = join(dirname(env.livePath), "lease-hardlink");
    try {
      await expectQuiesce(["QUIESCE_LEASE_MULTILINK"], () =>
        acquireQuiescedLiveForTest(env.livePath, {
          afterLeaseOpen: (_fd, leasePath) => {
            linkSync(leasePath, hardlink);
          }
        })
      );
    } finally {
      try {
        unlinkSync(hardlink);
      } catch {
        // artifact removed
      }
    }
    const leasePath = `${realpathSync(env.livePath)}.quiesce`;
    expect(existsSync(leasePath)).toBe(false);
    const fresh = acquireQuiescedLive(env.livePath);
    fresh.abortAndRelease();
    expect(existsSync(leasePath)).toBe(false);
  });

  test("schema5-10 live is rejected at acquire", async () => {
    for (const target of [5, 6, 7, 8, 9, 10] as const) {
      const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-"));
      const livePath = join(dir, "live.sqlite");
      buildSchemaN(livePath, target);
      await expectQuiesce(["QUIESCE_LIVE_NOT_SCHEMA4"], () => acquireQuiescedLive(livePath));
    }
  });

  test("live symlink and multi-link are rejected at acquire", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-"));
    const livePath = join(dir, "live.sqlite");
    const stageRoot = join(dir, "stage-root");
    mkdirSync(stageRoot, { mode: 0o700, recursive: true });
    const db = openSchema4(livePath);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
    const linkPath = join(dir, "live-link.sqlite");
    symlinkSync(livePath, linkPath);
    await expectQuiesce(["QUIESCE_LIVE_NOT_REGULAR"], () => acquireQuiescedLive(linkPath));
    const hardPath = join(dir, "live-hard.sqlite");
    linkSync(livePath, hardPath);
    await expectQuiesce(["QUIESCE_LIVE_NOT_REGULAR"], () => acquireQuiescedLive(hardPath));
  });

  test("stage replacement after backup is rejected and cleans up; handle stays released", async () => {
    const { livePath, stageRoot } = newSchema4Env();
    const handle = acquireQuiescedLive(livePath);
    await expectStageError(baseInput(handle, stageRoot), ["STAGE_FILE_MUTATED"], true, {
      beforeMigrate: (dest: string) => {
        writeFileSync(`${dest}.new`, "replacement");
        chmodSync(`${dest}.new`, 0o600);
        renameSync(`${dest}.new`, dest);
      }
    });
    expect(stageResidue(stageRoot)).toEqual([]);
  });

  test("failAfterVersion keeps live schema4 and cleans stage", async () => {
    for (const version of [8, 9, 10] as const) {
      const { livePath, stageRoot } = newSchema4Env();
      const before = liveSnapshot(livePath);
      const handle = acquireQuiescedLive(livePath);
      await expectStageError(baseInput(handle, stageRoot), ["TEST_FAIL_AFTER_VERSION"], true, { failAfterVersion: version });
      const after = liveSnapshot(livePath);
      expect(after.dev).toBe(before.dev);
      expect(after.ino).toBe(before.ino);
      expect(after.sha256).toBe(before.sha256);
      expect(after.version).toBe(4);
      expect(stageResidue(stageRoot)).toEqual([]);
    }
  });

  test("same-volume guard rejects differing device ids", () => {
    expect(() => assertSameVolume(11, 22)).toThrow(StageApplyError);
    expect(() => assertSameVolume(11, 11)).not.toThrow();
  });

  test("schema6->10 stage and atomic promotion emit receipt; backup rollback restores schema6", async () => {
    const env = newSchema6Env();
    const before = liveSnapshot(env.livePath);
    const handle = acquireQuiescedSchema6(env.livePath);
    expect(isQuiescedLive(handle)).toBe(true);
    expect(handle.schemaVersion).toBe("f1plus1-admin-quiesce-schema6-v1");
    expect(handle.base.userVersion).toBe(6);
    expect(handle.base.walState).toBe("absent_or_empty");

    const staged = await stageSchema6To10(baseSchema6Input(handle, env.stageRoot));
    expect(staged.live.userVersion).toBe(6);
    expect(staged.migrationsApplied).toEqual([7, 8, 9, 10]);
    expect(staged.stage.userVersion).toBe(10);
    expect(staged.stage.sourceRegistryCount).toBe(63);
    expect(staged.stage.rssSourceCount).toBe(4);
    expect(staged.stage.xManualSourceCount).toBe(59);
    expect(staged.stage.automaticReviewerOperations).toBe(0);
    expect(staged.stage.automaticPublisherOperations).toBe(0);
    expect(staged.stage.automaticOutboxOperations).toBe(0);

    const promotion = await promoteStagedProduction({ stageResult: staged, quiescedLive: handle });
    expect(promotion.receipt.schemaVersion).toBe("f1plus1-admin-apply-promotion-v1");
    expect(promotion.receipt.state).toBe("promoted");
    expect(promotion.receipt.old.userVersion).toBe(6);
    expect(promotion.receipt.new.userVersion).toBe(10);
    expect(promotion.receipt.old.dev).toBe(before.dev);
    expect(promotion.receipt.old.ino).toBe(before.ino);
    expect(promotion.receipt.old.sha256).toBe(before.sha256);
    expect(promotion.receipt.new.dev).toBe(before.dev);
    expect(promotion.receipt.new.ino).not.toBe(before.ino);
    expect(promotion.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(liveSnapshot(env.livePath).version).toBe(10);
    expect(existsSync(promotion.backupPath)).toBe(true);
    expect(existsSync(handle.leasePath)).toBe(false);

    const rollback = rollbackProductionPromotion({ promotion });
    expect(rollback.state).toBe("rolled_back");
    expect(rollback.restored.userVersion).toBe(6);
    expect(liveSnapshot(env.livePath).version).toBe(6);
    expect(existsSync(promotion.backupPath)).toBe(false);
  });

  test("schema6 promotion rejects a pre-rename stage inode replacement and keeps live schema6", async () => {
    const env = newSchema6Env();
    const handle = acquireQuiescedSchema6(env.livePath);
    const staged = await stageSchema6To10(baseSchema6Input(handle, env.stageRoot));
    const replacement = `${staged.stage.path}.replacement`;
    writeFileSync(replacement, readFileSync(staged.stage.path), { mode: 0o600 });
    renameSync(replacement, staged.stage.path);

    try {
      await promoteStagedProduction({ stageResult: staged, quiescedLive: handle });
      throw new Error("expected stage tamper rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(StageApplyError);
      expect(["PROMOTION_STAGE_MUTATED", "PROMOTION_STAGE_INVALID"]).toContain((error as StageApplyError).code);
    } finally {
      if (isQuiescedLive(handle)) handle.abortAndRelease();
    }
    expect(liveSnapshot(env.livePath).version).toBe(6);
    expect(existsSync(handle.leasePath)).toBe(false);
  });

  test("schema6 quiesce rejects the schema4 database and test helper remains gated", async () => {
    const env = newSchema4Env();
    await expectQuiesce(["QUIESCE_LIVE_NOT_SCHEMA6"], () => acquireQuiescedSchema6(env.livePath));
    const saved = process.env.NODE_ENV;
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.NODE_ENV = "development";
    try {
      expect(() => acquireQuiescedSchema6ForTest(env.livePath, {})).toThrow("TEST_HOOKS_FORBIDDEN");
      await expect(stageSchema6To10ForTest({
        stageRoot: env.stageRoot,
        migrationRoot: MIGRATION_ROOT,
        sourceRegistryManifest: sourceRegistryManifest(),
        quiescedLive: {} as ReturnType<typeof acquireQuiescedSchema6>
      }, {})).rejects.toThrow("TEST_HOOKS_FORBIDDEN");
    } finally {
      if (saved === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = saved;
    }
  });

  test("validator fails closed on non-schema10 database and phase guard holds", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-"));
    const path = join(dir, "live.sqlite");
    buildSchemaN(path, 9);
    expect(() => validateStageSchema10(path)).toThrow(StageApplyError);
    const path10 = join(dir, "live10.sqlite");
    buildSchemaN(path10, 10);
    const db = new DatabaseSync(path10);
    try {
      expect(() => db.exec("UPDATE internal_control SET phase='live' WHERE singleton_id=1")).toThrow();
    } finally {
      db.close();
    }
  });

  test("test-only entries reject when NODE_ENV is not test", async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const saved = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = "development";
    try {
      const dir = mkdtempSync(join(realpathSync(tmpdir()), "f1-apply-"));
      const livePath = join(dir, "live.sqlite");
      const stageRoot = join(dir, "stage-root");
      mkdirSync(stageRoot, { mode: 0o700, recursive: true });
      const db = openSchema4(livePath);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.close();
      let handleForStage: QuiescedLive | null = null;
      try {
        handleForStage = acquireQuiescedLive(livePath);
        const stageCode = await stageProductionApplyForTest(baseInput(handleForStage, stageRoot), {}).then(
          () => "ok",
          (error: unknown) => (error as StageApplyError).code
        );
        expect(stageCode).toBe("TEST_HOOKS_FORBIDDEN");
      } finally {
        if (handleForStage) handleForStage.abortAndRelease();
      }
      const acquireCode = (() => {
        try {
          acquireQuiescedLiveForTest(livePath, {});
          return "ok";
        } catch (error) {
          return (error as QuiesceError).code;
        }
      })();
      expect(acquireCode).toBe("TEST_HOOKS_FORBIDDEN");
    } finally {
      if (saved === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = saved;
    }
  });

  test("modules must not import launchctl/network/service factories", async () => {
    for (const file of ["src/server/admin-service/production-apply.ts", "src/server/admin-service/quiesce-fence.ts"]) {
      const source = readFileSync(resolve(APP_ROOT, file), "utf8");
      for (const forbidden of ["child_process", "node:http", "node:https", "node:net", "node:tls", "node:dgram", "launchctl"]) {
        expect(source.includes(`from "${forbidden}"`) || source.includes(`from '${forbidden}'`)).toBe(false);
      }
    }
  });
});
