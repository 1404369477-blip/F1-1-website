import { homedir } from "node:os";
import { resolve } from "node:path";

import { parseRssFeed } from "../src/server/rss/parser.ts";
import {
  RssRepository,
  rssSlotKey
} from "../src/server/rss/repository.ts";
import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { openReviewAdminDatabase } from "../src/server/admin-service/runtime.ts";
import { fetchFixedRss } from "../src/server/rss/transport.ts";
import {
  RSS_PROFILE_ID,
  RSS_SOURCE_ID,
  RssError,
  rssFailureForReceipt,
  type ClaimedRssRun,
  type RssModifiedResponse,
  type RssRunReceipt
} from "../src/server/rss/types.ts";

const adminDeploymentPath = resolve(
  homedir(),
  "Library/Application Support/F1Plus1/Admin/deployment.json"
);

function safeFailureReceipt(error: RssError, scheduledAt: string): RssRunReceipt {
  const slotKey = rssSlotKey(scheduledAt);
  return {
    schemaVersion: "rss-real-receipt-v1",
    profile: RSS_PROFILE_ID,
    sourceId: RSS_SOURCE_ID,
    runId: `rss-run-${slotKey}`,
    slotKey,
    status: "failed",
    reasonCode: error.reasonCode,
    nextAction: error.nextAction,
    externalCalls: error.externalCalls,
    responseSha256: null,
    itemCount: 0,
    selectedCount: 0,
    newCount: 0,
    updatedCount: 0,
    duplicateCount: 0
  };
}

async function main(): Promise<void> {
  process.umask(0o077);
  const scheduledAt = new Date().toISOString();
  if (process.argv.length !== 2) {
    const failure = new RssError("CLI_ARGUMENTS_FORBIDDEN");
    console.log(JSON.stringify(safeFailureReceipt(failure, scheduledAt)));
    process.exitCode = 1;
    return;
  }

  let database: ReturnType<typeof openReviewAdminDatabase>["database"] | undefined;
  let repository: RssRepository | undefined;
  let run: ClaimedRssRun | undefined;
  let modifiedResponse: RssModifiedResponse | undefined;
  let networkAttempted = false;
  try {
    const deployment = readAdminDeploymentManifest(adminDeploymentPath);
    database = openReviewAdminDatabase({
      targetReleaseAppRoot: deployment.targetReleaseAppRoot,
      reviewDatabasePath: deployment.reviewDatabasePath,
      reviewDatabaseIdentity: deployment.reviewDatabaseIdentity
    }).database;
    repository = new RssRepository(database);
    run = repository.claimRun(scheduledAt, new Date().toISOString());
    const source = repository.readSource();
    const response = await fetchFixedRss({
      validators: source.validators,
      onNetworkAttempt: () => {
        networkAttempted = true;
      }
    });
    const finishedAt = new Date().toISOString();
    if (response.kind === "not_modified") {
      console.log(JSON.stringify(repository.finalizeNotModified(run, response, { finishedAt, externalCalls: 1 })));
      return;
    }
    modifiedResponse = response;
    const feed = parseRssFeed(response.body);
    console.log(JSON.stringify(repository.finalizeModified(run, response, feed, { finishedAt, externalCalls: 1 })));
  } catch (error) {
    const failure = rssFailureForReceipt(error, networkAttempted);
    const externalCalls = failure.externalCalls;
    let output = safeFailureReceipt(failure, scheduledAt);
    if (repository && run) {
      try {
        output = repository.finalizeFailure(run, failure, {
          finishedAt: new Date().toISOString(),
          externalCalls,
          ...(modifiedResponse ? { httpResponse: modifiedResponse } : {})
        });
      } catch {
        output = safeFailureReceipt(new RssError("SQLITE_FAILURE", { externalCalls }), scheduledAt);
      }
    }
    console.log(JSON.stringify(output));
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}

await main();
