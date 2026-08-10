import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

export const VS1_FIXTURE_VERSION = "vs1-local-pipeline-v1" as const;
export const VS1_SUMMARY_MISSING_CASE_ID = "VS1-SUMMARY-MISSING-012" as const;

const OUTCOMES = [
  "candidate",
  "HTTP_429",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
  "COLLECTION_TIMEOUT",
  "DB_LOCK_CONTENTION",
  "INVALID_FIXTURE"
] as const;

const FAULTS = [
  "none",
  "after_capture",
  "after_content",
  "after_event",
  "after_summary",
  "after_bundle",
  "before_ack_cas",
  "before_audit"
] as const;

const PRECONDITIONS = [
  "empty",
  "same_content",
  "same_event",
  "different_day",
  "fingerprint_collision",
  "approved_chain",
  "stale_fence",
  "no_work"
] as const;

export const candidateSchema = z.object({
  external_id: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 255),
  external_url: z.string().url().refine((value) => new URL(value).host === "synthetic.invalid"),
  content_kind: z.enum(["post", "article", "video", "image", "thread"]),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  title: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= 4096),
  body: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= 65536),
  published_at: z.iso.datetime({ offset: true })
}).strict();

export const mockSummarySchema = z.object({
  title_zh: z.string().min(1).max(512),
  summary_zh: z.string().min(1).max(10000)
}).strict();

export const attemptSchema = z.object({
  attempt: z.number().int().min(1).max(3),
  adapter_outcome: z.enum(OUTCOMES),
  fault_injection: z.enum(FAULTS),
  candidate: candidateSchema.optional(),
  mock_summary: mockSummarySchema.optional()
}).strict();

export const fixtureCaseSchema = z.object({
  fixture_version: z.literal(VS1_FIXTURE_VERSION),
  case_id: z.string().regex(/^VS1-[A-Z0-9-]+$/),
  precondition: z.enum(PRECONDITIONS),
  attempts: z.array(attemptSchema).min(1).max(3)
}).strict().superRefine((fixtureCase, context) => {
  fixtureCase.attempts.forEach((attempt, index) => {
    if (attempt.attempt !== index + 1) {
      context.addIssue({ code: "custom", path: ["attempts", index, "attempt"], message: "attempts must be contiguous from one" });
    }
    const candidateOutcome = attempt.adapter_outcome === "candidate";
    if (!candidateOutcome && (attempt.candidate !== undefined || attempt.mock_summary !== undefined)) {
      context.addIssue({ code: "custom", path: ["attempts", index], message: "non-candidate attempts cannot contain candidate or mock_summary" });
    }
    if (candidateOutcome && attempt.candidate === undefined) {
      context.addIssue({ code: "custom", path: ["attempts", index, "candidate"], message: "candidate outcome requires candidate" });
    }
    if (candidateOutcome && fixtureCase.case_id === VS1_SUMMARY_MISSING_CASE_ID && attempt.mock_summary !== undefined) {
      context.addIssue({ code: "custom", path: ["attempts", index, "mock_summary"], message: "012 must omit mock_summary" });
    }
    if (candidateOutcome && fixtureCase.case_id !== VS1_SUMMARY_MISSING_CASE_ID && attempt.mock_summary === undefined) {
      context.addIssue({ code: "custom", path: ["attempts", index, "mock_summary"], message: "candidate outcome requires mock_summary" });
    }
    if (candidateOutcome && index !== fixtureCase.attempts.length - 1) {
      context.addIssue({ code: "custom", path: ["attempts", index], message: "candidate must be the final attempt" });
    }
    if (attempt.fault_injection !== "none" && !/^VS1-PARTIAL-016[A-G]$/.test(fixtureCase.case_id)) {
      context.addIssue({ code: "custom", path: ["attempts", index, "fault_injection"], message: "fault injection is limited to 016A-G" });
    }
  });
});

const registrySchema = z.object({
  fixture_version: z.literal(VS1_FIXTURE_VERSION),
  cases: z.array(fixtureCaseSchema).min(1)
}).strict();

