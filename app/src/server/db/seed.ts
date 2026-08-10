export {
  assertSourceFixtureSeeded,
  seedSourceFixture,
  type SourceSeedResult
} from "./source.ts";
export {
  assertPublicSyntheticSeeded,
  seedPublicSyntheticFixture,
  type PublicSyntheticSeedResult
} from "./public-synthetic.ts";

import type { AppConfig } from "../config/env.ts";
import type { SqliteDatabase } from "./database.ts";
import { seedPublicSyntheticFixture, type PublicSyntheticSeedResult } from "./public-synthetic.ts";
import { seedSourceFixture, type SourceSeedResult } from "./source.ts";
import { seedPublicMultimediaFixture, type PublicMultimediaSeedResult } from "./public-multimedia-synthetic.ts";
import { initializeSourceManagementProfile } from "./source-management-synthetic.ts";

export type SourceManagementSeedResult = ReturnType<typeof initializeSourceManagementProfile>;

export function seedSelectedProfile(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): SourceSeedResult | PublicSyntheticSeedResult | PublicMultimediaSeedResult | SourceManagementSeedResult {
  return config.dataProfile === "m3-shadow"
    ? seedSourceFixture(database, config, appRoot, projectRoot)
    : config.dataProfile === "public-synthetic"
      ? seedPublicSyntheticFixture(database, config, appRoot, projectRoot)
      : config.dataProfile === "public-multimedia-synthetic"
        ? seedPublicMultimediaFixture(database, config, projectRoot)
        : initializeSourceManagementProfile(database, config, appRoot, projectRoot);
}
