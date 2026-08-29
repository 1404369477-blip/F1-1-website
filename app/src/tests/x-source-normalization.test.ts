import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  EXPECTED_INPUT_SHA256,
  EXPECTED_INVENTORY_SHA256,
  EXPECTED_SOURCE_COUNT,
  OUTPUT_INVENTORY_RELATIVE_PATH,
  OUTPUT_MANIFEST_RELATIVE_PATH,
  SOURCE_INPUT_RELATIVE_PATH,
  extractXSourceUrls,
  normalizeXSources
} from "../../scripts/normalize-x-sources.ts";

const appRoot = join(process.cwd());
const projectRoot = join(appRoot, "..");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("X-SOURCE-59-NORMALIZE", () => {
  test("extracts exactly 59 unique X handles without network or collection", () => {
    const inputPath = join(projectRoot, SOURCE_INPUT_RELATIVE_PATH);
    const inputBytes = readFileSync(inputPath);
    const inputSha256Before = sha256(inputBytes);
    expect(inputSha256Before).toBe(EXPECTED_INPUT_SHA256);
    const urls = extractXSourceUrls(inputBytes);
    expect(urls).toHaveLength(EXPECTED_SOURCE_COUNT);
    expect(new Set(urls.map((url) => url.toLowerCase())).size).toBe(EXPECTED_SOURCE_COUNT);
    expect(urls.every((url) => /^https:\/\/x\.com\/[A-Za-z0-9_]+\?s=20$/u.test(url))).toBe(true);
    expect(() => extractXSourceUrls(new TextEncoder().encode("https://example.com/not-x"))).toThrow(/INPUT_URL_COUNT/iu);
  });

  test("rebuilds the UTF-8 canonical inventory and binds the requested manifest fields", () => {
    const inputPath = join(projectRoot, SOURCE_INPUT_RELATIVE_PATH);
    const inputBytes = readFileSync(inputPath);
    const inputSha256Before = sha256(inputBytes);
    const result = normalizeXSources({ projectRoot });
    const outputBytes = readFileSync(result.outputPath);
    const manifestBytes = readFileSync(join(projectRoot, OUTPUT_MANIFEST_RELATIVE_PATH));
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)) as Record<string, unknown>;
    expect(result.uniqueCount).toBe(EXPECTED_SOURCE_COUNT);
    expect(result.outputSha256).toBe(EXPECTED_INVENTORY_SHA256);
    expect(result.inventorySetSha256).toBe(EXPECTED_INVENTORY_SHA256);
    expect(sha256(outputBytes)).toBe(EXPECTED_INVENTORY_SHA256);
    expect(statSync(inputPath).size).toBe(inputBytes.byteLength);
    expect(sha256(readFileSync(inputPath))).toBe(inputSha256Before);
    expect(manifest).toEqual({
      schemaVersion: "x-source-normalization-manifest-v1",
      inputPath: SOURCE_INPUT_RELATIVE_PATH,
      inputSha256: EXPECTED_INPUT_SHA256,
      outputPath: OUTPUT_INVENTORY_RELATIVE_PATH,
      outputSha256: EXPECTED_INVENTORY_SHA256,
      uniqueCount: EXPECTED_SOURCE_COUNT,
      inventorySetSha256: EXPECTED_INVENTORY_SHA256,
      automaticCollection: false,
      externalCalls: 0
    });
  });
});
