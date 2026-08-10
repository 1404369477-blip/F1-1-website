import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  fixtureCaseSchema,
  loadVs1FixtureBundle,
  parseClosedJson,
  parseFixtureRegistry
} from "../server/vs1/fixture.ts";
import { installNoEgressGuard } from "../server/vs1/no-egress.ts";
import {
  cleanupVs1TaskRoot,
  assertVs1InsertOrReturnRow,
  eventFingerprintInput,
  eventFingerprintV1,
  normalizeTextV1,
  replaySucceededReceipt,
  runVs1Case,
  syntheticQualityV1,
  VS1_FUNCTION_IDS,
  type Vs1FullReceipt,
  type Vs1RunResult
} from "../server/vs1/pipeline.ts";
import { canonicalJson } from "../server/db/profile.ts";

const appRoot = resolve(import.meta.dirname, "../..");
const domainTables = ["source_observation", "captured_item", "content", "event", "summary", "release_bundle"] as const;

const expectedCases = new Map<string, {
  reason: string;
  exitCode: 0 | 1;
  attempt?: number;
  domain?: Partial<Record<(typeof domainTables)[number], number>>;
}>([
  ["VS1-HAPPY-001", { reason: "PIPELINE_READY", exitCode: 0, domain: { source_observation: 1, captured_item: 1, content: 1, event: 1, summary: 1, release_bundle: 1 } }],
  ["VS1-CONTENT-DUP-003", { reason: "CONTENT_DUPLICATE_REUSED", exitCode: 0, domain: { content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-EVENT-MERGE-004", { reason: "EVENT_MEMBER_MERGED", exitCode: 0, domain: { content: 1, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-EVENT-DAY-005", { reason: "EVENT_NEW_DAY", exitCode: 0, domain: { event: 1 } }],
  ["VS1-NORMALIZE-006A", { reason: "CONTENT_NORMALIZATION_INVALID", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-EMPTY-006B", { reason: "CONTENT_EMPTY", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-AD-007", { reason: "CONTENT_OBVIOUS_AD", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-SPAM-008", { reason: "CONTENT_SPAM", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-OFFTOPIC-009", { reason: "CONTENT_F1_UNRELATED", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-UNKNOWN-010", { reason: "CONTENT_RELEVANCE_UNKNOWN", exitCode: 0, domain: { captured_item: 1, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-HASH-COLLISION-011", { reason: "DEDUP_COLLISION_UNRESOLVED", exitCode: 1, domain: { content: 1, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-SUMMARY-MISSING-012", { reason: "SUMMARY_FIXTURE_NOT_ALLOWLISTED", exitCode: 1, domain: { source_observation: 0, captured_item: 0, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-STALE-FENCE-013", { reason: "STALE_FENCE", exitCode: 1, domain: { source_observation: 0, captured_item: 0, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-RETRY-014", { reason: "PIPELINE_READY", exitCode: 0, attempt: 3, domain: { content: 1, event: 1, summary: 1, release_bundle: 1 } }],
  ["VS1-DEAD-015", { reason: "HTTP_503", exitCode: 1, attempt: 3, domain: { source_observation: 0, captured_item: 0, content: 0, event: 0, summary: 0, release_bundle: 0 } }],
  ["VS1-PARTIAL-016A", { reason: "TX_CAPTURE_WRITE_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016B", { reason: "TX_CONTENT_WRITE_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016C", { reason: "TX_EVENT_CAS_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016D", { reason: "TX_SUMMARY_WRITE_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016E", { reason: "TX_BUNDLE_WRITE_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016F", { reason: "TX_ACK_CAS_FAILED", exitCode: 1 }],
  ["VS1-PARTIAL-016G", { reason: "TX_AUDIT_WRITE_FAILED", exitCode: 1 }],
  ["VS1-APPROVED-017", { reason: "APPROVED_CHAIN_PRESENT", exitCode: 1, domain: { source_observation: 0, captured_item: 0, content: 0, event: 0, summary: 0, release_bundle: 0 } }]
]);

const receiptKeys: Array<keyof Vs1FullReceipt> = [
  "schemaVersion", "fixtureVersion", "fixtureHash", "manifestHash", "operationId", "idempotencyKey", "envelopeHash", "sourceId", "attempt",
  "leasePresent", "fiveFences", "transactionSequence", "transactionCommitted", "reasonCode", "entityDeltas", "canonicalIds", "contentHash",
  "eventHash", "summaryHash", "bundleHash", "dbBeforeHash", "dbAfterHash", "domainBeforeHash", "domainAfterHash", "externalCalls", "cleanupStatus",
  "recoveryAction", "attemptHistory", "validatorReceipt"
];

function expectClosedVops(result: Vs1RunResult): void {
  expect(result.vops.map((line) => line.functionId)).toEqual(VS1_FUNCTION_IDS);
  for (const line of result.vops) {
    expect(Object.keys(line).sort()).toEqual(["artifactHash", "externalCalls", "functionId", "reasonCode", "recoveryAction", "status"]);
    expect(line.artifactHash).toBe(result.artifactHash);
    expect(line.externalCalls).toBe(0);
  }
}

function expectSecureArtifacts(result: Vs1RunResult): void {
  expect(statSync(result.taskRoot).mode & 0o777).toBe(0o700);
  expect(statSync(result.dbPath).mode & 0o777).toBe(0o600);
  if (!result.receipt || !result.receiptPath) return;
  expect(statSync(result.receiptPath).mode & 0o777).toBe(0o600);
  expect(Object.keys(result.receipt).sort()).toEqual(receiptKeys.sort());
  const receiptText = readFileSync(result.receiptPath, "utf8");
  for (const forbidden of ["SYNTHETIC_ONLY", "synthetic.invalid", "lease_token", appRoot, result.taskRoot]) {
    expect(receiptText).not.toContain(forbidden);
  }
}

describe("VS1 accepted fixture contract", () => {
  it("binds the complete mandatory registry and the sole summary-missing exception", () => {
    const bundle = loadVs1FixtureBundle(appRoot);
    expect(bundle.cases.map((fixtureCase) => fixtureCase.case_id)).toEqual([
      "VS1-HAPPY-001", "VS1-REPLAY-002", "VS1-CONTENT-DUP-003", "VS1-EVENT-MERGE-004", "VS1-EVENT-DAY-005",
      "VS1-NORMALIZE-006A", "VS1-EMPTY-006B", "VS1-AD-007", "VS1-SPAM-008", "VS1-OFFTOPIC-009", "VS1-UNKNOWN-010",
      "VS1-HASH-COLLISION-011", "VS1-SUMMARY-MISSING-012", "VS1-STALE-FENCE-013", "VS1-RETRY-014", "VS1-DEAD-015",
      "VS1-PARTIAL-016A", "VS1-PARTIAL-016B", "VS1-PARTIAL-016C", "VS1-PARTIAL-016D", "VS1-PARTIAL-016E", "VS1-PARTIAL-016F",
      "VS1-PARTIAL-016G", "VS1-APPROVED-017", "VS1-NO-WORK-018"
    ]);
    expect(bundle.validatorReceipt).toEqual({
      candidate_case_count: 23,
      missing_summary_exception_case_ids: ["VS1-SUMMARY-MISSING-012"],
      missing_summary_exception_count: 1
    });
  });

  it("rejects extra, duplicate, illegal missing and illegal present summary branches", () => {
    const registry = JSON.parse(readFileSync(resolve(appRoot, "fixtures/vs1-local-pipeline-v1.json"), "utf8")) as { cases: Array<Record<string, unknown>>; fixture_version: string };
    const happy = structuredClone(registry.cases[0]) as Record<string, unknown> & { attempts: Array<Record<string, unknown>> };
    delete happy.attempts[0].mock_summary;
    expect(() => fixtureCaseSchema.parse(happy)).toThrow();

    const missing = structuredClone(registry.cases.find((entry) => entry.case_id === "VS1-SUMMARY-MISSING-012")) as Record<string, unknown> & { attempts: Array<Record<string, unknown>> };
    for (const illegal of [{ title_zh: "非法", summary_zh: "非法" }, null, {}, ""]) {
      const candidate = structuredClone(missing);
      candidate.attempts[0].mock_summary = illegal;
      expect(() => fixtureCaseSchema.parse(candidate)).toThrow();
    }

    const nearCase = structuredClone(missing);
    nearCase.case_id = "VS1-SUMMARY-MISSING-012A";
    delete nearCase.attempts[0].mock_summary;
    expect(() => fixtureCaseSchema.parse(nearCase)).toThrow();

    const extra = structuredClone(registry);
    extra.cases[0].unexpected = true;
    expect(() => parseFixtureRegistry(extra)).toThrow();
    const transient = structuredClone(registry.cases.find((entry) => entry.case_id === "VS1-DEAD-015")) as Record<string, unknown> & { attempts: Array<Record<string, unknown>> };
    transient.attempts[0].candidate = structuredClone(happy.attempts[0].candidate);
    expect(() => fixtureCaseSchema.parse(transient)).toThrow();
    delete transient.attempts[0].candidate;
    transient.attempts[0].mock_summary = { title_zh: "非法", summary_zh: "非法" };
    expect(() => fixtureCaseSchema.parse(transient)).toThrow();
    const lowerCase = structuredClone(missing);
    lowerCase.case_id = "vs1-summary-missing-012";
    expect(() => fixtureCaseSchema.parse(lowerCase)).toThrow();
    expect(() => parseClosedJson(Buffer.from('{"fixture_version":"vs1-local-pipeline-v1","fixture_version":"vs1-local-pipeline-v1","cases":[]}'))).toThrow("duplicate JSON key");
  });

  it("matches the two accepted event-dedup-v1 golden values", () => {
    const bundle = loadVs1FixtureBundle(appRoot);
    const happy = bundle.cases.find((entry) => entry.case_id === "VS1-HAPPY-001")?.attempts[0].candidate;
    const nextDay = bundle.cases.find((entry) => entry.case_id === "VS1-EVENT-DAY-005")?.attempts[0].candidate;
    expect(happy).toBeDefined();
    expect(nextDay).toBeDefined();
    const referenceCanonical = (value: unknown): string => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(referenceCanonical).join(",")}]`;
      return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => `${JSON.stringify(key)}:${referenceCanonical(entry)}`).join(",")}}`;
    };
    const fingerprint = (candidate: NonNullable<typeof happy>) => eventFingerprintV1(eventFingerprintInput(
      candidate,
      normalizeTextV1(candidate.title, true),
      normalizeTextV1(candidate.body, false)
    ));
    const input = eventFingerprintInput(happy!, normalizeTextV1(happy!.title, true), normalizeTextV1(happy!.body, false));
    expect(referenceCanonical(input)).toBe(canonicalJson(input));
    expect(createHash("sha256").update(referenceCanonical(input)).digest("hex")).toBe("4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1");
    expect(fingerprint(happy!)).toBe("4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1");
    expect(fingerprint(nextDay!)).toBe("11aef98ca09276504ed792c50ace95f8d072d0a53bdfd0e2d756e3e12c8c8301");
    const golden = fingerprint(happy!);
    expect(fingerprint({ ...happy!, title: `${happy!.title}!` })).not.toBe(golden);
    expect(fingerprint({ ...happy!, body: `${happy!.body}!` })).not.toBe(golden);
    expect(fingerprint({ ...happy!, language: "zh-CN" })).not.toBe(golden);
    expect(fingerprint({ ...happy!, content_kind: "video" })).not.toBe(golden);
    expect(eventFingerprintV1({ ...input, extra_key: true })).not.toBe(golden);
  });

  it("normalizes deterministically and classifies only explicit synthetic markers", () => {
    expect(normalizeTextV1("  A\t  B\r\n C  ", true)).toBe("A B C");
    expect(normalizeTextV1("  A\t  B\r\n C  ", false)).toBe("A B\nC");
    expect(() => normalizeTextV1("bad\u0000text", false)).toThrow("CONTENT_NORMALIZATION_INVALID");
    expect(syntheticQualityV1("SYNTHETIC_ONLY:F1: title", "body")).toBeNull();
    expect(syntheticQualityV1("plain", "plain")).toBe("CONTENT_RELEVANCE_UNKNOWN");
  });

  it("rejects polluted insert-or-return materialized columns and payload bytes", () => {
    const payload = { id: "synthetic", status: "ready" };
    const row = { id: "synthetic", status: "ready", payload_json: canonicalJson(payload) };
    expect(assertVs1InsertOrReturnRow(row, { id: "synthetic", status: "ready" }, payload)).toBe(row);
    expect(() => assertVs1InsertOrReturnRow({ ...row, status: "polluted" }, { id: "synthetic", status: "ready" }, payload)).toThrow("DB_CORRUPTION");
    expect(() => assertVs1InsertOrReturnRow({ ...row, payload_json: canonicalJson({ ...payload, status: "polluted" }) }, { id: "synthetic", status: "ready" }, payload)).toThrow("DB_CORRUPTION");
  });
});

describe("VS1 one-operation local synthetic pipeline", () => {
  it("executes every mandatory terminal and rollback case with closed receipts", () => {
    const guard = installNoEgressGuard();
    try {
      for (const [caseId, expected] of expectedCases) {
        const result = runVs1Case(appRoot, caseId, () => guard.externalCalls);
        try {
          expect(result.exitCode, caseId).toBe(expected.exitCode);
          expect(result.receipt?.reasonCode, caseId).toBe(expected.reason);
          expect(result.receipt?.attempt, caseId).toBe(expected.attempt ?? 1);
          expect(result.receipt?.externalCalls, caseId).toBe(0);
          expectClosedVops(result);
          expectSecureArtifacts(result);
          for (const [table, delta] of Object.entries(expected.domain ?? {})) {
            expect(result.receipt?.entityDeltas[table], `${caseId}:${table}`).toBe(delta);
          }
          if (/^VS1-PARTIAL-016[A-G]$/.test(caseId)) {
            expect(result.receipt?.transactionCommitted, caseId).toBe(false);
            expect(result.receipt?.domainAfterHash, caseId).toBe(result.receipt?.domainBeforeHash);
            for (const table of domainTables) expect(result.receipt?.entityDeltas[table], `${caseId}:${table}`).toBe(0);
            expect(result.receipt?.entityDeltas.dead_letter, caseId).toBe(1);
            expect(result.receipt?.entityDeltas.audit_event, caseId).toBe(1);
          }
          if (caseId === "VS1-SUMMARY-MISSING-012") {
            expect(result.receipt?.transactionCommitted).toBe(false);
            expect(result.receipt?.transactionSequence).toContain("summary_allowlist_lookup_miss");
            expect(result.vops.map((line) => [line.status, line.reasonCode])).toEqual([
              ["FAIL", "SUMMARY_FIXTURE_NOT_ALLOWLISTED"],
              ["FAIL", "SUMMARY_FIXTURE_NOT_ALLOWLISTED"],
              ["FAIL", "SUMMARY_FIXTURE_NOT_ALLOWLISTED"]
            ]);
          }
          if (caseId === "VS1-HAPPY-001") {
            const database = new DatabaseSync(result.dbPath, { readOnly: true });
            try {
              const event = database.prepare("SELECT * FROM event").get() as Record<string, unknown>;
              const payload = JSON.parse(String(event.payload_json)) as Record<string, unknown>;
              expect(Object.keys(payload).sort()).toEqual(["canonical_content_id", "created_at", "created_by_ref", "dedup_fingerprint", "dedup_status", "event_id", "member_content_ids", "source_config_epoch", "updated_at", "updated_by_ref"]);
              expect(event.created_at).toBe(payload.created_at);
              expect(event.updated_at).toBe(payload.updated_at);
            } finally {
              database.close();
            }
          }
          if (caseId === "VS1-APPROVED-017") expect(result.receipt?.domainAfterHash).toBe(result.receipt?.domainBeforeHash);
          if (caseId === "VS1-RETRY-014") {
            expect(result.receipt?.attemptHistory.map((entry) => [entry.attempt, entry.outcome, entry.retryDelaySeconds])).toEqual([
              [1, "HTTP_503", 1], [2, "COLLECTION_TIMEOUT", 3], [3, "PIPELINE_READY", 0]
            ]);
          }
          if (caseId === "VS1-DEAD-015") {
            expect(result.receipt?.attemptHistory).toHaveLength(3);
            expect(result.receipt?.entityDeltas.dead_letter).toBe(1);
          }
        } finally {
          cleanupVs1TaskRoot(result.taskRoot);
        }
      }
      expect(guard.externalCalls).toBe(0);
    } finally {
      guard.restore();
    }
  }, 30_000);

  it("returns the exact prior receipt on replay without a second write", () => {
    const result = runVs1Case(appRoot, "VS1-HAPPY-001");
    try {
      const receiptBytes = readFileSync(result.receiptPath!, "utf8");
      const replay = replaySucceededReceipt(appRoot, result);
      expect(replay.receipt).toEqual(result.receipt);
      expect(readFileSync(result.receiptPath!, "utf8")).toBe(receiptBytes);
      expect(replay.vops.every((line) => line.reasonCode === "IDEMPOTENT_REPLAY" && line.status === "PASS")).toBe(true);
      expect(replay.vops.every((line) => line.artifactHash === result.artifactHash)).toBe(true);
    } finally {
      cleanupVs1TaskRoot(result.taskRoot);
    }
  });

  it("denies every supported Node network and process escape hatch", () => {
    const require = createRequire(import.meta.url);
    const guard = installNoEgressGuard();
    try {
      const calls: Array<[string, () => unknown]> = [
        ["net.connect", () => (require("node:net") as { connect: () => unknown }).connect()],
        ["Socket.connect", () => (require("node:net") as { Socket: new () => { connect: () => unknown } }).Socket.prototype.connect()],
        ["tls.connect", () => (require("node:tls") as { connect: () => unknown }).connect()],
        ["http2.connect", () => (require("node:http2") as { connect: () => unknown }).connect()],
        ["dns.promises.lookup", () => (require("node:dns/promises") as { lookup: () => unknown }).lookup()],
        ["child_process.spawn", () => (require("node:child_process") as { spawn: () => unknown }).spawn()],
        ["cluster.fork", () => (require("node:cluster") as { fork: () => unknown }).fork()],
        ["worker_threads.Worker", () => Reflect.construct((require("node:worker_threads") as { Worker: new () => unknown }).Worker, [])],
        ["fetch", () => globalThis.fetch("https://synthetic.invalid")]
      ];
      for (const [label, call] of calls) {
        const before = guard.externalCalls;
        expect(call, label).toThrow("EXTERNAL_IO_FORBIDDEN");
        expect(guard.externalCalls, label).toBe(before + 1);
      }
    } finally {
      guard.restore();
    }
  });

  it("does no work, writes no receipt and leaves the database byte-identical", () => {
    const result = runVs1Case(appRoot, "VS1-NO-WORK-018");
    try {
      expect(result.exitCode).toBe(0);
      expect(result.receipt).toBeNull();
      expect(result.receiptPath).toBeNull();
      expect(result.artifactHash).toBeNull();
      expect(result.vops.every((line) => line.status === "NO_WORK" && line.reasonCode === "NO_WORK" && line.artifactHash === null)).toBe(true);
      expectSecureArtifacts(result);
    } finally {
      cleanupVs1TaskRoot(result.taskRoot);
    }
  });
});
