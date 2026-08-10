import { loadRuntimeConfig, appRoot, projectRoot } from "./runtime-config.ts";
import { closeDatabase, migrateDatabase, openSafeDatabase } from "../src/server/db/database.ts";
import { seedSelectedProfile } from "../src/server/db/seed.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createPublicMultimediaCanonical, migratePublicMultimediaDatabase } from "../src/server/db/public-multimedia-synthetic.ts";
import { acquireSourceManagementProfileLock, migrateSourceManagementDatabase } from "../src/server/db/source-management-synthetic.ts";

await runSafeCli(() => {
  const config = loadRuntimeConfig();
  if (config.dataProfile === "public-multimedia-synthetic") {
    const absolute = resolve(appRoot, config.dbPath);
    if (!existsSync(absolute)) {
      const seed = createPublicMultimediaCanonical(config, appRoot, projectRoot);
      process.stdout.write(`${JSON.stringify({ command: "seed:fixtures", ...seed })}\n`);
      return;
    }
  }
  const sourceManagementLock = config.dataProfile === "source-management-synthetic"
    ? acquireSourceManagementProfileLock(appRoot)
    : undefined;
  const database = openSafeDatabase(config.dbPath, { appRoot });
  let receipt;
  try {
    if (config.dataProfile === "public-multimedia-synthetic") migratePublicMultimediaDatabase(database, projectRoot);
    else if (config.dataProfile === "source-management-synthetic") migrateSourceManagementDatabase(database, appRoot);
    else migrateDatabase(database, resolve(appRoot, "migrations"));
    const seed = seedSelectedProfile(database, config, appRoot, projectRoot);
    receipt = { command: "seed:fixtures", ...seed };
  } finally {
    closeDatabase(database);
    sourceManagementLock?.release();
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
});
