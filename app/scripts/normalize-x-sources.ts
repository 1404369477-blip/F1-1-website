import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const EXPECTED_INPUT_SHA256 = "135e9bcae84124a57d1599a9a1cb85ca0a08be1cccda3e54a3d118391a2b074d";
export const EXPECTED_INVENTORY_SHA256 = "bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b";
export const EXPECTED_SOURCE_COUNT = 59;
export const SOURCE_INPUT_RELATIVE_PATH = "F1+1信源.md";
export const SEED_INVENTORY_RELATIVE_PATH = "data/x-source-inventory-v0.csv";
export const OUTPUT_INVENTORY_RELATIVE_PATH = "data/x-source-inventory-v1.csv";
export const OUTPUT_MANIFEST_RELATIVE_PATH = "data/x-source-inventory-v1.manifest.json";

const INVENTORY_HEADER = [
  "source_id",
  "platform",
  "handle",
  "canonical_url",
  "entity_type",
  "content_focus",
  "identity_status",
  "monitorability",
  "priority",
  "lifecycle_status",
  "added_at",
  "evidence_url",
  "notes"
] as const;

export type XSourceRecord = Readonly<Record<(typeof INVENTORY_HEADER)[number], string>>;

export type NormalizationResult = Readonly<{
  inputPath: string;
  inputSha256: string;
  outputPath: string;
  outputSha256: string;
  inventorySetSha256: string;
  uniqueCount: number;
  records: readonly XSourceRecord[];
  outputBytes: Uint8Array;
}>;

export type NormalizationManifest = Readonly<{
  schemaVersion: "x-source-normalization-manifest-v1";
  inputPath: string;
  inputSha256: string;
  outputPath: string;
  outputSha256: string;
  uniqueCount: 59;
  inventorySetSha256: string;
  automaticCollection: false;
  externalCalls: 0;
}>;

export type NormalizationPaths = Readonly<{
  projectRoot: string;
  inputPath?: string;
  seedInventoryPath?: string;
  outputInventoryPath?: string;
  outputManifestPath?: string;
}>;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string): never {
  throw new Error(`X_SOURCE_NORMALIZATION:${message}`);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label}_NOT_UTF8`);
  }
}

function assertExact<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) fail(message);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") pushRow();
    } else if (character === '"') {
      fail("CSV_UNEXPECTED_QUOTE");
    } else {
      field += character;
    }
  }

  if (quoted) fail("CSV_UNCLOSED_QUOTE");
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseInventory(bytes: Uint8Array): XSourceRecord[] {
  const text = decodeUtf8(bytes, "SEED_INVENTORY");
  const rows = parseCsv(text);
  if (rows.length !== EXPECTED_SOURCE_COUNT + 1) fail("SEED_ROW_COUNT");
  if (rows[0].length !== INVENTORY_HEADER.length || rows[0].some((value, index) => value !== INVENTORY_HEADER[index])) {
    fail("SEED_HEADER");
  }

  const records = rows.slice(1).map((values, rowIndex) => {
    if (values.length !== INVENTORY_HEADER.length) fail(`SEED_FIELD_COUNT:${rowIndex}`);
    const record = Object.fromEntries(INVENTORY_HEADER.map((field, index) => [field, values[index]])) as XSourceRecord;
    if (!/^x_[a-z0-9_]+$/u.test(record.source_id)) fail(`SOURCE_ID:${rowIndex}`);
    if (record.platform !== "x") fail(`PLATFORM:${rowIndex}`);
    if (!/^[A-Za-z0-9_]+$/u.test(record.handle)) fail(`HANDLE:${rowIndex}`);
    if (record.canonical_url !== `https://x.com/${record.handle.toLowerCase()}`) fail(`CANONICAL_URL:${rowIndex}`);
    if (record.evidence_url !== `https://x.com/${record.handle}?s=20`) fail(`EVIDENCE_URL:${rowIndex}`);
    if (record.lifecycle_status !== "proposed") fail(`LIFECYCLE_STATUS:${rowIndex}`);
    if (record.identity_status !== "unknown" || record.monitorability !== "unknown") fail(`UNKNOWN_DEFAULTS:${rowIndex}`);
    return record;
  });

  const sourceIds = new Set(records.map((record) => record.source_id));
  const canonicalUrls = new Set(records.map((record) => record.canonical_url));
  if (sourceIds.size !== EXPECTED_SOURCE_COUNT || canonicalUrls.size !== EXPECTED_SOURCE_COUNT) fail("SEED_DUPLICATE");
  return records;
}

