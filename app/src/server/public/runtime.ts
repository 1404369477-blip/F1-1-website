import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { closeDatabase, openSafeDatabase, type SqliteDatabase } from "../db/database.ts";
import { appRoot, loadRuntimeConfig, projectRoot } from "../runtime-config.ts";
import { PublicReadError } from "./error.ts";
import { PublicStoryRepository } from "./repository.ts";
import { PublicRealSnapshotReader } from "./snapshot-adapter.ts";
import type { PublicStoryReader } from "./http.ts";
import { withPublicMultimediaRuntimeDatabase } from "../db/public-multimedia-synthetic.ts";

export function withPublicStoryRepository<T>(callback: (repository: PublicStoryReader) => T): T {
  const config = loadRuntimeConfig();
  if ((config.publicReadMode ?? "public-multimedia-synthetic") === "public-real-snapshot") {
    if (!config.publicProjectionRoot || !config.publicVerifyKeyPath || !config.publicSigningKeyId) {
      throw new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
    }
    return callback(new PublicRealSnapshotReader({
      projectionRoot: config.publicProjectionRoot,
      signingKeyId: config.publicSigningKeyId,
      verifyKeyPath: config.publicVerifyKeyPath
    }));
  }
  if (config.dataProfile !== "public-synthetic" && config.dataProfile !== "public-multimedia-synthetic") throw new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
  const absolutePath = isAbsolute(config.dbPath) ? resolve(config.dbPath) : resolve(appRoot, config.dbPath);
  if (!existsSync(absolutePath)) throw new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
  if (config.dataProfile === "public-multimedia-synthetic") {
    return withPublicMultimediaRuntimeDatabase(config, appRoot, projectRoot, (database) =>
      callback(new PublicStoryRepository(database, config, appRoot, projectRoot))
    );
  }
  let database: SqliteDatabase | undefined;
  try {
    database = openSafeDatabase(config.dbPath, { appRoot });
    return callback(new PublicStoryRepository(database, config, appRoot, projectRoot));
  } finally {
    if (database) closeDatabase(database);
  }
}
