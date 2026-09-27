/** News sites whose article body may be fetched and shown as full text. */
export const ARTICLE_HOSTS = ["formula1.com", "motorsport.com", "autosport.com", "the-race.com", "skysports.com", "crash.net", "racingnews365.com", "racefans.net"] as const;

const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_HTML_CHARS = 1_500_000;
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH_CHARS = 800;

export type ArticleContent = Readonly<{
  paragraphs: string[];
  complete: boolean;
  reason: "ARTICLE_HTML_LIMIT" | "ARTICLE_PARAGRAPH_LIMIT" | null;
}>;

const BOILERPLATE = /subscribe|newsletter|sign up|related (?:article|stor|news)|read more|advertisement|sponsored|photo:|photo by|getty images|^advert\b|become a .{0,40}supporter|browse all \d|covering industry news|set up racefans|image:|cookie|all rights reserved|share this|follow us|leave a comment|no comments|what do you want to see|what would you like to see|let us know what you|we want your opinion|more from|recommended|you may also|take our .{0,30}survey|please use chrome|accessible video player|请使用\s*chrome|更便捷的视频播放|下载应用|订阅|相关阅读|相关新闻|相关文章|广告|图片说明|摄影：|转载请|版权所有|关注我们|你想在|目前没有评论|写一条|你可能喜欢|评论区/i;

const STRAY_ALLOW = new Set(["f1", "f2", "f3", "fia", "drs", "ers", "kers", "gp", "fp1", "fp2", "fp3", "q1", "q2", "q3", "dnf", "dns", "dsq", "vsc", "sc", "mgu-k", "mgu-h"]);

/** Visible page chrome that starts the comments, survey, or related-story block. */
const ARTICLE_END = /there are no comments|what would you like to see|let us know what you would like|we want your opinion|class="lcp_catlist"|class="[^"]*more-from/i;

/**
 * Sky's video-player notice. Requires the word Chrome plus a browser word and a video word,
 * so a sponsor tag such as @GoogleChrome is left alone.
 */
export function isChromeVideoPlayerLine(text: string): boolean {
  return /(?<![A-Za-z])chrome(?![A-Za-z])/i.test(text)
    && /浏览器|browser/i.test(text)
    && /视频|video/i.test(text);
}

export function isBoilerplateParagraph(text: string): boolean {
  return BOILERPLATE.test(text) || isChromeVideoPlayerLine(text);
}

/** Drops video-player sentences from a summary. Other sentences stay. */
export function stripChromeVideoPlayerSentences(text: string): string {
  const parts = text.split(/(?<=[。！？.!?])/);
  return parts.filter((part) => !isChromeVideoPlayerLine(part)).join("").replace(/\s{2,}/g, " ").trim();
}

/** A stored English title. Machine-translated Chinese in that column is not shown as the original. */
export function englishOriginalTitle(title: string | null): string | null {
  if (!title || !title.trim()) return null;
  if (/[\u4e00-\u9fff]{2,}/.test(title)) return null;
  return title.trim();
}

/** A Chinese sentence that still contains a lowercase English word. Names stay capitalized. English inside a gloss in parentheses is allowed. URLs and @handles are ignored. DRS, FIA, F1 and GP are allowed. */
export function hasStrayEnglish(text: string): boolean {
  if (!text) return false;
  return strayEnglishWords(text).length > 0;
}

function withoutEnglishReferences(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/pic\.twitter\.com\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(/#[A-Za-z][\w]*/g, " ")
    .replace(/[（(][^）)]{0,80}[）)]/g, " ");
}

