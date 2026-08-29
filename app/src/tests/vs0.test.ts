import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  loadAppConfig,
  parseEnvText,
  validateFixturePath,
  type EnvRecord
} from "../server/config/env";
import { assertCapabilityRegistry } from "../server/config/registry";
import {
  assertMigrationState,
  closeDatabase,
  migrateDatabase,
  openSafeDatabase,
  readSqliteRuntime,
  withImmediateTransaction
} from "../server/db/database";
import { seedSourceFixture } from "../server/db/seed";
import { readFixtureProvider } from "../server/providers/fixture";
import { readSourceFixture } from "../server/providers/source-fixture";
import { createRedactedLogger } from "../server/security/log";
import { getHealthDto } from "../server/health";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const projectRoot = resolve(appRoot, "..");
const fixturePath = resolve(projectRoot, "data/m3-base-shadow-import-v0/main-source-record-batch.json");

const validEnv: EnvRecord = {
  APP_ENV: "test",
  APP_PORT: "3010",
  APP_BIND_HOST: "127.0.0.1",
  APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
  F1_DATA_PROFILE: "m3-shadow",
  F1_DB_PATH: ".local/f1plus1.sqlite",
  SOURCE_CONFIG_PROVIDER: "fixture",
  SOURCE_FIXTURE_PATH: "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
  ADAPTER_MODE: "mock",
  SUMMARY_MODE: "fixture",
  MEDIA_MODE: "fixture",
  PUBLISH_MODE: "manual_only",
  REAL_FEISHU_IO: "false",
  REAL_EXTERNAL_IO: "false",
  REAL_FORM_SUBMIT: "false",
  ADMIN_ACCESS_MODE: "local_dev_only",
  LOG_LEVEL: "info"
};

function configForFixture(dbPath = ".local/f1plus1.sqlite") {
  return loadAppConfig({ ...validEnv, F1_DB_PATH: dbPath }, { appRoot, projectRoot });
}

function freshDatabaseRoot(prefix: string): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

describe("VS-0 fail-closed configuration", () => {
  it("accepts only the exact local fixture profile", () => {
    const config = configForFixture();
    expect(config.sourceProvider).toBe("fixture");
    expect(assertCapabilityRegistry(config)).toMatchObject({ localOnly: true, externalCalls: 0 });
  });

  it.each([
    ["wrong Node", { nodeVersion: "25.5.0" }],
    ["wrong bind host", { env: { APP_BIND_HOST: "0.0.0.0", APP_PUBLIC_ORIGIN: "http://0.0.0.0:3010" } }],
    ["wrong origin", { env: { APP_PUBLIC_ORIGIN: "http://127.0.0.1:3011" } }],
    ["real external switch", { env: { REAL_EXTERNAL_IO: "true" } }],
    ["provider switch", { env: { SOURCE_CONFIG_PROVIDER: "base_direct" } }]
  ])("rejects %s", (_label, input: { nodeVersion?: string; env?: EnvRecord }) => {
    expect(() => loadAppConfig({ ...validEnv, ...(input.env ?? {}) }, {
      appRoot,
      projectRoot,
      nodeVersion: input.nodeVersion
    })).toThrow(ConfigError);
  });

  it("rejects unknown, secret and proxy environment keys", () => {
    expect(() => loadAppConfig({ ...validEnv, UNKNOWN_CAPABILITY: "1" }, { appRoot, projectRoot })).toThrow(/ENV_UNKNOWN/);
    expect(() => loadAppConfig({ ...validEnv, FEISHU_TOKEN: "x" }, { appRoot, projectRoot })).toThrow(/ENV_FORBIDDEN/);
    expect(() => loadAppConfig({ ...validEnv, HTTPS_PROXY: "http://proxy.invalid" }, { appRoot, projectRoot })).toThrow(/ENV_FORBIDDEN/);
  });

  it("parses the checked-in example without creating a second contract", () => {
    const parsed = parseEnvText(readFileSync(resolve(appRoot, ".env.example"), "utf8"));
    expect(parsed.SOURCE_CONFIG_PROVIDER).toBe("fixture");
    expect(Object.keys(parsed)).toHaveLength(21);
    expect(parsed.F1_PUBLIC_READ_MODE).toBe("public-multimedia-synthetic");
  });
});

