import { TweetInboxError } from "./types.ts";

/**
 * Compatibility surface for callers of the earlier trial inbox. Quick launch
 * keeps the X boundary manual-only, so these functions have no transport
 * implementation and never create an external attempt.
 */
export function buildOfficialOembedRequestUrl(_canonicalStatusUrl: string): URL {
  throw new TweetInboxError("CAPABILITY_DISABLED", { externalCalls: 0 });
}

export async function fetchOfficialTweetOembed(
  _options: Readonly<{
    canonicalStatusUrl: string;
    env?: NodeJS.ProcessEnv;
    onNetworkAttempt?: () => void;
  }>
): Promise<never> {
  throw new TweetInboxError("CAPABILITY_DISABLED", { externalCalls: 0 });
}
