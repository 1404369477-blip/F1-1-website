import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loadAppConfig, type EnvRecord } from "../server/config/env";
import { closeDatabase, migrateDatabase, openSafeDatabase, withImmediateTransaction, type SqliteDatabase } from "../server/db/database";
import {
  PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
  assertLegacyClosedReceipts,
  assertPublicMultimediaSeeded,
  migratePublicMultimediaDatabase,
  publicMultimediaMigrationSelector,
  seedPublicMultimediaFixture
} from "../server/db/public-multimedia-synthetic";
import { getHealthDto } from "../server/health";
import { handlePublicFeed, handlePublicStory, PUBLIC_V2_MEDIA_TYPE } from "../server/public/http";
import { PublicStoryRepository } from "../server/public/repository";
import { installNoEgressGuard } from "../server/vs1/no-egress";
import { seedPublicSyntheticFixture } from "../server/db/public-synthetic";

const projectRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(projectRoot, "app");
const tempRoots: string[] = [];
const noEgress = installNoEgressGuard();

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function env(): EnvRecord {
  return {
    APP_ENV: "test",
    APP_PORT: "3013",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3013",
    F1_DATA_PROFILE: "public-multimedia-synthetic",
    F1_DB_PATH: ".local/f1plus1-public-multimedia-synthetic.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: "../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json",
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

function config() {
  return loadAppConfig(env(), { appRoot, projectRoot, strictKeys: true });
}

function publicSyntheticConfig() {
  return loadAppConfig({
    ...env(),
    F1_DATA_PROFILE: "public-synthetic",
    F1_DB_PATH: ".local/f1plus1-public-synthetic.sqlite",
    SOURCE_FIXTURE_PATH: "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
  }, { appRoot, projectRoot, strictKeys: true });
}

function tempDatabase(): { root: string; path: string; database: SqliteDatabase } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1plus1-public-mm-"));
  tempRoots.push(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "f1plus1-public-multimedia-synthetic.sqlite");
  return { root, path, database: openSafeDatabase(path, { appRoot, allowTestRoot: root }) };
}

function migrateAndSeed(): { root: string; path: string; database: SqliteDatabase } {
  const fixture = tempDatabase();
  migratePublicMultimediaDatabase(fixture.database, projectRoot);
  seedPublicMultimediaFixture(fixture.database, config(), projectRoot);
  return fixture;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  expect(noEgress.externalCalls).toBe(0);
  noEgress.restore();
});

