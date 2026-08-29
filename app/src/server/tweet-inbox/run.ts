import { parseTweetInboxDrop } from "./drop.ts";
import { TweetInboxRepository, XManualInboxRepository } from "./repository.ts";
import { normalizeManualStatusUrl } from "./url.ts";
import {
  TWEET_INBOX_MAX_DROP_BYTES,
  TWEET_INBOX_MAX_DROP_LINES,
  TWEET_INBOX_PROFILE_ID,
  tweetInboxFailure,
  type TweetInboxReceipt,
  type TweetInboxReasonCode,
  type XManualInboxReceipt
} from "./types.ts";

export type TweetOembedFetcher = (canonicalStatusUrl: string) => Promise<string>;

function receipt(input: Omit<TweetInboxReceipt, "schemaVersion" | "profile" | "media">): TweetInboxReceipt {
  return {
    schemaVersion: "tweet-inbox-receipt-v1",
    profile: TWEET_INBOX_PROFILE_ID,
    media: "none",
    ...input
  };
}

export async function runTweetInboxCycle(options: Readonly<{
  repository: TweetInboxRepository;
  dropText: string;
  scheduledAt: string;
  fetchOembed: TweetOembedFetcher;
  ioEnabled: boolean;
}>): Promise<TweetInboxReceipt> {
  const startedAt = new Date().toISOString();
  const started = options.repository.startRun(options.scheduledAt, startedAt);
  const emptyCounts = {
    dropLineCount: 0,
    queuedCount: 0,
    fetchedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    invalidCount: 0,
    externalCalls: 0
  };

  const finish = (
    status: TweetInboxReceipt["status"],
    reasonCode: TweetInboxReasonCode,
    nextAction: TweetInboxReceipt["nextAction"],
    counts: typeof emptyCounts
  ): TweetInboxReceipt => {
    options.repository.finishRun(started.runId, {
      finishedAt: new Date().toISOString(),
      ...counts,
      status,
      reasonCode,
      nextAction
    });
    return receipt({
      runId: started.runId,
      slotKey: started.slotKey,
      status,
      reasonCode,
      nextAction,
      ...counts
    });
  };

  let parsed;
  try {
    parsed = parseTweetInboxDrop(options.dropText);
  } catch (error) {
    const failure = tweetInboxFailure(error, false);
    return finish("failed", failure.reasonCode, failure.nextAction, emptyCounts);
  }

  const queuedNow = options.repository.enqueue(parsed.accepted, startedAt);
  const counts = {
    dropLineCount: parsed.lineCount,
    queuedCount: queuedNow.queued,
    fetchedCount: 0,
    duplicateCount: queuedNow.duplicate,
    rejectedCount: 0,
    failedCount: 0,
    invalidCount: parsed.invalidCount,
    externalCalls: 0
  };

  const pending = options.repository.takeQueued();
  if (pending.length === 0) {
    const idle = parsed.lineCount === 0 && parsed.invalidCount === 0;
    return finish(idle ? "idle" : "succeeded", idle ? "IDLE" : "OK", "none", counts);
  }

  if (!options.ioEnabled) {
    return finish("failed", "TWEET_INBOX_IO_DISABLED", "next_slot", counts);
  }

  // The legacy schema-1 cycle is retained for replay compatibility, but the
  // quick-launch boundary never permits an oEmbed attempt. Callers must use
  // the manual schema-8 cycle above; an injected fetcher is intentionally not
  // invoked.
  return finish("failed", "CAPABILITY_DISABLED", "manual_review", counts);

}

/**
 * Process the quick-launch manual URL drop without any network-capable
 * dependency. Each accepted line is stored as submitted; review, publication,
 * collectors, and oEmbed remain outside this cycle by contract.
 */
export function runManualXInboxCycle(options: Readonly<{
  repository: XManualInboxRepository;
  dropText: string;
  nowIso: string;
}>): XManualInboxReceipt {
  if (Buffer.byteLength(options.dropText, "utf8") > TWEET_INBOX_MAX_DROP_BYTES) {
    return {
      schemaVersion: "x-manual-inbox-receipt-v1",
      profile: "x-manual-inbox-private",
      status: "failed",
      reasonCode: "X_MANUAL_URL_REJECTED",
      dropLineCount: 0,
      submittedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      externalCalls: 0,
      automaticReview: false,
      automaticPublish: false,
      media: "none"
    };
  }
  const lines = options.dropText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (lines.length > TWEET_INBOX_MAX_DROP_LINES) {
    return {
      schemaVersion: "x-manual-inbox-receipt-v1",
      profile: "x-manual-inbox-private",
      status: "failed",
      reasonCode: "X_MANUAL_URL_REJECTED",
      dropLineCount: lines.length,
      submittedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      externalCalls: 0,
      automaticReview: false,
      automaticPublish: false,
      media: "none"
    };
  }
  if (lines.length === 0) {
    return {
      schemaVersion: "x-manual-inbox-receipt-v1",
      profile: "x-manual-inbox-private",
      status: "idle",
      reasonCode: "IDLE",
      dropLineCount: 0,
      submittedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      externalCalls: 0,
      automaticReview: false,
      automaticPublish: false,
      media: "none"
    };
  }

  let submittedCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  for (const line of lines) {
    try {
      const parsed = normalizeManualStatusUrl(line);
      const result = options.repository.submitManualStatusUrl({ submittedUrl: parsed.submittedUrl, nowIso: options.nowIso });
      if (result.duplicate) duplicateCount += 1;
      else submittedCount += 1;
    } catch (error) {
      if (error instanceof Error && error.message === "X_MANUAL_URL_REJECTED") invalidCount += 1;
      else throw error;
    }
  }
  return {
    schemaVersion: "x-manual-inbox-receipt-v1",
    profile: "x-manual-inbox-private",
    status: submittedCount + duplicateCount > 0 ? "succeeded" : "failed",
    reasonCode: submittedCount + duplicateCount > 0 ? "OK" : "X_MANUAL_URL_REJECTED",
    dropLineCount: lines.length,
    submittedCount,
    duplicateCount,
    invalidCount,
    externalCalls: 0,
    automaticReview: false,
    automaticPublish: false,
    media: "none"
  };
}