/** Detect sentence-shaped leftovers regardless of case or the translator's punctuation choice. */
export function hasUntranslatedEnglishSentence(text: string): boolean {
  const without = withoutEnglishReferences(text)
    .replace(/\bBox\s+to\s+Box(?:\s+Films)?\b/gi, " ")
    .replace(/(?<![A-Za-z0-9-])[A-Za-z][A-Za-z0-9-]*(?![A-Za-z0-9-])/g,
      (word) => STRAY_ALLOW.has(word.toLowerCase()) ? " " : word);
  if (/\b[A-Za-z]+(?:\s+[a-z]+)+\s*[.!?。！？]/.test(without)) return true;
  // Uppercase alone can be a series of acronyms; require an ordinary clause word as well.
  return [...without.matchAll(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\s*(?:[.!?。！？]|$)/g)].some(([sentence]) =>
    /\b(?:WE|YOU|HE|SHE|THEY|IT|WILL|WOULD|CAN|COULD|IS|ARE|WAS|WERE|HAS|HAVE|HAD|MUST|SHOULD)\b/.test(sentence)
  );
}

export function strayEnglishWords(text: string): string[] {
  const without = withoutEnglishReferences(text);
  if (!/\p{Script=Han}/u.test(without)) return [];
  const words: string[] = [];
  for (const match of without.matchAll(/(?<![A-Za-z.])([a-z]{3,})(?![A-Za-z])/g)) {
    const word = match[1] ?? "";
    if (STRAY_ALLOW.has(word)) continue;
    words.push(word);
  }
  return words;
}

export function articleHostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return ARTICLE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function decode(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Split on a word boundary where possible; keep the last piece even when it is short. */
function paragraphChunks(paragraph: string): string[] {
  const chunks: string[] = [];
  let remaining = paragraph;
  while (remaining.length > MAX_PARAGRAPH_CHARS) {
    const boundary = remaining.lastIndexOf(" ", MAX_PARAGRAPH_CHARS);
    let end = boundary >= MAX_PARAGRAPH_CHARS / 2 ? boundary : MAX_PARAGRAPH_CHARS;
    // Do not split a UTF-16 surrogate pair when a paragraph has no word boundaries.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1] ?? "")) end -= 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Completeness describes extraction limits, not a guarantee about a publisher's page markup. */
export function extractArticleContent(html: string): ArticleContent {
  if (html.length > MAX_HTML_CHARS) return { paragraphs: [], complete: false, reason: "ARTICLE_HTML_LIMIT" };
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|aside|header|form|figure|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+\b(?:id|class)="[^"]*(?:comment|related|newsletter|survey|recommend|promo|social|share|breadcrumb)[^"]*"[^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, " ");
  const rawRegion = /<article\b[\s\S]*?<\/article>/i.exec(withoutNoise)?.[0]
    ?? /<main\b[\s\S]*?<\/main>/i.exec(withoutNoise)?.[0]
    ?? withoutNoise;
  const end = ARTICLE_END.exec(rawRegion);
  const region = end ? rawRegion.slice(0, end.index) : rawRegion;
  const text = decode(region);
  const paragraphs: string[] = [];
  let previous = "";
  for (const block of text.split(/\n+/)) {
    const line = block.trim();
    const shortSentence = line.length >= 10 && /[.!?。！？][”"']?$/.test(line);
    if ((!shortSentence && line.length < 40) || BOILERPLATE.test(line)) continue;
    if (previous === line) continue;
    previous = line;
    for (const chunk of paragraphChunks(line)) {
      if (paragraphs.length >= MAX_PARAGRAPHS) return { paragraphs, complete: false, reason: "ARTICLE_PARAGRAPH_LIMIT" };
      paragraphs.push(chunk);
    }
  }
  return { paragraphs, complete: true, reason: null };
}

/** Never expose a known truncated extraction through the legacy full-text interface. */
export function extractArticleParagraphs(html: string): string[] {
  const content = extractArticleContent(html);
  return content.complete ? content.paragraphs : [];
}

export async function fetchArticleParagraphs(url: string, fetcher: typeof fetch = fetch): Promise<string[] | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!articleHostAllowed(hostname)) return null;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9"
      },
      redirect: "follow"
    });
    if (!response.ok) return null;
    const html = await response.text();
    const paragraphs = extractArticleParagraphs(html);
    return paragraphs.length > 0 ? paragraphs : null;
  } catch {
    return null;
  }
}
