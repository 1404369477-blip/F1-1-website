import { createHash } from "node:crypto";
import { openExistingSafeDatabase } from "../db/database.ts";
import { openReviewAdminDatabase, type AdminRuntimeConfig } from "../admin-service/runtime.ts";
import { RSS_DATABASE_PATH, RssRepository, rssSlotKey } from "../rss/repository.ts";
import { RSS_SLOT_SECONDS, RssError, type RssRunReceipt } from "../rss/types.ts";
import type { RssExternalAttemptRunner, RssTrustedTransportInjection } from "../rss/transport.ts";
import { collectOneSource } from "../../../scripts/rss-collect-once.ts";
import { isRssAutomaticSchemaSha256 } from "./source-epoch-schema-identity.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../x-page/admission-schema-identity.ts";
import { createRssAutomaticHandoffProvider } from "./supervisor.ts";

export const RSS_COLLECTOR_SOURCE_ROUTES = Object.freeze({
  "motorsport-f1-news": "rss-route-motorsport",
  "the-race-f1-news": "rss-route-the-race",
  "skysports-f1-news": "rss-route-skysports"
} as const);
export const RSS_COLLECTOR_SOURCES = Object.freeze(["motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"] as const);
type CollectorSourceId = typeof RSS_COLLECTOR_SOURCES[number];
type CollectorConfig = Pick<AdminRuntimeConfig, "targetReleaseAppRoot" | "reviewDatabasePath" | "reviewDatabaseIdentity" | "reviewSchemaSha256" | "releaseGate" | "expectedDeploymentManifestSha256" | "expectedBackupReleaseSha256">;
type Skipped = Readonly<{ sourceId: CollectorSourceId; status: "skipped"; reasonCode: "SOURCE_STOPPED" | "SOURCE_NOT_ELIGIBLE" | "SLOT_ALREADY_RECORDED" | "RUN_IN_FLIGHT"; slotKey: number }>;
export type RssCollectorCycleReceipt = Readonly<{
  schemaVersion: "rss-automatic-collector-v1";
  status: "succeeded" | "failed";
  scheduledAt: string;
  slotKey: number;
  receipts: readonly (RssRunReceipt | Skipped)[];
}>;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
function assert(value: unknown, reasonCode: string): asserts value { if (!value) throw new Error(reasonCode); }
function assertRelease(config: CollectorConfig, env: NodeJS.ProcessEnv): void {
  assert(env.RSS_REAL_IO === "true", "RSS_COLLECTOR_IO_DISABLED");
  assert(typeof config.expectedDeploymentManifestSha256 === "string" && /^[0-9a-f]{64}$/u.test(config.expectedDeploymentManifestSha256) &&
    typeof config.expectedBackupReleaseSha256 === "string" && /^[0-9a-f]{64}$/u.test(config.expectedBackupReleaseSha256), "RSS_COLLECTOR_DEPLOYMENT_IDENTITY_REQUIRED");
  assert((isRssAutomaticSchemaSha256(config.reviewSchemaSha256 ?? "") || config.reviewSchemaSha256 === X_PAGE_ADMISSION_SCHEMA_SHA256) && config.releaseGate !== undefined &&
    config.releaseGate.receipt.schemaSha256 === config.reviewSchemaSha256 && config.releaseGate.receipt.role === "full_v10" &&
    config.releaseGate.allows("collector_network"), "RSS_COLLECTOR_RELEASE_CLOSED");
}
const skippedReasons = new Set(["SOURCE_STOPPED", "SOURCE_NOT_ELIGIBLE", "SLOT_ALREADY_RECORDED", "RUN_IN_FLIGHT"]);

/** A one-shot 900-second slot collector. The scheduler invokes this runner;
 * it registers no timer and can never expand beyond the three approved sources.
 */