const sourceSchema = z.object({
  source_id: z.literal("src-queued"),
  platform: z.literal("x"),
  platform_account_id: z.string().nullable(),
  handle: z.string(), raw_url: z.string(), canonical_url: z.string(), canonical_url_valid: z.literal(true),
  normalizer_version: z.string(), normalization_status: z.literal("valid"), dedup_status: z.literal("unique"),
  entity_type: z.string(), content_focus: z.string(), priority: z.string(), verification_status: z.string(),
  identity_status: z.string(), relevance_status: z.string(), monitorability: z.string(), adapter_status: z.literal("ready"),
  adapter_authorization_status: z.literal("valid"), platform_allowed: z.literal("allowed"),
  authorization_checked_at: z.string().nullable(), authorization_expires_at: z.string().nullable(),
  collection_onboarding_status: z.literal("queued"), onboarding_operation_id: z.string().nullable(),
  lifecycle_status: z.literal("proposed"), enabled: z.literal(true), manual_disable_at: z.string().nullable(),
  source_stop_status: z.literal("clear"), source_safety_epoch: z.literal(1), source_config_epoch: z.literal(1),
  added_at: z.string(), evidence_url: z.string(), notes: z.string(), migration_batch_id: z.string(), change_reason: z.string(),
  created_at: z.string(), updated_at: z.string(), created_by_ref: z.string(), updated_by_ref: z.string()
}).strict();

const seedSchema = z.object({
  fixture_version: z.literal(VS1_FIXTURE_VERSION),
  clock: z.literal("2026-08-09T12:00:00Z"),
  authorization_version: z.literal(1),
  policy_epoch: z.literal(1),
  recovery_epoch: z.literal(1),
  source: sourceSchema,
  precondition_graphs: z.object({
    same_content: z.object({ base_case_id: z.literal("VS1-HAPPY-001"), reuse_external_id: z.literal(true) }).strict(),
    same_event: z.object({ base_case_id: z.literal("VS1-HAPPY-001"), existing_source_id: z.literal("src-preexisting"), existing_content_id: z.string() }).strict(),
    different_day: z.object({ base_case_id: z.literal("VS1-HAPPY-001"), existing_day: z.literal("2026-08-09"), candidate_day: z.literal("2026-08-10") }).strict(),
    fingerprint_collision: z.object({ canonical_bytes_mode: z.literal("different"), event_status: z.literal("needs_review") }).strict(),
    approved_chain: z.object({ existing_content_id: z.string(), summary_status: z.literal("approved"), bundle_status: z.literal("approved"), has_review_decision: z.literal(true), has_publication: z.literal(true) }).strict(),
    stale_fence: z.object({ field: z.literal("source_config_epoch"), before: z.literal(1), after: z.literal(2) }).strict()
  }).strict()
}).strict();

const artifactSchema = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = z.object({
  fixture_version: z.literal(VS1_FIXTURE_VERSION),
  registry: artifactSchema,
  seed: artifactSchema,
  contracts: z.object({
    schema: artifactSchema,
    state_machine: artifactSchema,
    runtime_envelope: artifactSchema,
    internal_contract: artifactSchema
  }).strict(),
  migrations: z.array(artifactSchema).length(6),
  validator_receipt: z.object({
    candidate_case_count: z.number().int().positive(),
    missing_summary_exception_case_ids: z.tuple([z.literal(VS1_SUMMARY_MISSING_CASE_ID)]),
    missing_summary_exception_count: z.literal(1)
  }).strict()
}).strict();

export type Vs1Case = z.infer<typeof fixtureCaseSchema>;
export type Vs1Attempt = z.infer<typeof attemptSchema>;
export type Vs1Candidate = z.infer<typeof candidateSchema>;
export type Vs1Seed = z.infer<typeof seedSchema>;

export type Vs1FixtureBundle = {
  cases: readonly Vs1Case[];
  seed: Vs1Seed;
  fixtureHash: string;
  schemaHash: string;
  manifestHash: string;
  migrations: ReadonlyArray<{ path: string; sha256: string }>;
  validatorReceipt: {
    candidate_case_count: number;
    missing_summary_exception_case_ids: [typeof VS1_SUMMARY_MISSING_CASE_ID];
    missing_summary_exception_count: 1;
  };
};

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("FIXTURE_PATH: artifact escapes project root");
}

function readFixedFile(projectRoot: string, relativePath: string): Buffer {
  const absolute = resolve(projectRoot, relativePath);
  assertInside(projectRoot, absolute);
  const real = realpathSync(absolute);
  assertInside(realpathSync(projectRoot), real);
  const stat = lstatSync(absolute);
  const currentUid = process.getuid?.();
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o022) !== 0 || currentUid === undefined || stat.uid !== currentUid) {
    throw new Error("FIXTURE_PATH: artifact is not an owner-controlled regular file");
  }
  return readFileSync(absolute);
}

type JsonToken = { kind: "string" | "punct" | "atom"; value: string };

