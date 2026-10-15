import { describe, expect, it, vi } from "vitest";

import { extractArticleContent, extractArticleParagraphs, fetchArticleParagraphs, hasStrayEnglish } from "../server/lean/article.ts";
import { applyChineseNames } from "../server/lean/chinese-names.ts";
import { classifyModelError, parseRefineOutput, refineItem, refineWithFallback, type ModelEndpoint } from "../server/lean/refine.ts";
import type { StoredItem } from "../server/lean/store.ts";

const models: ModelEndpoint[] = [
  { model: "glm-5.3-flash", endpoint: "https://primary.example.test/chat", key: "fake-primary-key" },
  { model: "deepseek-chat", endpoint: "https://backup.example.test/chat", key: "fake-backup-key" }
];

const item: StoredItem = {
  publicId: `public-rss-${"0".repeat(64)}`, sourceId: "test-source", platform: "rss", displayName: "Test source",
  contentType: "race_news", requireRelevance: true, link: "https://www.formula1.com/news/test",
  title: "Russell leads practice", text: "George Russell led practice after the team changed its setup.",
  sourcePublishedAt: "2026-09-27T00:00:00.000Z", firstSeenAt: "2026-09-27T00:00:00.000Z", image: null, images: [],
  status: "pending", attempts: 0, titleZh: null, summaryZh: null, summaryEn: null, keyPointsZh: [], keyPointsEn: [],
  detailEn: null, detailZh: null, publishedAt: null
};

function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    relevant: true, titleZh: "拉塞尔领跑练习赛", summaryZh: "拉塞尔在车队调整设定后领跑练习赛。",
    summaryEn: "Russell led practice after a setup change.", keyPointsZh: [], keyPointsEn: [], detailZh: null,
    ...overrides
  };
}

function response(value: unknown): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
}