describe("DEV-MM-01..03 public multimedia backend", () => {
  it("keeps the legacy closed bytes frozen and selects only the exact three migrations", () => {
    const protectedFiles = new Map([
      ["app/.local/f1plus1.sqlite", "df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0"],
      ["app/.local/f1plus1-public-synthetic.sqlite", "24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041"],
      ["app/migrations/0001_local_foundation.sql", "9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176"],
      ["app/migrations/0002_source_fixture.sql", "12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031"],
      ["app/migrations/0003_public_synthetic_profile.sql", "57df4d990cded9d69551d0acf97615ef5d9fd3d5ecceb05ebb10d3812549498a"]
    ]);
    assertLegacyClosedReceipts(projectRoot);
    for (const [path, expected] of protectedFiles) expect(sha256File(resolve(projectRoot, path))).toBe(expected);
    expect(publicMultimediaMigrationSelector(projectRoot).map(({ id }) => id)).toEqual([
      "0001_local_foundation.sql",
      "0002_source_fixture.sql",
      "profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql"
    ]);
    expect(PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("migrates, atomically seeds 0/1/4, rejects a fifth image, and stays idempotent", () => {
    const fixture = tempDatabase();
    const migration = migratePublicMultimediaDatabase(fixture.database, projectRoot);
    expect(migration).toMatchObject({ userVersion: 3, schemaFingerprintSha256: PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256 });
    expect(migration.applied).toHaveLength(3);
    const first = seedPublicMultimediaFixture(fixture.database, config(), projectRoot);
    const second = seedPublicMultimediaFixture(fixture.database, config(), projectRoot);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second).toMatchObject({
      fixtureGraphHash: PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
      profileLedgerRootSha256: PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256,
      realMedia: 0,
      externalCalls: 0,
      writesToBase: false
    });
    const mediaCounts = fixture.database.prepare("SELECT content_id, COUNT(*) AS count FROM public_media_candidate GROUP BY content_id ORDER BY count").all();
    expect(mediaCounts.filter((row) => Number(row.count) === 1)).toHaveLength(8);
    expect(mediaCounts.filter((row) => Number(row.count) === 4)).toHaveLength(8);
    expect(() => withImmediateTransaction(fixture.database, () => {
      fixture.database.prepare("INSERT INTO public_media_candidate (media_candidate_id,content_id,media_hash,candidate_status,payload_json) VALUES (?,?,?,?,?)")
        .run("media-page2-legends-history-22-5", "content-page2-legends-history-22", "f".repeat(64), "selected", "{}");
    })).toThrow(/PUBLIC_MEDIA_LIMIT_EXCEEDED/);
    expect(() => withImmediateTransaction(fixture.database, () => {
      fixture.database.prepare("UPDATE public_media_candidate SET content_id=? WHERE media_candidate_id=?")
        .run("content-page2-legends-history-22", "media-page2-driver-social-23-1");
    })).toThrow(/PUBLIC_MEDIA_LIMIT_EXCEEDED/);
    expect(Number((fixture.database.prepare("SELECT COUNT(*) AS count FROM public_media_candidate").get() as { count: number }).count)).toBe(40);
    expect(() => fixture.database.exec("ATTACH DATABASE ':memory:' AS forbidden")).toThrow();
    closeDatabase(fixture.database);
    const health = getHealthDto({
      appRoot,
      projectRoot,
      config: config(),
      dbPath: fixture.path,
      databaseOptions: { appRoot, allowTestRoot: fixture.root }
    });
    expect(health).toMatchObject({
      status: "ready",
      dataGate: "accepted-public-multimedia-synthetic",
      externalCalls: 0,
      runtime: {
        migration: "public-multimedia-synthetic-0003",
        seed: "24-public-multimedia-pagination",
        contractVersion: "public-read-v0.2",
        fixtureGraphHash: PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256
      }
    });
    expect(JSON.stringify(health)).not.toContain(projectRoot);
  });

  it("rolls every injected seed write failure back to zero domain rows", () => {
    for (let failAfter = 1; failAfter <= 210; failAfter += 1) {
      const fixture = tempDatabase();
      migratePublicMultimediaDatabase(fixture.database, projectRoot);
      expect(() => seedPublicMultimediaFixture(fixture.database, config(), projectRoot, { testOnlyFailAfterWrites: failAfter }))
        .toThrow(/PUBLIC_MULTIMEDIA_SEED_FAULT_INJECTED/);
      for (const table of ["source_config_fixture", "public_captured_item", "public_content", "public_summary", "public_media_candidate", "public_release_bundle", "public_review_decision", "public_publication", "published_projection", "fixture_profile_ledger"]) {
        expect(Number((fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count), table).toBe(0);
      }
      closeDatabase(fixture.database);
    }
  });

  it("negotiates one V1/V2 version across feed, detail and related and fails closed", async () => {
    const fixture = migrateAndSeed();
    const repository = new PublicStoryRepository(fixture.database, config(), appRoot, projectRoot);
    for (const accept of [undefined, "*/*", "application/json"]) {
      const headers = accept ? { Accept: accept } : undefined;
      const response = handlePublicFeed(new Request("http://127.0.0.1:3013/api/public/feed", { headers }), repository);
      expect(response.status).toBe(200);
      const body = await response.json() as { schemaVersion: string; items: Array<{ media: unknown }> };
      expect(body.schemaVersion).toBe("public-read-v0.1");
      expect(body.items).toHaveLength(12);
      expect(body.items.every((item) => !Array.isArray(item.media))).toBe(true);
    }
    const v2Request = new Request("http://127.0.0.1:3013/api/public/feed", { headers: { Accept: PUBLIC_V2_MEDIA_TYPE } });
    const v2 = handlePublicFeed(v2Request, repository);
    expect(v2.status).toBe(200);
    const v2Body = await v2.json() as { schemaVersion: string; items: Array<{ publicId: string; media: unknown[] }> };
    expect(v2Body.schemaVersion).toBe("public-read-v0.2");
    expect(v2Body.items).toHaveLength(12);
    expect(v2Body.items.map((item) => item.media.length).sort()).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 4, 4]);
    const detail = handlePublicStory("public-page2-legends-history-22", repository, new Request("http://127.0.0.1:3013/api/public/stories/public-page2-legends-history-22", { headers: { Accept: PUBLIC_V2_MEDIA_TYPE } }));
    const detailBody = await detail.json() as { schemaVersion: string; story: { media: unknown[] }; relatedItems: Array<{ media: unknown[] }> };
    expect(detail.status).toBe(200);
    expect(detailBody.schemaVersion).toBe("public-read-v0.2");
    expect(detailBody.story.media).toHaveLength(4);
    expect(detailBody.relatedItems).toHaveLength(3);
    expect(detailBody.relatedItems.every((item) => Array.isArray(item.media))).toBe(true);
    for (const accept of ["text/plain", "application/json, */*", `${PUBLIC_V2_MEDIA_TYPE};q=1`, "application/vnd.f1plus1.public-read-v9+json", "not a media type"]) {
      const response = handlePublicFeed(new Request("http://127.0.0.1:3013/api/public/feed", { headers: { Accept: accept } }), repository);
      expect(response.status, accept).toBe(406);
      expect((await response.json() as { reasonCode: string }).reasonCode).toBe("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    }
    const assertIntegrityFailure = async (): Promise<void> => {
      const failed = handlePublicFeed(v2Request, repository);
      expect(failed.status).toBe(500);
      const problem = await failed.json() as { reasonCode: string };
      expect(problem.reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");
      expect(JSON.stringify(problem)).not.toMatch(/\/Users\/|stack|SELECT|content_hash_input|rights_status/i);
    };
    fixture.database.prepare("UPDATE public_media_candidate SET media_hash=? WHERE media_candidate_id=?").run("0".repeat(64), "media-page2-driver-social-23-1");
    await assertIntegrityFailure();
    const brokenRelated = handlePublicStory("public-page2-legends-history-22", repository, new Request("http://127.0.0.1:3013/api/public/stories/public-page2-legends-history-22", { headers: { Accept: PUBLIC_V2_MEDIA_TYPE } }));
    expect(brokenRelated.status).toBe(500);
    expect((await brokenRelated.json() as { reasonCode: string }).reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");
    const mediaPayload = JSON.parse(String((fixture.database.prepare("SELECT payload_json FROM public_media_candidate WHERE media_candidate_id='media-page2-driver-social-23-1'").get() as { payload_json: string }).payload_json));
    fixture.database.prepare("UPDATE public_media_candidate SET media_hash=? WHERE media_candidate_id=?").run(mediaPayload.media_hash, "media-page2-driver-social-23-1");
    for (const field of ["license_status", "safety_status"] as const) {
      const changed = { ...mediaPayload, [field]: "rejected" };
      fixture.database.prepare("UPDATE public_media_candidate SET payload_json=? WHERE media_candidate_id=?").run(JSON.stringify(changed), "media-page2-driver-social-23-1");
      await assertIntegrityFailure();
      fixture.database.prepare("UPDATE public_media_candidate SET payload_json=? WHERE media_candidate_id=?").run(JSON.stringify(mediaPayload), "media-page2-driver-social-23-1");
    }
    const bundlePayload = JSON.parse(String((fixture.database.prepare("SELECT payload_json FROM public_release_bundle WHERE release_bundle_id='bundle-page2-legends-history-22'").get() as { payload_json: string }).payload_json));
    const reordered = { ...bundlePayload, media_refs: [...bundlePayload.media_refs].reverse() };
    fixture.database.prepare("UPDATE public_release_bundle SET payload_json=? WHERE release_bundle_id=?").run(JSON.stringify(reordered), "bundle-page2-legends-history-22");
    await assertIntegrityFailure();
    const duplicated = { ...bundlePayload, media_refs: [bundlePayload.media_refs[0], bundlePayload.media_refs[0], ...bundlePayload.media_refs.slice(2)] };
    fixture.database.prepare("UPDATE public_release_bundle SET payload_json=? WHERE release_bundle_id=?").run(JSON.stringify(duplicated), "bundle-page2-legends-history-22");
    await assertIntegrityFailure();
    closeDatabase(fixture.database);
  });

  it("rejects an abnormal fifth stored image at the API and preserves the frozen V1-only profile", async () => {
    const multimedia = migrateAndSeed();
    multimedia.database.exec("DROP TRIGGER public_media_candidate_max_four_before_insert; DROP TRIGGER public_media_candidate_max_four_before_content_update;");
    multimedia.database.prepare("INSERT INTO public_media_candidate (media_candidate_id,content_id,media_hash,candidate_status,payload_json) VALUES (?,?,?,?,?)")
      .run("media-page2-legends-history-22-5", "content-page2-legends-history-22", "f".repeat(64), "selected", "{}");
    multimedia.database.exec(`
      CREATE TRIGGER public_media_candidate_max_four_before_insert BEFORE INSERT ON public_media_candidate
      WHEN (SELECT COUNT(*) FROM public_media_candidate WHERE content_id = NEW.content_id) >= 4
      BEGIN SELECT RAISE(ABORT, 'PUBLIC_MEDIA_LIMIT_EXCEEDED'); END;
      CREATE TRIGGER public_media_candidate_max_four_before_content_update BEFORE UPDATE OF content_id ON public_media_candidate
      WHEN NEW.content_id <> OLD.content_id AND (SELECT COUNT(*) FROM public_media_candidate WHERE content_id = NEW.content_id) >= 4
      BEGIN SELECT RAISE(ABORT, 'PUBLIC_MEDIA_LIMIT_EXCEEDED'); END;
    `);
    const multimediaRepository = new PublicStoryRepository(multimedia.database, config(), appRoot, projectRoot);
    const fifth = handlePublicFeed(new Request("http://127.0.0.1:3013/api/public/feed", { headers: { Accept: PUBLIC_V2_MEDIA_TYPE } }), multimediaRepository);
    expect(fifth.status).toBe(500);
    expect((await fifth.json() as { reasonCode: string }).reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");
    closeDatabase(multimedia.database);

    const legacy = tempDatabase();
    closeDatabase(legacy.database);
    const legacyPath = join(legacy.root, "f1plus1-public-synthetic.sqlite");
    const legacyDatabase = openSafeDatabase(legacyPath, { appRoot, allowTestRoot: legacy.root });
    migrateDatabase(legacyDatabase, resolve(appRoot, "migrations"));
    const legacyConfig = publicSyntheticConfig();
    seedPublicSyntheticFixture(legacyDatabase, legacyConfig, appRoot, projectRoot);
    const legacyRepository = new PublicStoryRepository(legacyDatabase, legacyConfig, appRoot, projectRoot);
    const v1 = handlePublicFeed(new Request("http://127.0.0.1:3013/api/public/feed"), legacyRepository);
    expect(v1.status).toBe(200);
    expect((await v1.json() as { schemaVersion: string; items: unknown[] })).toMatchObject({ schemaVersion: "public-read-v0.1", items: expect.any(Array) });
    const v2 = handlePublicFeed(new Request("http://127.0.0.1:3013/api/public/feed", { headers: { Accept: PUBLIC_V2_MEDIA_TYPE } }), legacyRepository);
    expect(v2.status).toBe(406);
    expect((await v2.json() as { reasonCode: string }).reasonCode).toBe("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    closeDatabase(legacyDatabase);
  });
});
