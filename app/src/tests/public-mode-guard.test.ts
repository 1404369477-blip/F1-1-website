import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loadAppConfig, type EnvRecord } from "../server/config/env";
import { closeDatabase, migrateDatabase, openSafeDatabase } from "../server/db/database";
import { seedPublicSyntheticFixture } from "../server/db/public-synthetic";
import { handlePublicFeed, handlePublicStory } from "../server/public/http";
import { PublicStoryRepository } from "../server/public/repository";
import { installNoEgressGuard } from "../server/vs1/no-egress";

const appRoot = resolve(import.meta.dirname, "../..");
const projectRoot = resolve(appRoot, "..");
const temporaryRoots: string[] = [];
const noEgress = installNoEgressGuard();

function publicSyntheticEnvironment(): EnvRecord {
  return {
    APP_ENV: "test",
    APP_PORT: "3014",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3014",
    F1_DATA_PROFILE: "public-synthetic",
    F1_DB_PATH: ".local/f1plus1-public-synthetic.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "none",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function canonicalTemporaryRoot(): string {
  const base = process.env.TMPDIR === "/private/tmp" ? "/private/tmp" : join("/private", "tmp");
  const root = join(base, `f1-public-mode-guard-${randomUUID()}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  expect(noEgress.externalCalls).toBe(0);
  noEgress.restore();
});

describe("public read-mode guard", () => {
  it("explicitly rejects bilingual v2 on a synthetic profile while keeping the declared V1 route readable", async () => {
    const config = loadAppConfig(publicSyntheticEnvironment(), { appRoot, projectRoot, strictKeys: true });
    const root = canonicalTemporaryRoot();
    const database = openSafeDatabase(join(root, "f1plus1-public-synthetic.sqlite"), { appRoot, allowTestRoot: root });
    try {
      migrateDatabase(database, resolve(appRoot, "migrations"));
      seedPublicSyntheticFixture(database, config, appRoot, projectRoot);
      const repository = new PublicStoryRepository(database, config, appRoot, projectRoot);
      const legacy = await handlePublicFeed(new Request("http://127.0.0.1:3014/api/public/feed"), repository).json() as {
        schemaVersion: string;
        items: Array<{ publicId: string }>;
      };
      expect(legacy.schemaVersion).toBe("public-read-v0.1");
      expect(legacy.items.length).toBeGreaterThan(0);

      const requestedBilingual = handlePublicFeed(
        new Request("http://127.0.0.1:3014/api/public/feed?v=2&limit=12"),
        repository
      );
      expect(requestedBilingual.status).toBe(406);
      expect((await requestedBilingual.json() as { reasonCode: string }).reasonCode)
        .toBe("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
      expect(handlePublicStory(
        legacy.items[0].publicId,
        repository,
        new Request(`http://127.0.0.1:3014/api/public/stories/${legacy.items[0].publicId}?v=2`)
      ).status).toBe(406);
    } finally {
      closeDatabase(database);
    }
  });

});