describe("bounded article extraction", () => {
  it("retains every word of a long paragraph and its short final piece", () => {
    const paragraph = `${"The team reviewed every recorded lap carefully. ".repeat(36)}Last words.`;
    const result = extractArticleContent(`<article><p>${paragraph}</p><p>We will return.</p></article>`);
    expect(result).toMatchObject({ complete: true, reason: null });
    expect(result.paragraphs.slice(0, -1).join(" ")).toBe(paragraph);
    expect(result.paragraphs.at(-1)).toBe("We will return.");
    expect(result.paragraphs.every((part) => part.length <= 800)).toBe(true);
  });

  it("preserves an unspaced long paragraph without splitting surrogate pairs", () => {
    const paragraph = `${"车队表现稳定".repeat(160)}🏎最后一圈。`;
    const result = extractArticleContent(`<article><p>${paragraph}</p></article>`);
    expect(result.complete).toBe(true);
    expect(result.paragraphs.join("")).toBe(paragraph);
    expect(result.paragraphs.every((part) => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
  });

  it("reports the article limit and never returns a known prefix as full text", async () => {
    const html = `<article>${Array.from({ length: 41 }, (_, index) => `<p>The team recorded the complete lap data for every driver, paragraph ${index}.</p>`).join("")}</article>`;
    expect(extractArticleContent(html)).toMatchObject({ complete: false, reason: "ARTICLE_PARAGRAPH_LIMIT" });
    expect(extractArticleContent(html).paragraphs).toHaveLength(40);
    expect(extractArticleParagraphs(html)).toEqual([]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(html));
    expect(await fetchArticleParagraphs(item.link, fetcher)).toBeNull();
  });

  it("keeps the fortieth and final paragraph when nothing was truncated", () => {
    const paragraphs = Array.from({ length: 40 }, (_, index) => `The team recorded the complete lap data for every driver, paragraph ${index}.`);
    expect(extractArticleParagraphs(`<article>${paragraphs.map((part) => `<p>${part}</p>`).join("")}</article>`)).toEqual(paragraphs);
  });

  it("rejects oversized HTML before a sliced page can look complete", () => {
    const result = extractArticleContent(`<article><p>${"x".repeat(1_500_001)}</p></article>`);
    expect(result).toEqual({ paragraphs: [], complete: false, reason: "ARTICLE_HTML_LIMIT" });
  });
});

describe("Chinese naming and output validation", () => {
  it("normalizes surname and case variants without replacing parts of other words", () => {
    expect(applyChineseNames("RUSSELL 与 verstappen 为 McLaren 和 FERRARI 竞争。"))
      .toBe("拉塞尔 与 维斯塔潘 为 迈凯伦 和 法拉利 竞争。");
    expect(applyChineseNames("Audience 与 Hamiltonian 及 Williamsport 保持原名。"))
      .toBe("Audience 与 Hamiltonian 及 Williamsport 保持原名。");
    expect(applyChineseNames("蒙za 的 gurney flap 和 阿尔pine"))
      .toBe("蒙扎 的 格尼襟翼 和 阿尔派");
  });

  it("detects leftover words anywhere in Chinese copy while keeping glosses and handles", () => {
    expect(hasStrayEnglish("车队表示 this was a surprisingly difficult afternoon for everyone involved。")) .toBe(true);
    expect(hasStrayEnglish("提前进站（undercut）由 FIA 监管，@team_handle #racingweekend https://example.test/page。")) .toBe(false);
    expect(hasStrayEnglish("由 Box to Box Films 制作。")) .toBe(false);
  });

  it.each([
    [[], "LENGTH"], [[""], "EMPTY"], [[null], "EMPTY"], [["The team improved its pace."], "LANGUAGE"], [["WE WILL WIN."], "LANGUAGE"]
  ])("rejects unusable detail translations %#", (detailZh, code) => {
    expect(() => parseRefineOutput(JSON.stringify(output({ detailZh })), false, 1, ["We will win."]))
      .toThrow(`MODEL_OUTPUT_INVALID_DETAIL_${code}`);
  });

  it("does not expose a malformed model response through a JSON parser error", () => {
    expect(() => parseRefineOutput("{ provider-private-response", false)).toThrow("MODEL_OUTPUT_INVALID_JSON");
    expect(() => parseRefineOutput("null", false)).toThrow("MODEL_OUTPUT_INVALID_OBJECT");
  });

  it("rejects a summary that becomes empty after removing a player notice", () => {
    expect(() => parseRefineOutput(JSON.stringify(output({ summaryZh: "请使用Chrome浏览器播放视频。" })), false))
      .toThrow("MODEL_OUTPUT_INVALID_SUMMARY");
  });

  it("keeps bilingual key points aligned when a summary repetition is dropped", () => {
    expect(parseRefineOutput(JSON.stringify(output({
      keyPointsZh: ["拉塞尔在车队调整设定后领跑练习赛。", "车队当天测试了两种前翼。"],
      keyPointsEn: ["Russell led practice after a setup change.", "The team tested two front wings."]
    })), false)).toMatchObject({ keyPointsZh: ["车队当天测试了两种前翼。"], keyPointsEn: ["The team tested two front wings."] });
  });
});

describe("model request reuse and correction", () => {
  it("translates six paragraphs as four plus two, reusing the verified opening", async () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) => `The team reviewed all the data from lap ${index + 1}.`);
    const translated = paragraphs.map((_, index) => `车队分析了第${index + 1}圈的全部数据。`);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(output({ detailZh: translated.slice(0, 4) })))
      .mockResolvedValueOnce(response({ detailZh: translated.slice(4) }));
    const result = await refineItem(item, models[0], fetcher, paragraphs);
    expect(result).toMatchObject({ kind: "ready", detailZh: translated });
    const batches = fetcher.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      return JSON.parse(body.messages[1].content).paragraphs as string[];
    });
    expect(batches).toEqual([paragraphs.slice(0, 4), paragraphs.slice(4)]);
  });

  it.each(["irrelevant", "empty", "network"])("keeps the initial usable draft when correction returns %s", async (failure) => {
    const first = output({ summaryZh: "拉塞尔认为这次调整的 focus 是轮胎温度。" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(first));
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("private transport detail"));
    else fetcher.mockResolvedValueOnce(response(failure === "irrelevant" ? { relevant: false } : output({ summaryZh: "" })));
    const result = await refineItem(item, models[0], fetcher);
    expect(result).toMatchObject({ kind: "ready", summaryZh: first.summaryZh });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("adopts a clean correction and stops after one correction when mixed copy persists", async () => {
    const mixed = output({ summaryZh: "拉塞尔认为这次调整的 focus 是轮胎温度。" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(mixed)).mockResolvedValueOnce(response(output()));
    expect(await refineItem(item, models[0], fetcher)).toMatchObject({ summaryZh: output().summaryZh });
    const repeated = vi.fn<typeof fetch>().mockImplementation(async () => response(mixed));
    expect(await refineItem(item, models[0], repeated)).toMatchObject({ summaryZh: mixed.summaryZh });
    expect(repeated).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed translation as many individual requests", async () => {
    const paragraphs = Array.from({ length: 6 }, () => "The team reviewed all the data from practice.");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(output({ detailZh: ["第一段译文。", "第二段译文。", "第三段译文。", "第四段译文。"] })))
      .mockResolvedValueOnce(new Response("private failure", { status: 503 }));
    await expect(refineItem(item, models[0], fetcher, paragraphs)).rejects.toThrow("MODEL_HTTP_503");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { titleZh: "拉塞尔 says the team will keep working on this setup" },
    { titleZh: "拉塞尔表示 He won." },
    { summaryZh: "车队表示 WE WILL WIN." },
    { summaryZh: "车队表示 WE WILL WIN。" },
    { summaryZh: "车队说 He won。" },
    { summaryZh: "车队问 He won？" },
    { summaryZh: "车队表示 WE WILL WIN" },
    { summaryZh: "拉塞尔表示 the team will keep working on this setup。" },
    { keyPointsZh: ["The team tested two different front wings."] }
  ])("does not publish an untranslated sentence after bounded correction %#", async (fields) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(output(fields)));
    await expect(refineItem(item, models[0], fetcher)).rejects.toThrow("MODEL_OUTPUT_UNTRANSLATED_COPY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("accepts standard abbreviations and proper names without correction requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(output({
      summaryZh: "FIA 确认 F1 DRS ERS MGU-K 区域调整，Box to Box Films 记录车队准备情况。"
    })));
    expect(await refineItem(item, models[0], fetcher)).toMatchObject({ kind: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps English glosses, URLs and names outside the hard sentence detector", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(output({
      summaryZh: "车队使用提前进站（WE WILL WIN）术语示例，详见 https://example.test/WE/WILL/WIN。Box to Box Films 参与记录。"
    })));
    expect(await refineItem(item, models[0], fetcher)).toMatchObject({ kind: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a sequence of motorsport acronyms for an uppercase sentence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(output({ summaryZh: "车队同时参与 WEC IMSA GT。" })));
    expect(await refineItem(item, models[0], fetcher)).toMatchObject({ kind: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains a correction timeout as a temporary failure when the original draft cannot publish", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(output({ summaryZh: "车队表示 the setup was difficult to understand。" })))
      .mockRejectedValueOnce(new Error("private timeout detail"));
    await expect(refineItem(item, models[0], fetcher)).rejects.toThrow("MODEL_NETWORK_TEMPORARY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("runtime model fallback", () => {
  it("uses the configured backup after a primary 503 with no repeated primary request", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("provider-private-response", { status: 503 }))
      .mockResolvedValueOnce(response(output()));
    expect(await refineWithFallback(item, models, fetcher)).toMatchObject({ kind: "ready" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(models.map((model) => model.endpoint));
  });

  it("tries the backup after malformed content and classifies exhausted quality failures", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "invalid private JSON" } }] }))
      .mockResolvedValueOnce(response(output({ titleZh: "" })));
    await expect(refineWithFallback(item, models, fetcher)).rejects.toThrow("MODEL_FALLBACK_QUALITY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves temporary classification if the other model fails permanently", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private primary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("private backup failure", { status: 401 }));
    await expect(refineWithFallback(item, [...models, models[0]], fetcher)).rejects.toThrow("MODEL_FALLBACK_TEMPORARY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prefers temporary when a quality miss is followed by a rate-limited backup", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "invalid private JSON" } }] }))
      .mockResolvedValueOnce(new Response("private backup failure", { status: 429 }));
    await expect(refineWithFallback(item, models, fetcher)).rejects.toThrow("MODEL_FALLBACK_TEMPORARY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds permanent and network failures and never exposes provider or transport text", async () => {
    const permanent = vi.fn<typeof fetch>().mockImplementation(async () => new Response("private failure", { status: 403 }));
    await expect(refineWithFallback(item, models, permanent)).rejects.toThrow("MODEL_FALLBACK_PERMANENT");
    expect(permanent).toHaveBeenCalledTimes(2);
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network path and key"));
    await expect(refineWithFallback(item, models, network)).rejects.toThrow("MODEL_FALLBACK_TEMPORARY");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("does not invoke a model for missing configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(refineWithFallback(item, [], fetcher)).rejects.toThrow("MODEL_KEY_MISSING");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["MODEL_HTTP_503", "temporary"], ["MODEL_HTTP_429", "temporary"], ["MODEL_HTTP_401", "permanent"],
    ["MODEL_HTTP_403", "permanent"], ["MODEL_KEY_MISSING", "permanent"], ["MODEL_OUTPUT_INVALID_DETAIL_EMPTY", "quality"],
    ["MODEL_FALLBACK_TEMPORARY", "temporary"], ["MODEL_FALLBACK_QUALITY", "quality"], ["MODEL_FALLBACK_PERMANENT", "permanent"]
  ])("classifies %s as %s", (code, kind) => {
    expect(classifyModelError(new Error(code))).toBe(kind);
  });
});