function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index += 1; continue; }
    const character = text[index];
    if ("{}[]:,".includes(character)) { tokens.push({ kind: "punct", value: character }); index += 1; continue; }
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") { index += 2; continue; }
        if (text[index] === '"') { index += 1; break; }
        index += 1;
      }
      if (text[index - 1] !== '"') throw new Error("INVALID_FIXTURE: unterminated JSON string");
      tokens.push({ kind: "string", value: JSON.parse(text.slice(start, index)) as string });
      continue;
    }
    const start = index;
    while (index < text.length && !/[\s{}\[\]:,]/.test(text[index])) index += 1;
    tokens.push({ kind: "atom", value: text.slice(start, index) });
  }
  return tokens;
}

function rejectDuplicateKeys(text: string): void {
  const tokens = tokenizeJson(text);
  const parseValue = (start: number): number => {
    const token = tokens[start];
    if (!token) throw new Error("INVALID_FIXTURE: incomplete JSON");
    if (token.value === "{") {
      const keys = new Set<string>();
      let index = start + 1;
      if (tokens[index]?.value === "}") return index + 1;
      while (true) {
        const key = tokens[index];
        if (key?.kind !== "string" || tokens[index + 1]?.value !== ":") throw new Error("INVALID_FIXTURE: invalid object key");
        if (keys.has(key.value)) throw new Error("INVALID_FIXTURE: duplicate JSON key");
        keys.add(key.value);
        index = parseValue(index + 2);
        if (tokens[index]?.value === "}") return index + 1;
        if (tokens[index]?.value !== ",") throw new Error("INVALID_FIXTURE: invalid object separator");
        index += 1;
      }
    }
    if (token.value === "[") {
      let index = start + 1;
      if (tokens[index]?.value === "]") return index + 1;
      while (true) {
        index = parseValue(index);
        if (tokens[index]?.value === "]") return index + 1;
        if (tokens[index]?.value !== ",") throw new Error("INVALID_FIXTURE: invalid array separator");
        index += 1;
      }
    }
    return start + 1;
  };
  if (parseValue(0) !== tokens.length) throw new Error("INVALID_FIXTURE: trailing JSON data");
}

export function parseClosedJson(bytes: Buffer): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  rejectDuplicateKeys(text);
  return JSON.parse(text) as unknown;
}

export function parseFixtureRegistry(value: unknown): z.infer<typeof registrySchema> {
  return registrySchema.parse(value);
}

export function loadVs1FixtureBundle(appRoot: string): Vs1FixtureBundle {
  const projectRoot = resolve(appRoot, "..");
  const manifestBytes = readFixedFile(projectRoot, "app/fixtures/vs1-local-pipeline-manifest-v1.json");
  const manifest = manifestSchema.parse(parseClosedJson(manifestBytes));
  const allArtifacts = [manifest.registry, manifest.seed, ...Object.values(manifest.contracts), ...manifest.migrations];
  const verifiedBytes = new Map<string, Buffer>();
  for (const artifact of allArtifacts) {
    const bytes = readFixedFile(projectRoot, artifact.path);
    if (sha256(bytes) !== artifact.sha256) throw new Error("SCHEMA_HASH_MISMATCH: manifest artifact hash mismatch");
    verifiedBytes.set(artifact.path, bytes);
  }
  const registry = parseFixtureRegistry(parseClosedJson(verifiedBytes.get(manifest.registry.path)!));
  const seed = seedSchema.parse(parseClosedJson(verifiedBytes.get(manifest.seed.path)!));
  const ids = registry.cases.map((fixtureCase) => fixtureCase.case_id);
  if (new Set(ids).size !== ids.length) throw new Error("INVALID_FIXTURE: duplicate case_id");
  const candidateAttempts = registry.cases.flatMap((fixtureCase) => fixtureCase.attempts.map((attempt) => ({ fixtureCase, attempt }))).filter(({ attempt }) => attempt.adapter_outcome === "candidate");
  const missing = candidateAttempts.filter(({ attempt }) => attempt.mock_summary === undefined).map(({ fixtureCase }) => fixtureCase.case_id);
  const derived = {
    candidate_case_count: candidateAttempts.length,
    missing_summary_exception_case_ids: missing,
    missing_summary_exception_count: missing.length
  };
  if (JSON.stringify(derived) !== JSON.stringify(manifest.validator_receipt)) {
    throw new Error("SEED_GRAPH_MISMATCH: validator receipt does not match registry scan");
  }
  return {
    cases: registry.cases,
    seed,
    fixtureHash: manifest.registry.sha256,
    schemaHash: manifest.contracts.schema.sha256,
    manifestHash: sha256(manifestBytes),
    migrations: manifest.migrations,
    validatorReceipt: manifest.validator_receipt
  };
}