describe("VS-0 fixture paths and bridge provider", () => {
  it("keeps the frozen M3 provider raw and loads the accepted 39-field bridge", () => {
    const pathInfo = validateFixturePath("../data/m3-base-shadow-import-v0/main-source-record-batch.json", appRoot, projectRoot);
    const m3 = readFixtureProvider(configForFixture(), appRoot, projectRoot);
    const source = readSourceFixture(configForFixture(), appRoot, projectRoot);
    expect(pathInfo.sha256).toBe("e73b8d6b8a9b1a018dc7d30c90bfe3111b10caeb6fee28486edf27f176a05de5");
    expect(m3.fieldCount).toBe(33);
    expect(m3.rowCount).toBe(59);
    expect(m3.rows.every((row) => row.enabled === false)).toBe(true);
    expect(m3.dataGate).toBe("blocked-by-data");
    expect(source.fieldCount).toBe(39);
    expect(source.rowCount).toBe(59);
    expect(source.rows.every((row) => row.enabled === false)).toBe(true);
    expect(source.projectionHash).toBe("e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17");
    expect(Object.keys(source.rows[0])).toHaveLength(39);
  });

  it("rejects a path that leaves the frozen data/app fixture roots", () => {
    expect(() => validateFixturePath("../../tmp/not-a-fixture.json", appRoot, projectRoot)).toThrow(/FIXTURE_PATH/);
    expect(() => validateFixturePath("fixtures/missing.json", appRoot, projectRoot)).toThrow(ConfigError);
  });

  it("rejects symlink and hardlink fixture substitutions", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-fixture-");
    const fixtureRoot = join(root, "fixtures");
    mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
    const symlinkPath = join(fixtureRoot, "symlink.json");
    const hardlinkPath = join(fixtureRoot, "hardlink.json");
    symlinkSync(fixturePath, symlinkPath);
    linkSync(fixturePath, hardlinkPath);
    try {
      expect(() => validateFixturePath("fixtures/symlink.json", root, root)).toThrow(/FIXTURE_PATH/);
      expect(() => validateFixturePath("fixtures/hardlink.json", root, root)).toThrow(/FIXTURE_PATH/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the exact bytes read through the guarded fixture descriptor", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-fixture-bytes-");
    const fixtureRoot = join(root, "fixtures");
    const target = join(fixtureRoot, "stable.json");
    mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
    writeFileSync(target, '{"receipt":"accepted"}', { mode: 0o600 });
    try {
      const pathInfo = validateFixturePath("fixtures/stable.json", root, root);
      writeFileSync(target, '{"receipt":"changed"}', { mode: 0o600 });
      expect(pathInfo.bytes.toString("utf8")).toBe('{"receipt":"accepted"}');
      expect(createHash("sha256").update(pathInfo.bytes).digest("hex")).toBe(pathInfo.sha256);
      chmodSync(target, 0o622);
      expect(() => validateFixturePath("fixtures/stable.json", root, root)).toThrow(/FIXTURE_PATH/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized fixtures and a symlinked allowed root", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-fixture-root-");
    const realFixtureRoot = join(root, "real-fixtures");
    const fixtureRoot = join(root, "fixtures");
    mkdirSync(realFixtureRoot, { mode: 0o700 });
    writeFileSync(join(realFixtureRoot, "fixture.json"), "{}", { mode: 0o600 });
    symlinkSync(realFixtureRoot, fixtureRoot);
    try {
      expect(() => validateFixturePath("fixtures/fixture.json", root, root)).toThrow(/FIXTURE_PATH/);
      rmSync(fixtureRoot);
      mkdirSync(fixtureRoot, { mode: 0o700 });
      const oversized = join(fixtureRoot, "oversized.json");
      writeFileSync(oversized, "", { mode: 0o600 });
      truncateSync(oversized, 16 * 1024 * 1024 + 1);
      expect(() => validateFixturePath("fixtures/oversized.json", root, root)).toThrow(/FIXTURE_SIZE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("VS-0 redacted logs and safe health DTO", () => {
  it("drops secrets and private payloads before serializing", () => {
    const lines: string[] = [];
    const logger = createRedactedLogger((line) => lines.push(line));
    logger.error({
      event: "rejected",
      reasonCode: "bad_fixture",
      Authorization: "Bearer secret-token",
      payload: { body: "private text" },
      traceRef: "trace-1",
      externalCalls: 0
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret-token");
    expect(lines[0]).not.toContain("private text");
    expect(lines[0]).toContain("redacted_incident");
    expect(lines[0]).toContain("redacted_fields");
  });

  it("rejects unsafe runtime log values instead of reporting external calls", () => {
    const lines: string[] = [];
    const logger = createRedactedLogger((line) => lines.push(line));
    logger.warn({ event: "unsafe", externalCalls: 1, traceRef: "/Users/private/state", fixtureHash: "not-a-hash" });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.externalCalls).toBeUndefined();
    expect(parsed.traceRef).toBeUndefined();
    expect(parsed.fixtureHash).toBeUndefined();
    expect(parsed.event).toBe("redacted_incident");
    expect(parsed.reasonCode).toBe("redacted_fields");
  });

  it("reports not_ready without creating a DB and ready only after attested seed", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-health-");
    const dbPath = join(root, "f1plus1.sqlite");
    const options = {
      appRoot,
      projectRoot,
      config: configForFixture(),
      dbPath,
      databaseOptions: { appRoot: root, allowTestRoot: root }
    };
    try {
      const before = getHealthDto(options);
      expect(before.status).toBe("not_ready");
      expect(before.dataGate).toBe("unverified");
      expect(() => statSync(dbPath)).toThrow();

      const database = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
      try {
        migrateDatabase(database, resolve(appRoot, "migrations"));
        seedSourceFixture(database, configForFixture(), appRoot, projectRoot);
      } finally {
        closeDatabase(database);
      }

      const ready = getHealthDto(options);
      const serialized = JSON.stringify(ready);
      expect(ready.scope).toBe("local-only");
      expect(ready.status).toBe("ready");
      expect(ready.dataGate).toBe("accepted-local-fixture");
      expect(ready.externalCalls).toBe(0);
      expect(ready.enforcement).toEqual({
        filesystemIsolation: "local_trusted_user",
        toctouProof: false,
        networkEnforcement: "pending"
      });
      expect(serialized).not.toContain("/Users/");
      expect(serialized).not.toMatch(/token|secret|password/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("VS-0 SQLite boundary, migration ledger and Source repository", () => {
  it("sets WAL/FULL/timeout, migrates idempotently and rolls back", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-db-");
    const dbPath = join(root, "state.sqlite");
    const database = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    try {
      const first = migrateDatabase(database, resolve(appRoot, "migrations"));
      const second = migrateDatabase(database, resolve(appRoot, "migrations"));
      const runtime = readSqliteRuntime(database);
      expect(first.userVersion).toBe(3);
      expect(second.applied).toEqual([]);
      expect(runtime.journalMode).toBe("wal");
      expect(runtime.synchronous).toBe(2);
      expect(runtime.busyTimeout).toBe(250);
      expect(runtime.foreignKeys).toBe(1);
      expect(runtime.tempStore).toBe(2);
      expect(statSync(dbPath).mode & 0o077).toBe(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM migration_ledger").get()).toMatchObject({ count: 3 });
      expect(database.prepare("PRAGMA table_info(source_config_fixture)").all()).toHaveLength(39);
      expect(() => database.exec(`ATTACH DATABASE '${join(root, "other.sqlite")}' AS other`)).toThrow();
      expect(() => database.enableLoadExtension(true)).toThrow();
      expect(() => withImmediateTransaction(database, () => {
        database.exec("CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);");
        throw new Error("expected rollback");
      })).toThrow("expected rollback");
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='rollback_probe'").get()).toBeUndefined();
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("seeds the accepted 59x39 bridge and is idempotent", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-seed-");
    const dbPath = join(root, "f1plus1.sqlite");
    const database = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    try {
      migrateDatabase(database, resolve(appRoot, "migrations"));
      const first = seedSourceFixture(database, configForFixture(), appRoot, projectRoot);
      const second = seedSourceFixture(database, configForFixture(), appRoot, projectRoot);
      expect(first.dataGate).toBe("accepted-local-fixture");
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(first.fieldCount).toBe(39);
      expect(first.rowCount).toBe(59);
      expect(first.enabledFalseCount).toBe(59);
      expect(first.legacyGate).toBe("legacy-reject");
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_config_fixture").get()).toMatchObject({ count: 59 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_seed_ledger").get()).toMatchObject({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_config_fixture WHERE enabled=0").get()).toMatchObject({ count: 59 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='source_config_fixture'").get()).toBeDefined();
      expect(createHash("sha256").update(readFileSync(resolve(projectRoot, "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json"))).digest("hex")).toBe(first.sourceArtifactHash);
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing migration ledger, missing records and user_version ahead", () => {
    const cases = ["ledger table", "ledger record", "version ahead"] as const;
    for (const kind of cases) {
      const root = freshDatabaseRoot(`f1plus1-vs0-migration-${kind.replaceAll(" ", "-")}-`);
      const database = openSafeDatabase(join(root, "state.sqlite"), { appRoot: root, allowTestRoot: root });
      try {
        migrateDatabase(database, resolve(appRoot, "migrations"));
        if (kind === "ledger table") database.exec("DROP TABLE migration_ledger");
        if (kind === "ledger record") database.prepare("DELETE FROM migration_ledger WHERE migration_id = ?").run("0003_public_synthetic_profile.sql");
        if (kind === "version ahead") database.exec("PRAGMA user_version=99");
        expect(() => migrateDatabase(database, resolve(appRoot, "migrations"))).toThrow(
          kind === "version ahead" ? /MIGRATION_VERSION/ : /MIGRATION_(?:LEDGER|SCHEMA)/
        );
      } finally {
        closeDatabase(database);
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it.each([
    ["weak table", "CREATE TABLE source_config_fixture (source_id TEXT)"],
    ["same-name view", "CREATE VIEW source_config_fixture AS SELECT 1 AS source_id"],
    ["same-name index", "CREATE TABLE attack_base (id TEXT); CREATE INDEX source_config_fixture_epoch_idx ON attack_base(id)"],
    ["same-name trigger", "CREATE TABLE attack_base (id TEXT); CREATE TRIGGER source_seed_ledger AFTER INSERT ON attack_base BEGIN SELECT 1; END"],
    ["fake ledger", "CREATE TABLE migration_ledger (migration_id TEXT PRIMARY KEY)"]
  ])("rejects preclaimed migration objects: %s", (_label, attackSql) => {
    const root = freshDatabaseRoot("f1plus1-vs0-preclaim-");
    const database = openSafeDatabase(join(root, "state.sqlite"), { appRoot: root, allowTestRoot: root });
    try {
      database.exec(attackSql);
      expect(() => migrateDatabase(database, resolve(appRoot, "migrations"))).toThrow(/MIGRATION_(?:PRECLAIM|SCHEMA)/);
      expect(readSqliteRuntime(database).userVersion).toBe(0);
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name='fixture_seed_ledger'").get()).toBeUndefined();
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["added column", "ALTER TABLE source_config_fixture ADD COLUMN attacker_value TEXT", /MIGRATION_SCHEMA/],
    ["deleted index", "DROP INDEX source_config_fixture_epoch_idx", /MIGRATION_SCHEMA/],
    [
      "wrong partial index",
      "DROP INDEX source_config_fixture_canonical_unique; CREATE UNIQUE INDEX source_config_fixture_canonical_unique ON source_config_fixture(canonical_url) WHERE enabled = 1",
      /MIGRATION_SCHEMA/
    ],
    ["forged ledger field", "UPDATE migration_ledger SET applied_at='invalid' WHERE migration_id='0002_source_fixture.sql'", /MIGRATION_LEDGER/]
  ])("rejects applied schema or ledger drift: %s", (_label, attackSql, expected) => {
    const root = freshDatabaseRoot("f1plus1-vs0-drift-");
    const database = openSafeDatabase(join(root, "f1plus1.sqlite"), { appRoot: root, allowTestRoot: root });
    try {
      migrateDatabase(database, resolve(appRoot, "migrations"));
      seedSourceFixture(database, configForFixture(), appRoot, projectRoot);
      database.exec(attackSql);
      expect(() => migrateDatabase(database, resolve(appRoot, "migrations"))).toThrow(expected);
      expect(() => assertMigrationState(database, resolve(appRoot, "migrations"), 3)).toThrow(expected);
      expect(() => seedSourceFixture(database, configForFixture(), appRoot, projectRoot)).toThrow(expected);
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bounds BEGIN IMMEDIATE lock contention and never replays the callback", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-lock-");
    const dbPath = join(root, "state.sqlite");
    const first = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    const second = new DatabaseSync(dbPath);
    let callbackCalls = 0;
    try {
      migrateDatabase(first, resolve(appRoot, "migrations"));
      second.exec("PRAGMA busy_timeout=1");
      first.exec("BEGIN IMMEDIATE");
      expect(() => withImmediateTransaction(second, () => {
        callbackCalls += 1;
      })).toThrow(/LOCK_CONTENTION/);
      expect(callbackCalls).toBe(0);
      first.exec("ROLLBACK");
      expect(withImmediateTransaction(second, () => {
        callbackCalls += 1;
        return "ok";
      })).toBe("ok");
      expect(callbackCalls).toBe(1);
    } finally {
      try {
        first.exec("ROLLBACK");
      } catch {
        // The successful path already released the first transaction.
      }
      second.close();
      closeDatabase(first);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a database path when .local or the final file is a symlink", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-symlink-");
    const external = freshDatabaseRoot("f1plus1-vs0-external-");
    const local = join(root, ".local");
    symlinkSync(external, local);
    try {
      expect(() => openSafeDatabase(join(local, "state.sqlite"), { appRoot: root })).toThrow(/DB_PATH/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }

    const root2 = freshDatabaseRoot("f1plus1-vs0-final-link-");
    const local2 = join(root2, ".local");
    mkdirSync(local2, { mode: 0o700 });
    const outsideDb = join(root2, "outside.sqlite");
    const finalDb = join(local2, "state.sqlite");
    const outside = openSafeDatabase(outsideDb, { appRoot: root2, allowTestRoot: root2 });
    closeDatabase(outside);
    symlinkSync(outsideDb, finalDb);
    try {
      expect(() => openSafeDatabase(finalDb, { appRoot: root2 })).toThrow(/DB_PATH/);
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it("rejects a parent symlink swap before opening", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-parent-swap-");
    const realLocal = join(root, "real-local");
    const local = join(root, ".local");
    mkdirSync(realLocal, { mode: 0o700 });
    renameSync(realLocal, local);
    const movedLocal = join(root, "moved-local");
    renameSync(local, movedLocal);
    symlinkSync(movedLocal, local);
    try {
      expect(() => openSafeDatabase(join(local, "state.sqlite"), { appRoot: root })).toThrow(/DB_PATH/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts valid WAL recovery files and rejects unsafe SQLite sidecars", () => {
    const root = freshDatabaseRoot("f1plus1-vs0-sidecar-");
    const nested = join(root, "nested");
    const dbPath = join(root, "state.sqlite");
    const sidecar = `${dbPath}-wal`;
    const target = join(root, "target.bin");
    mkdirSync(nested, { mode: 0o700 });
    writeFileSync(target, "sidecar", { mode: 0o600 });
    const database = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    try {
      migrateDatabase(database, resolve(appRoot, "migrations"));
      const concurrent = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
      closeDatabase(concurrent);
      expect(() => openSafeDatabase(join(nested, "state.sqlite"), { appRoot: root, allowTestRoot: root })).toThrow(/DB_PATH/);
      closeDatabase(database);
      symlinkSync(target, sidecar);
      expect(() => openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root })).toThrow(/DB_PATH/);
      rmSync(sidecar);
      linkSync(target, sidecar);
      expect(() => openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root })).toThrow(/DB_PATH/);
      rmSync(sidecar);
      writeFileSync(sidecar, "unsafe", { mode: 0o600 });
      chmodSync(sidecar, 0o644);
      expect(() => openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root })).toThrow(/DB_PERMISSIONS/);
    } finally {
      try {
        closeDatabase(database);
      } catch {
        // The ordinary path closes before malicious sidecars are installed.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
