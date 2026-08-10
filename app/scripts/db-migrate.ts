import { resolve } from "node:path";

import { loadRuntimeConfig, appRoot } from "./runtime-config.ts";
import { closeDatabase, migrateDatabase, openSafeDatabase, readSqliteRuntime } from "../src/server/db/database.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { createPublicMultimediaCanonical } from "../src/server/db/public-multimedia-synthetic.ts";
import { acquireSourceManagementProfileLock, migrateSourceManagementDatabase } from "../src/server/db/source-management-synthetic.ts";

await runSafeCli(() => {
  const config = loadRuntimeConfig();
  if (config.dataProfile === "public-multimedia-synthetic") {
    const result = createPublicMultimediaCanonical(config, appRoot, resolve(appRoot, ".."));
    process.stdout.write(`${JSON.stringify({ command: "db:migrate", userVersion: 3, ...result })}\n`);
    return;
  }
  if (config.dataProfile === "source-management-synthetic") {
    const lock = acquireSourceManagementProfileLock(appRoot);
    const database = openSafeDatabase(config.dbPath, { appRoot });
    try {
      const result = migrateSourceManagementDatabase(database, appRoot);
      process.stdout.write(`${JSON.stringify({ command: "db:migrate", ...result, runtime: readSqliteRuntime(database) })}\n`);
    } finally {
      closeDatabase(database);
      lock.release();
    }
    return;
  }
  const database = openSafeDatabase(config.dbPath, { appRoot });
  let receipt;
  try {
    const result = migrateDatabase(database, resolve(appRoot, "migrations"));
    const runtime = readSqliteRuntime(database);
    receipt = { command: "db:migrate", ...result, runtime };
  } finally {
    closeDatabase(database);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
});
