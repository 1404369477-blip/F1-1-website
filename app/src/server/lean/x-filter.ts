export type TweetSkipReason = "retweet" | "promotion" | "too_short";

/**
 * Giveaways, ticket and merchandise sales, sponsor ads. A bare "win" is race news ("Can Leclerc win?"),
 * so only prize phrasings count.
 */
const PROMOTION = new RegExp([
  String.raw`\b(giveaways?|competitions?|sweepstakes?|raffles?|merch|merchandise|tickets?|prizes?)\b`,
  String.raw`\bwin (a|an|one|two|the chance|tickets?|signed|your|this|our)\b`, String.raw`\bchance to win\b`, String.raw`#win\b`,
  String.raw`\b(enter (now|here|via|today)|to enter|how to enter)\b`,
  String.raw`\b(your chance to|for (a|your) chance|don't miss out)\b`,
  String.raw`\b(shop now|shop the|pre-?order|use code|promo code|discount|limited edition|link in bio)\b`,
  String.raw`#(ad|sponsored|partner)\b`, String.raw`\b(sponsored|brought to you by|in partnership with|presented by)\b`,
  "抽奖", "门票", "购票", "周边", "赠送", "优惠码"
].join("|"), "iu");

const MIN_WORDS = 4;
const MIN_LETTERS = 20;

/** The words a reader actually gets: links, @mentions, #hashtags and emoji removed. */
function substance(text: string): { words: number; letters: number } {
  const plain = text.replace(/https?:\/\/\S+/g, " ").replace(/[@#][\p{L}\p{N}_]+/gu, " ");
  const words = plain.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const han = (plain.match(/\p{Script=Han}/gu) ?? []).length;
  return { words: words.length + han, letters: (plain.match(/[\p{L}\p{N}]/gu) ?? []).length };
}

/** Why an X post should not be published, or null when it should be. */
export function tweetSkipReason(post: { title: string; text: string }): TweetSkipReason | null {
  const text = post.text.trim() || post.title.trim();
  if (/^RT @/i.test(text) || /^RT @/i.test(post.title.trim())) return "retweet";
  if (PROMOTION.test(`${post.title}\n${text}`)) return "promotion";
  const { words, letters } = substance(text);
  if (words < MIN_WORDS || letters < MIN_LETTERS) return "too_short";
  return null;
}
