import { ogImageFromHtml, rssItemWithMedia } from "./parser.ts";
import {
  fetchAllowlistedArticleHtml,
  RSS_RESOURCE_CLEANUP_GRACE_MS,
  type RssExternalAttemptRunner,
  type RssTrustedTransportInjection,
} from "./transport.ts";
import {
  RssAttemptLedger,
  RssError,
  type ParsedRssFeed,
  type RssItem,
} from "./types.ts";
import {
  RACEFANS_SOURCE_ID,
  liveRssSource,
  type LiveRssSourceId,
} from "./sources.ts";

export const RSS_ARTICLE_BATCH_MAX = 20 as const;
export const RSS_ARTICLE_BATCH_CONCURRENCY = 4 as const;
export const RSS_RUN_DEADLINE_MS = 60_000 as const;

export type ArticleFetchOperation = Readonly<{
  /** Result bytes and the lower-level close acknowledgement are separate. */
  result: Promise<string>;
  cleanup: Promise<void>;
  /** Optional audited hard-terminal reaper for a non-cooperative provider. */
  reap?: () => Promise<void>;
}>;

export type ArticleFetcher = (
  input: Readonly<{
    articleUrl: string;
    sourceId: LiveRssSourceId;
    attempts: RssAttemptLedger;
    deadlineAt: number;
    signal: AbortSignal;
    trustedTransport?: RssTrustedTransportInjection;
    env?: NodeJS.ProcessEnv;
    externalAttempt?: RssExternalAttemptRunner;
    externalAttemptOperationId?: string;
    externalIdempotencyKey?: string;
    reconcileKey?: string;
  }>,
) => Promise<string> | ArticleFetchOperation;

function aborted(): RssError {
  return new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" });
}

function abortable<T>(
  input:
    | Promise<T>
    | Readonly<{
        result: Promise<T>;
        cleanup: Promise<void>;
        reap?: () => Promise<void>;
      }>,
  signal: AbortSignal,
): Promise<T> {
  const operation =
    input instanceof Promise
      ? { result: input, cleanup: input.then(() => undefined) }
      : input;
  return new Promise<T>((resolve, reject) => {
    let abortRequested = false;
    let cleanupGraceExpired = false;
    let bodySettled = false;
    let cleanupSettled = false;
    let bodyValue: T | undefined;
    let bodyError: unknown;
    let cleanupTimer: NodeJS.Timeout | undefined;
    let reaperTimer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (!cleanupSettled || (!abortRequested && !bodySettled)) return;
      signal.removeEventListener("abort", onAbort);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (reaperTimer) clearTimeout(reaperTimer);
      if (abortRequested) {
        reject(
          cleanupGraceExpired
            ? new RssError("RESOURCE_CLEANUP_TIMEOUT", {
                nextAction: "next_slot",
              })
            : aborted(),
        );
      } else if (bodyError !== undefined) {
        reject(bodyError);
      } else {
        resolve(bodyValue as T);
      }
    };
    const onAbort = (): void => {
      abortRequested = true;
      // A deadline is only a cancellation request. The promise returned by
      // the production transport settles after its request/response/socket
      // close acknowledgement, so this wrapper must not settle early while a
      // resource is still active. The grace timer records an unknown cleanup
      // state; it never fabricates a close acknowledgement.
      cleanupTimer = setTimeout(() => {
        cleanupGraceExpired = true;
        // A provider that exposes an audited hard-terminal reaper gets one
        // bounded escalation opportunity. We still wait for cleanupSettled;
        // invoking a reaper is not itself a close acknowledgement.
        if ("reap" in operation && typeof operation.reap === "function") {
          reaperTimer = setTimeout(() => {
            void operation.reap!().catch(() => undefined);
          }, RSS_RESOURCE_CLEANUP_GRACE_MS);
        }
      }, RSS_RESOURCE_CLEANUP_GRACE_MS + 50);
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.result.then(
      (value) => {
        bodySettled = true;
        bodyValue = value;
        finish();
      },
      (error) => {
        bodySettled = true;
        bodyError = error;
        finish();
      },
    );
    operation.cleanup.then(
      () => {
        cleanupSettled = true;
        finish();
      },
      (error) => {
        cleanupSettled = true;
        bodyError = error;
        finish();
      },
    );
    // The signal may already be aborted before the operation is attached.
    // Register both promises first so this race observes the same close
    // acknowledgement barrier as an abort delivered by the event listener.
    if (signal.aborted) onAbort();
  });
}

