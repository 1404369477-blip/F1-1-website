import { TweetInboxError, TWEET_INBOX_MAX_DROP_BYTES, TWEET_INBOX_MAX_DROP_LINES, type NormalizedTweetUrl } from "./types.ts";
import { normalizeTweetStatusUrl } from "./url.ts";

export const TWEET_INBOX_DROP_TEMPLATE = `# F1+1 人工 X 收件箱
# 每行贴一条公开帖链接，例如：
# https://x.com/F1/status/1234567890123456789
# 当前快速上线只保存人工链接；oEmbed、cookie、账号主页扫描均已关闭。
`;

export type DropParseResult = Readonly<{
  lineCount: number;
  accepted: readonly NormalizedTweetUrl[];
  invalidCount: number;
}>;

export function parseTweetInboxDrop(raw: string): DropParseResult {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > TWEET_INBOX_MAX_DROP_BYTES) throw new TweetInboxError("DROP_TOO_LARGE");
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > TWEET_INBOX_MAX_DROP_LINES) throw new TweetInboxError("DROP_TOO_LARGE");
  const accepted: NormalizedTweetUrl[] = [];
  let invalidCount = 0;
  let lineCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    lineCount += 1;
    try {
      accepted.push(normalizeTweetStatusUrl(trimmed));
    } catch (error) {
      if (error instanceof TweetInboxError && error.reasonCode === "URL_REJECTED") {
        invalidCount += 1;
        continue;
      }
      throw error;
    }
  }
  return { lineCount, accepted, invalidCount };
}
