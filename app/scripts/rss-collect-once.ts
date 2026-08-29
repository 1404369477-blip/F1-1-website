import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { parseRssFeed } from "../src/server/rss/parser.ts";
import {
  attachAllowlistedOgImages,
  RSS_RUN_DEADLINE_MS,
  type ArticleFetcher,
} from "../src/server/rss/article-batch.ts";
import { RssRepository, rssSlotKey } from "../src/server/rss/repository.ts";
import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { adminRuntimeConfigFromDeployment, openReviewAdminDatabase } from "../src/server/admin-service/runtime.ts";
import {
  fetchFixedRss,
  type RssExternalAttemptRunner,
  type RssTrustedTransportInjection,
} from "../src/server/rss/transport.ts";
import {
  LIVE_RSS_SOURCES,
  type LiveRssSourceId,
} from "../src/server/rss/sources.ts";
import {
  RSS_PROFILE_ID,
  RSS_SOURCE_ID,
  RssError,
  rssFailureForReceipt,
  type ClaimedRssRun,
  type ParsedRssFeed,
  type RssModifiedResponse,
  type RssRunReceipt,
  RssAttemptLedger,
  type RssAttemptSnapshot,
} from "../src/server/rss/types.ts";

const adminDeploymentPath = resolve(
  homedir(),
  "Library/Application Support/F1Plus1/Admin/deployment.json",
);

function safeFailureReceipt(
  error: RssError,
  scheduledAt: string,
  sourceId: LiveRssSourceId = RSS_SOURCE_ID,
  attempts: RssAttemptSnapshot = {
    dnsAttempts: 0,
    dohAttempts: 0,
    httpAttempts: 0,
    successfulResourceReads: 0,
  },
): RssRunReceipt {
  const slotKey = rssSlotKey(scheduledAt);
  return {
    schemaVersion: "rss-real-receipt-v2",
    profile: RSS_PROFILE_ID,
    sourceId,
    runId:
      sourceId === RSS_SOURCE_ID
        ? `rss-run-${slotKey}`
        : `rss-run-${sourceId}-${slotKey}`,
    slotKey,
    status: "failed",
    reasonCode: error.reasonCode,
    nextAction: error.nextAction,
    externalCalls:
      attempts.dnsAttempts + attempts.dohAttempts + attempts.httpAttempts,
    logicalAttemptBoundaries:
      attempts.dnsAttempts + attempts.dohAttempts + attempts.httpAttempts,
    attemptDefinition:
      "dns_resolver_boundary+doh_http_request+resource_http_request",
    resourceReads: attempts.successfulResourceReads,
    externalCallBreakdown: attempts,
    responseSha256: null,
    itemCount: 0,
    selectedCount: 0,
    newCount: 0,
    updatedCount: 0,
    duplicateCount: 0,
  };
}