export function extractXSourceUrls(inputBytes: Uint8Array): readonly string[] {
  const sourceText = Buffer.from(inputBytes).toString("latin1");
  const tokens = [...sourceText.matchAll(/https:\/\/x\.com\/[^\s\\]+/gu)].map((match) => match[0]);
  if (tokens.length !== EXPECTED_SOURCE_COUNT) fail(`INPUT_URL_COUNT:${tokens.length}`);
  for (const token of tokens) {
    if (!/^https:\/\/x\.com\/[A-Za-z0-9_]+\?s=20$/u.test(token)) fail(`INPUT_URL_INVALID:${token}`);
  }
  return Object.freeze(tokens);
}

function canonicalHandleSet(urls: readonly string[]): ReadonlySet<string> {
  const handles = urls.map((url) => url.slice("https://x.com/".length, -"?s=20".length).toLowerCase());
  const unique = new Set(handles);
  if (unique.size !== EXPECTED_SOURCE_COUNT) fail("INPUT_DUPLICATE_HANDLE");
  return unique;
}

function assertInputMatchesInventory(urls: readonly string[], records: readonly XSourceRecord[]): void {
  const inputHandles = canonicalHandleSet(urls);
  const inventoryHandles = new Set(records.map((record) => record.handle.toLowerCase()));
  if (inputHandles.size !== inventoryHandles.size || [...inputHandles].some((handle) => !inventoryHandles.has(handle))) {
    fail("INPUT_INVENTORY_SET_MISMATCH");
  }
}

