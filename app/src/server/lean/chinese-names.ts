import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type NameMap = Record<string, string>;
type NameFile = { races?: NameMap; drivers?: NameMap; teams?: NameMap; sources?: NameMap };

const namesPath = join(dirname(fileURLToPath(import.meta.url)), "../../../data/f1-names-zh.json");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pairsFrom(file: NameFile): [string, string][] {
  const pairs = [
    ...Object.entries(file.drivers ?? {}),
    ...Object.entries(file.teams ?? {}),
    ...Object.entries(file.races ?? {}),
    ...Object.entries(file.sources ?? {})
  ].filter((entry): entry is [string, string] => entry[0].trim().length > 0 && entry[1].trim().length > 0 && entry[0] !== entry[1]);
  pairs.sort((left, right) => right[0].length - left[0].length || left[0].localeCompare(right[0]));
  return pairs;
}

const pairs = pairsFrom(JSON.parse(readFileSync(namesPath, "utf8")) as NameFile);

const BOX_TO_BOX = "\u0000BOXTOBOX\u0000";

const TERM_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/马德里林（马德里赛道）赛道/g, "马德里赛道"],
  [/马德里林赛道/g, "马德里赛道"],
  [/马德里林/g, "马德里赛道"],
  [/马德里\s*ring\s*赛道/gi, "马德里赛道"],
  [/马德里\s*ring/gi, "马德里赛道"],
  [/\bMadring\b/g, "马德里赛道"],
  [/蒙za/g, "蒙扎"],
  [/代rap小红牛/g, "代表小红牛"],
  [/角田裕pie/g, "角田裕毅"],
  [/红\s*bull\b/gi, "红牛"],
  [/\bunder-?cuts?\b/gi, "提前进站"],
  [/\bpits\b/gi, "维修区"],
  [/\bsessions\b/gi, "各节练习与排位"],
  [/\bbargeboards?\b/gi, "导流板"],
  [/junior\s*车队/gi, "青训车队"],
  [/\bjunior\b/gi, "青训"],
  [/阿尔pine/g, "阿尔派"],
  [/Bott-ass/gi, "博塔斯"]
];

function preferChineseGloss(text: string): string {
  return text.replace(/[A-Za-z][A-Za-z' -]{1,40}（([^）]{1,80})）/g, (full, inner: string) => {
    const chinese = inner.match(/[\u4e00-\u9fff][\u4e00-\u9fff0-9，、。／/]*/);
    return chinese?.[0] ?? full;
  });
}

/** Replaces known English names in Chinese copy. English source text is left untouched. */
export function applyChineseNames(text: string): string {
  let next = text.replace(/进站\s*to\s*进站(?:\s*Films)?/gi, BOX_TO_BOX).replace(/Box\s+to\s+Box(?:\s+Films)?/gi, BOX_TO_BOX);
  // "box" is a pit-stop word only as a whole word. The production company is restored below.
  next = next.replace(/(?<![A-Za-z])box(?![A-Za-z])/gi, "进站");
  next = next.replaceAll(BOX_TO_BOX, "Box to Box Films");
  for (const [english, chinese] of pairs) {
    const pattern = english.length < 4
      ? new RegExp(`(?<![A-Za-z])${escapeRegExp(english)}(?![A-Za-z])`, "g")
      : new RegExp(escapeRegExp(english), "g");
    next = next.replace(pattern, chinese);
  }
  for (const [pattern, chinese] of TERM_REPLACEMENTS) next = next.replace(pattern, chinese);
  return preferChineseGloss(next);
}

export function applyChineseNameList(values: readonly string[] | null): string[] | null {
  return values === null ? null : values.map((value) => applyChineseNames(value));
}
