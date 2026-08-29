import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAppConfig, type AppConfig, type EnvRecord } from "../server/config/env";
import {
  closeDatabase,
  migrateDatabase,
  openSafeDatabase,
  readSqliteRuntime,
  type SqliteDatabase
} from "../server/db/database";
import {
  PUBLIC_GRAPH_SHA256,
  PUBLIC_ROOT_HASHES,
  seedPublicSyntheticFixture
} from "../server/db/public-synthetic";
import { PUBLIC_PROFILE_COUNTS, canonicalJson } from "../server/db/profile";
import { seedSourceFixture } from "../server/db/source";
import { SOURCE_PROJECTION_SHA256, SOURCE_REQUIRED_FIELDS, sourceProjectionHash, type SourceRow } from "../server/providers/source-fixture";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const projectRoot = resolve(appRoot, "..");

function env(profile: "m3-shadow" | "public-synthetic"): EnvRecord {
  const publicProfile = profile === "public-synthetic";
  return {
    APP_ENV: "test",
    APP_PORT: "3010",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    F1_DATA_PROFILE: profile,
    F1_DB_PATH: publicProfile ? ".local/f1plus1-public-synthetic.sqlite" : ".local/f1plus1.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: publicProfile
      ? "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
      : "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
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
}

function config(profile: "m3-shadow" | "public-synthetic", roots = { appRoot, projectRoot }): AppConfig {
  return loadAppConfig(env(profile), { ...roots });
}

function tempRoot(prefix: string): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

function openProfile(root: string, profileConfig: AppConfig): SqliteDatabase {
  return openSafeDatabase(join(root, basename(profileConfig.dbPath)), { appRoot: root, allowTestRoot: root });
}

function tableCount(database: SqliteDatabase, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>).count);
}

function copyFiles(from: string, to: string): void {
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    copyFileSync(join(from, entry.name), join(to, entry.name));
    chmodSync(join(to, entry.name), 0o600);
  }
}

