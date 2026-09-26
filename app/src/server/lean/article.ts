/** News sites whose article body may be fetched and shown as full text. */
export const ARTICLE_HOSTS = ["formula1.com", "motorsport.com", "autosport.com", "the-race.com", "skysports.com", "crash.net", "racingnews365.com", "racefans.net"] as const;

const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_HTML_CHARS = 1_500_000;
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH_CHARS = 800;

const BOILERPLATE = /subscribe|newsletter|sign up|related (?:article|stor|news)|read more|advertisement|sponsored|photo:|photo by|getty images|^advert\b|become a .{0,40}supporter|browse all \d|covering industry news|set up racefans|image:|cookie|all rights reserved|share this|follow us|leave a comment|no comments|what do you want to see|what would you like to see|let us know what you|we want your opinion|more from|recommended|you may also|take our .{0,30}survey|下载应用|订阅|相关阅读|相关新闻|相关文章|广告|图片说明|摄影：|转载请|版权所有|关注我们|你想在|目前没有评论|写一条|你可能喜欢|评论区/i;

/** Visible page chrome that starts the comments, survey, or related-story block. */
const ARTICLE_END = /there are no comments|what would you like to see|let us know what you would like|we want your opinion|class="lcp_catlist"|class="[^"]*more-from/i;

export function isBoilerplateParagraph(text: string): boolean {
  return BOILERPLATE.test(text);
}

/** A Chinese sentence that still contains a lowercase English word. Names stay capitalized and are kept. */
export function hasStrayEnglish(text: string): boolean {
  return /[\u4e00-\u9fff][^。！？\n]{0,80}\b[a-z]{3,}\b/.test(text);
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

/** Pulls article paragraphs out of a page, dropping ads, related links and captions. */
export function extractArticleParagraphs(html: string): string[] {
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
  for (const block of text.split(/\n+/)) {
    const line = block.trim();
    if (line.length < 40 || line.length > MAX_PARAGRAPH_CHARS || BOILERPLATE.test(line)) continue;
    if (paragraphs.at(-1) === line) continue;
    paragraphs.push(line);
    if (paragraphs.length >= MAX_PARAGRAPHS) break;
  }
  return paragraphs;
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
    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const paragraphs = extractArticleParagraphs(html);
    return paragraphs.length > 0 ? paragraphs : null;
  } catch {
    return null;
  }
}