export function createRssCollectorRuntime(config: CollectorConfig, options: Readonly<{
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Isolated transport injection, never accepted from the CLI. */
  trustedTransport?: RssTrustedTransportInjection;
}> = {}): Readonly<{ collect(): Promise<RssCollectorCycleReceipt>; close(): Promise<void> }> {
  const env = options.env ?? process.env;
  assertRelease(config, env);
  const gate = config.releaseGate!;
  const supervisorDatabase = openExistingSafeDatabase(config.reviewDatabasePath, RSS_DATABASE_PATH.split("/").at(-1)!, config.reviewDatabaseIdentity, [10]);
  let opened: ReturnType<typeof openReviewAdminDatabase> | undefined;
  try {
    const handoffProvider = createRssAutomaticHandoffProvider({ supervisorDatabase, releaseGate: gate, ownerProcess: "rss_collector",
      expectedDeploymentManifestSha256: config.expectedDeploymentManifestSha256!, expectedBackupReleaseSha256: config.expectedBackupReleaseSha256! });
    opened = openReviewAdminDatabase({ targetReleaseAppRoot: config.targetReleaseAppRoot, reviewDatabasePath: config.reviewDatabasePath,
      reviewDatabaseIdentity: config.reviewDatabaseIdentity, requiredSchemaVersion: 10, requiredSchemaSha256: config.reviewSchemaSha256,
      ownerProcess: "rss_collector", gatewayReleaseSha256: gate.receipt.sourcePreimageSha256,
      gatewayManifestSha256: gate.receipt.manifestSha256, ownerSupervisorHandoffProvider: handoffProvider });
    assert(opened.mutationPort?.runExternal !== undefined && opened.gateway !== null, "RSS_COLLECTOR_GATEWAY_REQUIRED");
    const { database, mutationPort, gateway } = opened;
    const repository = new RssRepository(database, mutationPort);
    let closing = false;
    let active: Promise<RssCollectorCycleReceipt> | null = null;
    let closePromise: Promise<void> | undefined;
    const collect = async (): Promise<RssCollectorCycleReceipt> => {
      assert(!closing, "RSS_COLLECTOR_CLOSED");
      assertRelease(config, env);
      const now = (options.now ?? (() => new Date()))();
      assert(Number.isFinite(now.getTime()), "RSS_COLLECTOR_CLOCK_INVALID");
      const slotKey = rssSlotKey(now.toISOString());
      const scheduledAt = new Date(slotKey * RSS_SLOT_SECONDS * 1000).toISOString();
      const receipts: (RssRunReceipt | Skipped)[] = [];
      for (const sourceId of RSS_COLLECTOR_SOURCES) {
        assertRelease(config, env);
        const source = repository.readSource(sourceId);
        if (!source.enabled) { receipts.push({ sourceId, status: "skipped", reasonCode: "SOURCE_STOPPED", slotKey }); continue; }
        const externalAttempt: RssExternalAttemptRunner = async input => {
          assertRelease(config, env);
          assert(input.operationKind === "collect" && input.ownerProcess === "rss_collector" && input.identity.sourceId === sourceId &&
            input.entityKind === "source" && input.entityId === sourceId && input.egressClass === "rss_https", "RSS_COLLECTOR_SOURCE_MISMATCH");
          const stopEpoch = repository.readSource(sourceId).stopEpoch;
          const identityHash = digest(`rss-collector-attempt-v1\n${sourceId}\n${input.operationId}\n${input.providerResource}`);
          const resourceIdentity = `rss-resource-${digest(input.providerResource)}`;
          return await mutationPort.runExternal!({ ...input, operationId: `rss-fetch-${identityHash}`,
            routeId: RSS_COLLECTOR_SOURCE_ROUTES[sourceId], budgetAccountId: "acct-rss", sourceStopEpoch: stopEpoch,
            externalIdempotencyKey: `rss-idem-${identityHash}`, reconcileKey: `rss-reconcile-${identityHash}`, providerResource: resourceIdentity,
            execute: async handle => {
              const result = await input.execute(handle);
              assert(result.response.providerResourceIdentity === input.providerResource, "RSS_COLLECTOR_RESOURCE_MISMATCH");
              return { value: result.value, response: { ...result.response, providerResourceIdentity: resourceIdentity } };
            }
          });
        };
        const result = await collectOneSource(repository, sourceId, scheduledAt, { env, trustedTransport: options.trustedTransport, externalAttempt });
        if (result.status === "failed" && skippedReasons.has(result.reasonCode)) {
          receipts.push({ sourceId, status: "skipped", reasonCode: result.reasonCode as Skipped["reasonCode"], slotKey });
        } else receipts.push(result);
      }
      return Object.freeze({ schemaVersion: "rss-automatic-collector-v1", status: receipts.some(receipt => receipt.status === "failed") ? "failed" : "succeeded",
        scheduledAt, slotKey, receipts: Object.freeze(receipts) });
    };
    return Object.freeze({
      collect: () => {
        if (closing) return Promise.reject(new RssError("RUN_STATE_INVALID"));
        if (active !== null) return active;
        active = collect().finally(() => { active = null; });
        return active;
      },
      close: () => {
        if (closePromise !== undefined) return closePromise;
        closing = true;
        closePromise = Promise.allSettled([active]).then(() => {
          try { gateway.close(); } finally { try { database.close(); } finally { supervisorDatabase.close(); } }
        });
        return closePromise;
      }
    });
  } catch (error) {
    try { opened?.gateway?.close(); } finally { try { opened?.database.close(); } finally { supervisorDatabase.close(); } }
    throw error;
  }
}
