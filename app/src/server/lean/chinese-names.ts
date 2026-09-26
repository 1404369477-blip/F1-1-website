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

/** Replaces known English names in Chinese copy. English source text is left untouched. */
export function applyChineseNames(text: string): string {
  let next = text;
  for (const [english, chinese] of pairs) {
    const pattern = english.length < 4
      ? new RegExp(`(?<![A-Za-z])${escapeRegExp(english)}(?![A-Za-z])`, "g")
      : new RegExp(escapeRegExp(english), "g");
    next = next.replace(pattern, chinese);
  }
  return next;
}

export function applyChineseNameList(values: readonly string[] | null): string[] | null {
  return values === null ? null : values.map((value) => applyChineseNames(value));
}
