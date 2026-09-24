import { inspectBackup } from "../src/server/site-status/backup.ts";
import { readSiteStatusConfig, MAX_OUTPUT_BYTES } from "../src/server/site-status/config.ts";
import { sampleDatabase } from "../src/server/site-status/database.ts";
import { assembleSiteStatus, sampleHttp, sampleProcess, sampleStorage, SERVICE_LABELS, unknownSiteStatus, type SiteStatusResult } from "../src/server/site-status/runtime.ts";

async function main(): Promise<SiteStatusResult> {
  if (process.argv.length !== 2) return unknownSiteStatus("ARGUMENTS_REJECTED");
  if (process.versions.node !== "24.18.0") return unknownSiteStatus("RUNTIME_VERSION_INVALID");
  let config;
  try { config = readSiteStatusConfig(process.env.F1_STATUS_CONFIG_PATH); }
  catch { return unknownSiteStatus("CONFIG_INVALID"); }
  try {
    const processPromise = Promise.all(SERVICE_LABELS.map((service) => sampleProcess(service)));
    const httpPromise = Promise.all([sampleHttp("local-public", config), sampleHttp("admin-auth", config)]);
    const storagePromise = sampleStorage(config.storage);
    const database = sampleDatabase(config.database);
    const backup = inspectBackup(config.backup, database);
    const processes = await processPromise;
    const publicHttp = await sampleHttp("public-https", config, processes[2]);
    const http = await httpPromise;
    const storage = await storagePromise;
    return assembleSiteStatus(database, backup, [http[0], publicHttp, http[1]], processes, storage);
  } catch { return unknownSiteStatus("SAMPLER_FAILED"); }
}

// The Python supervisor enforces a 25-second wall limit even during synchronous SQLite / file reads.
const result = await main();
const output = JSON.stringify(result);
process.stdout.write(`${Buffer.byteLength(output) > MAX_OUTPUT_BYTES - 1 ? JSON.stringify(unknownSiteStatus("SAMPLER_OUTPUT_LIMIT")) : output}\n`);