function buildCanonicalCsv(records: readonly XSourceRecord[]): Uint8Array {
  const lines = [
    INVENTORY_HEADER.map(csvEscape).join(","),
    ...records.map((record) => INVENTORY_HEADER.map((field) => csvEscape(record[field])).join(","))
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

export function normalizeXSources(paths: NormalizationPaths): NormalizationResult {
  const projectRoot = resolve(paths.projectRoot);
  const inputPath = resolve(paths.inputPath ?? join(projectRoot, SOURCE_INPUT_RELATIVE_PATH));
  const seedInventoryPath = resolve(paths.seedInventoryPath ?? join(projectRoot, SEED_INVENTORY_RELATIVE_PATH));
  const outputInventoryPath = resolve(paths.outputInventoryPath ?? join(projectRoot, OUTPUT_INVENTORY_RELATIVE_PATH));
  const outputManifestPath = resolve(paths.outputManifestPath ?? join(projectRoot, OUTPUT_MANIFEST_RELATIVE_PATH));
  if (!existsSync(inputPath) || !existsSync(seedInventoryPath)) fail("INPUT_MISSING");

  const inputBytes = readFileSync(inputPath);
  const inputSha256 = sha256(inputBytes);
  assertExact(inputSha256, EXPECTED_INPUT_SHA256, "INPUT_SHA256");
  const urls = extractXSourceUrls(inputBytes);
  const seedBytes = readFileSync(seedInventoryPath);
  const seedSha256 = sha256(seedBytes);
  assertExact(seedSha256, EXPECTED_INVENTORY_SHA256, "SEED_SHA256");
  const records = parseInventory(seedBytes);
  assertInputMatchesInventory(urls, records);
  const outputBytes = buildCanonicalCsv(records);
  const outputSha256 = sha256(outputBytes);
  assertExact(outputSha256, EXPECTED_INVENTORY_SHA256, "OUTPUT_SHA256");

  writeFileSync(outputInventoryPath, outputBytes, { mode: 0o644 });
  const result: NormalizationResult = Object.freeze({
    inputPath,
    inputSha256,
    outputPath: outputInventoryPath,
    outputSha256,
    inventorySetSha256: outputSha256,
    uniqueCount: records.length,
    records: Object.freeze(records),
    outputBytes
  });

  const manifest: NormalizationManifest = Object.freeze({
    schemaVersion: "x-source-normalization-manifest-v1",
    inputPath: relative(projectRoot, inputPath).split("\\").join("/"),
    inputSha256,
    outputPath: relative(projectRoot, outputInventoryPath).split("\\").join("/"),
    outputSha256,
    uniqueCount: EXPECTED_SOURCE_COUNT,
    inventorySetSha256: outputSha256,
    automaticCollection: false,
    externalCalls: 0
  });
  writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return result;
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`ARG_MISSING:${name}`);
  return value;
}

function writeEvidence(result: NormalizationResult, projectRoot: string, runId: string): Readonly<{ runRoot: string; manifestSha256: string }> {
  const evidenceRoot = join(projectRoot, "scratch", "2026-08-27-x59-normalize", runId);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const manifestPath = join(projectRoot, OUTPUT_MANIFEST_RELATIVE_PATH);
  const manifestBytes = readFileSync(manifestPath);
  const receipt = {
    schemaVersion: "x-source-normalization-receipt-v1",
    status: "PASS",
    inputPath: relative(projectRoot, result.inputPath).split("\\").join("/"),
    inputSha256: result.inputSha256,
    outputPath: relative(projectRoot, result.outputPath).split("\\").join("/"),
    outputSha256: result.outputSha256,
    manifestPath: OUTPUT_MANIFEST_RELATIVE_PATH,
    manifestSha256: sha256(manifestBytes),
    uniqueCount: result.uniqueCount,
    inventorySetSha256: result.inventorySetSha256,
    automaticCollection: false,
    externalCalls: 0
  } as const;
  const receiptBytes = new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`);
  const report = [
    "# X-SOURCE-59-NORMALIZE evidence",
    "",
    "- status: PASS",
    `- input: ${receipt.inputPath}`,
    `- inputSha256: ${receipt.inputSha256}`,
    `- output: ${receipt.outputPath}`,
    `- outputSha256: ${receipt.outputSha256}`,
    `- uniqueCount: ${receipt.uniqueCount}`,
    `- inventorySetSha256: ${receipt.inventorySetSha256}`,
    "- automaticCollection: false",
    "- externalCalls: 0",
    "- original input was read byte-for-byte and was not modified.",
    "- no network, database, service, migration, runtime, or deployment action was performed.",
    ""
  ].join("\n");
  const reportBytes = new TextEncoder().encode(report);
  writeFileSync(join(evidenceRoot, "receipt.json"), receiptBytes, { mode: 0o600 });
  writeFileSync(join(evidenceRoot, "report.md"), reportBytes, { mode: 0o600 });
  const evidenceManifest = [
    `${sha256(receiptBytes)}  receipt.json`,
    `${sha256(reportBytes)}  report.md`,
    `${sha256(manifestBytes)}  ../../../${OUTPUT_MANIFEST_RELATIVE_PATH}`,
    `${result.outputSha256}  ../../../${OUTPUT_INVENTORY_RELATIVE_PATH}`
  ].join("\n") + "\n";
  writeFileSync(join(evidenceRoot, "MANIFEST.sha256"), evidenceManifest, { mode: 0o600 });
  return Object.freeze({ runRoot: evidenceRoot, manifestSha256: sha256(manifestBytes) });
}

export function runNormalizationCli(args: readonly string[], projectRoot: string): Readonly<{ result: NormalizationResult; runRoot: string; manifestSha256: string }> {
  const runId = argValue(args, "--run-id") ?? `run-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`;
  if (!/^[-A-Za-z0-9_]+$/u.test(runId)) fail("RUN_ID");
  const result = normalizeXSources({ projectRoot });
  const evidence = writeEvidence(result, projectRoot, runId);
  return Object.freeze({ result, runRoot: evidence.runRoot, manifestSha256: evidence.manifestSha256 });
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  try {
    const projectRoot = resolve(dirname(modulePath), "../..");
    const output = runNormalizationCli(process.argv.slice(2), projectRoot);
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      inputSha256: output.result.inputSha256,
      outputSha256: output.result.outputSha256,
      uniqueCount: output.result.uniqueCount,
      inventorySetSha256: output.result.inventorySetSha256,
      automaticCollection: false,
      externalCalls: 0,
      runRoot: relative(projectRoot, output.runRoot).split("\\").join("/"),
      manifestSha256: output.manifestSha256
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "X_SOURCE_NORMALIZATION:FAILED"}\n`);
    process.exitCode = 1;
  }
}