describe("v0.4 isolated SQLite profiles", () => {
  it("seeds the two physical profiles with exact ledgers and no M3 drift", () => {
    const root = tempRoot("f1plus1-v04-profiles-");
    const m3Config = config("m3-shadow");
    const publicConfig = config("public-synthetic");
    const m3 = openProfile(root, m3Config);
    const publicDatabase = openProfile(root, publicConfig);
    try {
      migrateDatabase(m3, resolve(appRoot, "migrations"));
      migrateDatabase(publicDatabase, resolve(appRoot, "migrations"));
      const m3First = seedSourceFixture(m3, m3Config, appRoot, projectRoot);
      const m3Second = seedSourceFixture(m3, m3Config, appRoot, projectRoot);
      const publicFirst = seedPublicSyntheticFixture(publicDatabase, publicConfig, appRoot, projectRoot);
      const publicSecond = seedPublicSyntheticFixture(publicDatabase, publicConfig, appRoot, projectRoot);

      expect(m3First.inserted).toBe(true);
      expect(m3Second.inserted).toBe(false);
      expect(publicFirst.inserted).toBe(true);
      expect(publicSecond).toEqual({ ...publicFirst, inserted: false });
      expect(publicFirst.rowCounts).toEqual(PUBLIC_PROFILE_COUNTS);
      expect(publicFirst.fixtureManifestHash).toBe(PUBLIC_ROOT_HASHES.manifest);
      expect(publicFirst.fixtureGraphHash).toBe(PUBLIC_GRAPH_SHA256);
      expect(statSync(join(root, basename(m3Config.dbPath))).ino).not.toBe(statSync(join(root, basename(publicConfig.dbPath))).ino);

      const publicCounts = {
        sources: tableCount(publicDatabase, "source_config_fixture"),
        captured_items: tableCount(publicDatabase, "public_captured_item"),
        contents: tableCount(publicDatabase, "public_content"),
        summaries: tableCount(publicDatabase, "public_summary"),
        media_candidates: tableCount(publicDatabase, "public_media_candidate"),
        release_bundles: tableCount(publicDatabase, "public_release_bundle"),
        review_decisions: tableCount(publicDatabase, "public_review_decision"),
        publications: tableCount(publicDatabase, "public_publication"),
        published_projections: tableCount(publicDatabase, "published_projection")
      };
      expect(publicCounts).toEqual(PUBLIC_PROFILE_COUNTS);
      expect(tableCount(publicDatabase, "fixture_profile_ledger")).toBe(1);
      expect(publicDatabase.prepare(
        "SELECT COUNT(*) AS count FROM published_projection p JOIN public_publication u ON u.public_id=p.public_id AND u.published_version_hash=p.published_version_hash JOIN public_release_bundle b ON b.release_bundle_id=p.release_bundle_id JOIN public_review_decision d ON d.release_bundle_id=b.release_bundle_id AND d.approved_bundle_hash=b.bundle_hash WHERE p.projection_status='published' AND u.publication_status='published' AND b.release_status='approved' AND d.decision='approved'"
      ).get()).toMatchObject({ count: 12 });
      expect(() => publicDatabase.exec(`ATTACH DATABASE '${join(root, "forbidden.sqlite")}' AS other`)).toThrow();
      expect(() => seedPublicSyntheticFixture(m3, publicConfig, appRoot, projectRoot)).toThrow(/PROFILE_PATH_MIX/);
      expect(() => seedSourceFixture(publicDatabase, m3Config, appRoot, projectRoot)).toThrow(/PROFILE_PATH_MIX/);

      const sourceRows = (m3.prepare(`SELECT ${SOURCE_REQUIRED_FIELDS.join(", ")} FROM source_config_fixture ORDER BY source_id`).all() as Array<Record<string, unknown>>).map((row) =>
        Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => [field, field === "canonical_url_valid" || field === "enabled" ? Number(row[field]) === 1 : row[field]])) as SourceRow
      );
      expect(sourceRows).toHaveLength(59);
      expect(sourceRows.every((row) => row.enabled === false && row.source_id !== "src-active")).toBe(true);
      expect(sourceProjectionHash(sourceRows)).toBe(SOURCE_PROJECTION_SHA256);
      expect(tableCount(m3, "public_content")).toBe(0);
    } finally {
      closeDatabase(publicDatabase);
      closeDatabase(m3);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects root drift before seed writes and rolls back an injected mid-seed failure", () => {
    const shadow = tempRoot("f1plus1-v04-root-drift-");
    const shadowApp = join(shadow, "app");
    const shadowData = join(shadow, "data/mvp-contract-v0.4-public-synthetic");
    const dbRoot = join(shadow, "db");
    mkdirSync(shadowApp, { recursive: true, mode: 0o700 });
    mkdirSync(dbRoot, { recursive: true, mode: 0o700 });
    copyFiles(resolve(appRoot, "migrations"), join(shadowApp, "migrations"));
    copyFiles(resolve(projectRoot, "data/mvp-contract-v0.4-public-synthetic"), shadowData);
    const publicConfig = config("public-synthetic", { appRoot: shadowApp, projectRoot: shadow });
    const database = openProfile(dbRoot, publicConfig);
    try {
      migrateDatabase(database, join(shadowApp, "migrations"));
      const manifestPath = join(shadowData, "manifest.json");
      writeFileSync(manifestPath, Buffer.concat([readFileSync(manifestPath), Buffer.from("\n")]), { mode: 0o600 });
      expect(() => seedPublicSyntheticFixture(database, publicConfig, shadowApp, shadow)).toThrow(/PUBLIC_ROOT_DRIFT/);
      expect(tableCount(database, "fixture_profile_ledger")).toBe(0);
      expect(tableCount(database, "source_config_fixture")).toBe(0);
      expect(tableCount(database, "published_projection")).toBe(0);

      copyFileSync(resolve(projectRoot, "data/mvp-contract-v0.4-public-synthetic/manifest.json"), manifestPath);
      chmodSync(manifestPath, 0o600);
      expect(() => seedPublicSyntheticFixture(database, publicConfig, shadowApp, shadow, { testOnlyFailAfterWrites: 20 })).toThrow("PUBLIC_SEED_FAULT_INJECTED");
      for (const table of ["fixture_profile_ledger", "source_config_fixture", "public_captured_item", "public_content", "public_summary", "public_media_candidate", "public_release_bundle", "public_review_decision", "public_publication", "published_projection"]) {
        expect(tableCount(database, table), table).toBe(0);
      }
      const completed = seedPublicSyntheticFixture(database, publicConfig, shadowApp, shadow);
      expect(completed.inserted).toBe(true);
      expect(canonicalJson(completed.rowCounts)).toBe(canonicalJson(PUBLIC_PROFILE_COUNTS));
    } finally {
      closeDatabase(database);
      rmSync(shadow, { recursive: true, force: true });
    }
  });

  it("rolls back a failing appended migration without partial v3 objects", () => {
    const root = tempRoot("f1plus1-v04-migration-rollback-");
    const migrations = join(root, "migrations");
    copyFiles(resolve(appRoot, "migrations"), migrations);
    const third = join(migrations, "0003_public_synthetic_profile.sql");
    writeFileSync(third, `${readFileSync(third, "utf8")}\nINSERT INTO missing_fault_target VALUES (1);\n`, { mode: 0o600 });
    const database = openSafeDatabase(join(root, "state.sqlite"), { appRoot: root, allowTestRoot: root });
    try {
      expect(() => migrateDatabase(database, migrations)).toThrow();
      expect(readSqliteRuntime(database).userVersion).toBe(2);
      expect(tableCount(database, "migration_ledger")).toBe(2);
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name='fixture_profile_ledger'").get()).toBeUndefined();
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name='public_content'").get()).toBeUndefined();
      expect(createHash("sha256").update(readFileSync(resolve(appRoot, "migrations/0003_public_synthetic_profile.sql"))).digest("hex")).not.toBe(
        createHash("sha256").update(readFileSync(third)).digest("hex")
      );
    } finally {
      closeDatabase(database);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