export async function collectOneSource(
  repository: RssRepository,
  sourceId: keyof typeof LIVE_RSS_SOURCES,
  scheduledAt: string,
  options: Readonly<{
    trustedTransport?: RssTrustedTransportInjection;
    env?: NodeJS.ProcessEnv;
    fetchArticleHtml?: ArticleFetcher;
    /** Test-only bounded deadline; production retains the fixed 60s contract. */
    runDeadlineMs?: number;
    /** Test-only observer for proving the ledger barrier around unresolved cleanup. */
    onLedgerCreated?: (ledger: RssAttemptLedger) => void;
    externalAttempt?: RssExternalAttemptRunner;
    externalAttemptOperationId?: string;
  }> = {},
): Promise<RssRunReceipt> {
  let run: ClaimedRssRun | undefined;
  let modifiedResponse: RssModifiedResponse | undefined;
  const attempts = new RssAttemptLedger();
  options.onLedgerCreated?.(attempts);
  const runDeadlineMs = options.runDeadlineMs ?? RSS_RUN_DEADLINE_MS;
  if (
    !Number.isSafeInteger(runDeadlineMs) ||
    runDeadlineMs <= 0 ||
    runDeadlineMs > RSS_RUN_DEADLINE_MS
  ) {
    throw new RssError("RUN_STATE_INVALID");
  }
  const deadlineAt = Date.now() + runDeadlineMs;
  const controller = new AbortController();
  // A terminal DB/ledger state is allowed only after every transport promise
  // has passed its close acknowledgement. Cleanup timeout deliberately leaves
  // this false: the run remains non-terminal and the ledger remains unsealed.
  let cleanupAcknowledged = false;
  const deadlineTimer = setTimeout(
    () =>
      controller.abort(
        new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" }),
      ),
    runDeadlineMs,
  );
  try {
    run = repository.claimRun(scheduledAt, new Date().toISOString(), sourceId);
    const source = repository.readSource(sourceId);
    const response = await fetchFixedRss({
      feedUrl: LIVE_RSS_SOURCES[sourceId].feedUrl,
      validators: source.validators,
      attempts,
      deadlineAt,
      signal: controller.signal,
      trustedTransport: options.trustedTransport,
      env: options.env,
      externalAttempt: options.externalAttempt,
      externalAttemptOperationId:
        options.externalAttemptOperationId ?? `${run.runId}-feed`,
      externalIdempotencyKey:
        options.externalAttemptOperationId === undefined
          ? undefined
          : `${options.externalAttemptOperationId}:feed`,
      reconcileKey:
        options.externalAttemptOperationId === undefined
          ? undefined
          : `${options.externalAttemptOperationId}:feed:reconcile`,
      onNetworkAttempt: () => {
        // The ledger is the receipt truth.  This callback remains for the
        // transport compatibility boundary and is intentionally side-effect free.
      },
    });
    if (response.kind === "not_modified") {
      if (controller.signal.aborted || Date.now() >= deadlineAt) {
        throw new RssError("BATCH_DEADLINE_EXCEEDED", {
          nextAction: "next_slot",
        });
      }
      cleanupAcknowledged = true;
      return repository.finalizeNotModified(run, response, {
        finishedAt: new Date().toISOString(),
        externalCalls: attempts.totalExternalCalls(),
        externalCallBreakdown: attempts.snapshot(),
      });
    }
    modifiedResponse = response;
    const feed = await attachAllowlistedOgImages(
      parseRssFeed(response.body, sourceId),
      sourceId,
      {
        attempts,
        deadlineAt,
        signal: controller.signal,
        trustedTransport: options.trustedTransport,
        env: options.env,
        fetchArticleHtml: options.fetchArticleHtml,
        externalAttempt: options.externalAttempt,
        externalAttemptOperationIdPrefix:
          options.externalAttemptOperationId === undefined
            ? `${run.runId}-article`
            : `${options.externalAttemptOperationId}-article`,
        externalIdempotencyKeyPrefix:
          options.externalAttemptOperationId === undefined
            ? `${run.runId}:article`
            : `${options.externalAttemptOperationId}:article`,
        reconcileKeyPrefix:
          options.externalAttemptOperationId === undefined
            ? `${run.runId}:article:reconcile`
            : `${options.externalAttemptOperationId}:article:reconcile`,
      },
    );
    cleanupAcknowledged = true;
    if (controller.signal.aborted || Date.now() >= deadlineAt) {
      throw new RssError("BATCH_DEADLINE_EXCEEDED", {
        nextAction: "next_slot",
      });
    }
    return repository.finalizeModified(run, response, feed, {
      finishedAt: new Date().toISOString(),
      externalCalls: attempts.totalExternalCalls(),
      externalCallBreakdown: attempts.snapshot(),
    });
  } catch (error) {
    if (
      error instanceof RssError &&
      error.reasonCode === "RESOURCE_CLEANUP_TIMEOUT"
    ) {
      // Do not write a failed receipt, finalize SQLite, or seal the attempt
      // ledger while a lower-level request may still be active. The caller's
      // worker/reaper owns this unresolved terminal barrier.
      cleanupAcknowledged = false;
      throw error;
    }
    cleanupAcknowledged = true;
    const failure = rssFailureForReceipt(error, attempts.snapshot());
    if (run) {
      try {
        return repository.finalizeFailure(run, failure, {
          finishedAt: new Date().toISOString(),
          externalCalls: attempts.totalExternalCalls(),
          externalCallBreakdown: attempts.snapshot(),
          ...(modifiedResponse ? { httpResponse: modifiedResponse } : {}),
        });
      } catch {
        return safeFailureReceipt(
          new RssError("SQLITE_FAILURE", {
            externalCalls: attempts.totalExternalCalls(),
          }),
          scheduledAt,
          sourceId,
          attempts.snapshot(),
        );
      }
    }
    return safeFailureReceipt(
      failure,
      scheduledAt,
      sourceId,
      attempts.snapshot(),
    );
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort(
      new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" }),
    );
    if (cleanupAcknowledged) attempts.seal();
  }
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

  let database:
    ReturnType<typeof openReviewAdminDatabase>["database"] | undefined;
  try {
    const deployment = readAdminDeploymentManifest(adminDeploymentPath);
    const config = adminRuntimeConfigFromDeployment(deployment);
    await config.releaseGate!.run("collector_network", async () => {
      const opened = openReviewAdminDatabase({
        targetReleaseAppRoot: deployment.targetReleaseAppRoot,
        reviewDatabasePath: deployment.reviewDatabasePath,
        reviewDatabaseIdentity: deployment.reviewDatabaseIdentity,
        requiredSchemaVersion: 10,
        ownerProcess: "rss_collector",
        releaseGate: config.releaseGate
      });
      database = opened.database;
      const repository = new RssRepository(database);
      const sources = repository.readEnabledSources();
      const targets = sources.length > 0 ? sources : [repository.readSource()];
      const receipts: RssRunReceipt[] = [];
      const externalAttempt = opened.mutationPort?.runExternal?.bind(opened.mutationPort);
      if (externalAttempt === undefined) throw new RssError("SQLITE_FAILURE");
      for (const source of targets) {
        const receipt = await collectOneSource(repository, source.sourceId, scheduledAt, { externalAttempt });
        receipts.push(receipt);
        console.log(JSON.stringify(receipt));
      }
      if (receipts.length === 0 || receipts.every((receipt) => receipt.status === "failed")) process.exitCode = 1;
    });
  } catch (error) {
    const failure = rssFailureForReceipt(error, false);
    console.log(JSON.stringify(safeFailureReceipt(failure, scheduledAt)));
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