export async function attachAllowlistedOgImages(
  feed: ParsedRssFeed,
  sourceId: LiveRssSourceId,
  options: Readonly<{
    attempts: RssAttemptLedger;
    deadlineAt: number;
    signal?: AbortSignal;
    fetchArticleHtml?: ArticleFetcher;
    trustedTransport?: RssTrustedTransportInjection;
    env?: NodeJS.ProcessEnv;
    externalAttempt?: RssExternalAttemptRunner;
    externalAttemptOperationIdPrefix?: string;
    externalIdempotencyKeyPrefix?: string;
    reconcileKeyPrefix?: string;
  }>,
): Promise<ParsedRssFeed> {
  if (sourceId !== RACEFANS_SOURCE_ID) return feed;
  const source = liveRssSource(sourceId);
  const items = feed.items.slice(0, RSS_ARTICLE_BATCH_MAX);
  const output: RssItem[] = [...items];
  const failures: unknown[] = [];
  let cursor = 0;
  const fetcher =
    options.fetchArticleHtml ?? ((input) => fetchAllowlistedArticleHtml(input));
  const controller = new AbortController();
  const abortFromParent = (): void =>
    controller.abort(options.signal?.reason ?? aborted());
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  if (options.signal?.aborted) abortFromParent();
  const remaining = Math.max(0, options.deadlineAt - Date.now());
  const deadlineTimer = setTimeout(
    () => controller.abort(aborted()),
    remaining,
  );

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item.media !== null) continue;
      if (controller.signal.aborted || Date.now() >= options.deadlineAt) {
        failures.push(
          new RssError("BATCH_DEADLINE_EXCEEDED", { nextAction: "next_slot" }),
        );
        return;
      }
      try {
        const html = await abortable(
          fetcher({
            articleUrl: item.canonicalUrl,
            sourceId,
            attempts: options.attempts,
            deadlineAt: options.deadlineAt,
            signal: controller.signal,
            trustedTransport: options.trustedTransport,
            env: options.env,
            externalAttempt: options.externalAttempt,
            externalAttemptOperationId:
              options.externalAttemptOperationIdPrefix === undefined
                ? undefined
                : `${options.externalAttemptOperationIdPrefix}-${index}`,
            externalIdempotencyKey:
              options.externalIdempotencyKeyPrefix === undefined
                ? undefined
                : `${options.externalIdempotencyKeyPrefix}-${index}`,
            reconcileKey:
              options.reconcileKeyPrefix === undefined
                ? undefined
                : `${options.reconcileKeyPrefix}-${index}`,
          }),
          controller.signal,
        );
        output[index] = rssItemWithMedia(item, ogImageFromHtml(html, source));
      } catch (error) {
        failures.push(error);
      }
    }
  };

  const workerCount = Math.min(RSS_ARTICLE_BATCH_CONCURRENCY, items.length);
  try {
    await Promise.allSettled(
      Array.from({ length: workerCount }, () => worker()),
    );
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
  if (failures.length > 0) {
    // Preserve cleanup uncertainty. A cleanup timeout is a terminal unknown;
    // callers must not convert it into an ordinary deadline failure and then
    // finalize a run while the underlying resource may still be active.
    if (
      failures.some(
        (error) =>
          error instanceof RssError &&
          error.reasonCode === "RESOURCE_CLEANUP_TIMEOUT",
      )
    ) {
      throw new RssError("RESOURCE_CLEANUP_TIMEOUT", {
        externalCalls: options.attempts.totalExternalCalls(),
        nextAction: "next_slot",
      });
    }
    const deadline =
      controller.signal.aborted ||
      failures.some(
        (error) =>
          error instanceof RssError &&
          error.reasonCode === "BATCH_DEADLINE_EXCEEDED",
      ) ||
      Date.now() >= options.deadlineAt;
    throw new RssError(
      deadline ? "BATCH_DEADLINE_EXCEEDED" : "ARTICLE_BATCH_PARTIAL",
      {
        externalCalls: options.attempts.totalExternalCalls(),
        nextAction: "next_slot",
      },
    );
  }
  return { itemCount: feed.itemCount, items: output };
}
