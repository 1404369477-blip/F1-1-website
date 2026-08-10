import { installNoEgressGuard } from "../src/server/vs1/no-egress.ts";

type ExpectedCase = readonly [reasonCode: string, exitCode: 0 | 1, recoveryAction: string];
type AssertionCase = {
  caseId: string;
  reasonCode: string;
  exitCode: 0 | 1;
  recoveryAction: string;
  assertionResult: "PASS";
  externalCalls: 0;
  attemptHistory?: Array<{ attempt: number; outcome: string; leasePresent: true; retryDelaySeconds: 0 | 1 | 3 }>;
  deadLetterDelta?: 1;
  domainRollbackVerified?: true;
};

const guard = installNoEgressGuard();
try {
  const [assertModule, cryptoModule, { runSafeCli }, fixture, pipeline] = await Promise.all([
    import("node:assert"),
    import("node:crypto"),
    import("../src/server/security/cli.ts"),
    import("../src/server/vs1/fixture.ts"),
    import("../src/server/vs1/pipeline.ts")
  ]);
  const assert: typeof import("node:assert").strict = assertModule.strict;
  await runSafeCli(() => {
    const appRoot = new URL("..", import.meta.url).pathname;
    const bundle = fixture.loadVs1FixtureBundle(appRoot);
    assert.equal(bundle.cases.length, 25);
    assert.deepEqual(bundle.validatorReceipt, {
      candidate_case_count: 23,
      missing_summary_exception_case_ids: ["VS1-SUMMARY-MISSING-012"],
      missing_summary_exception_count: 1
    });
    const expected = new Map<string, ExpectedCase>([
      ["VS1-HAPPY-001", ["PIPELINE_READY", 0, "NO_ACTION"]],
      ["VS1-CONTENT-DUP-003", ["CONTENT_DUPLICATE_REUSED", 0, "NO_ACTION"]],
      ["VS1-EVENT-MERGE-004", ["EVENT_MEMBER_MERGED", 0, "NO_ACTION"]],
      ["VS1-EVENT-DAY-005", ["EVENT_NEW_DAY", 0, "NO_ACTION"]],
      ["VS1-NORMALIZE-006A", ["CONTENT_NORMALIZATION_INVALID", 0, "NO_ACTION_FILTERED"]],
      ["VS1-EMPTY-006B", ["CONTENT_EMPTY", 0, "NO_ACTION_FILTERED"]],
      ["VS1-AD-007", ["CONTENT_OBVIOUS_AD", 0, "NO_ACTION_FILTERED"]],
      ["VS1-SPAM-008", ["CONTENT_SPAM", 0, "NO_ACTION_FILTERED"]],
      ["VS1-OFFTOPIC-009", ["CONTENT_F1_UNRELATED", 0, "NO_ACTION_FILTERED"]],
      ["VS1-UNKNOWN-010", ["CONTENT_RELEVANCE_UNKNOWN", 0, "NO_ACTION_FILTERED"]],
      ["VS1-HASH-COLLISION-011", ["DEDUP_COLLISION_UNRESOLVED", 1, "RESOLVE_COLLISION_THEN_RESEED"]],
      ["VS1-SUMMARY-MISSING-012", ["SUMMARY_FIXTURE_NOT_ALLOWLISTED", 1, "FIX_FIXTURE_AND_RESEED_TASK_DB"]],
      ["VS1-STALE-FENCE-013", ["STALE_FENCE", 1, "CLEAR_STOP_OR_REFRESH_FENCES_THEN_RESEED"]],
      ["VS1-RETRY-014", ["PIPELINE_READY", 0, "NO_ACTION"]],
      ["VS1-DEAD-015", ["HTTP_503", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016A", ["TX_CAPTURE_WRITE_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016B", ["TX_CONTENT_WRITE_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016C", ["TX_EVENT_CAS_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016D", ["TX_SUMMARY_WRITE_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016E", ["TX_BUNDLE_WRITE_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016F", ["TX_ACK_CAS_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-PARTIAL-016G", ["TX_AUDIT_WRITE_FAILED", 1, "ARCHIVE_AND_RESEED_TASK_DB"]],
      ["VS1-APPROVED-017", ["APPROVED_CHAIN_PRESENT", 1, "HAND_OFF_APPROVED_CHAIN_TO_ADMIN"]]
    ]);
    const assertionsByCase = new Map<string, AssertionCase>();
    for (const [caseId, [reasonCode, exitCode, recoveryAction]] of expected) {
      const result = pipeline.runVs1Case(appRoot, caseId, () => guard.externalCalls);
      try {
        assert.equal(result.receipt?.reasonCode, reasonCode, caseId);
        assert.equal(result.exitCode, exitCode, caseId);
        assert.equal(result.vops.length, 3, caseId);
        assert.equal(result.receipt?.externalCalls, 0, caseId);
        assert.equal(result.receipt?.recoveryAction, recoveryAction, `${caseId}:recoveryAction`);
        assert.ok(result.vops.every((line) => line.recoveryAction === recoveryAction), `${caseId}:V-OP recoveryAction`);
        const domainRollbackVerified = /^VS1-PARTIAL-016[A-G]$/.test(caseId) || caseId === "VS1-SUMMARY-MISSING-012" || caseId === "VS1-APPROVED-017";
        if (domainRollbackVerified) {
          assert.equal(result.receipt?.domainBeforeHash, result.receipt?.domainAfterHash, caseId);
        }
        if (caseId === "VS1-RETRY-014") {
          assert.equal(result.receipt?.attempt, 3, `${caseId}:max attempts`);
          assert.deepEqual(result.receipt?.attemptHistory, [
            { attempt: 1, outcome: "HTTP_503", leasePresent: true, retryDelaySeconds: 1 },
            { attempt: 2, outcome: "COLLECTION_TIMEOUT", leasePresent: true, retryDelaySeconds: 3 },
            { attempt: 3, outcome: "PIPELINE_READY", leasePresent: true, retryDelaySeconds: 0 }
          ], `${caseId}:fixture clock and attempt history`);
        }
        if (caseId === "VS1-DEAD-015") {
          assert.equal(result.receipt?.attempt, 3, `${caseId}:max attempts`);
          assert.deepEqual(result.receipt?.attemptHistory, [
            { attempt: 1, outcome: "HTTP_503", leasePresent: true, retryDelaySeconds: 1 },
            { attempt: 2, outcome: "HTTP_503", leasePresent: true, retryDelaySeconds: 3 },
            { attempt: 3, outcome: "HTTP_503", leasePresent: true, retryDelaySeconds: 0 }
          ], `${caseId}:dead-letter attempt history`);
          assert.equal(result.receipt?.entityDeltas.dead_letter, 1, `${caseId}:dead-letter delta`);
        }
        assertionsByCase.set(caseId, {
          caseId,
          reasonCode,
          exitCode,
          recoveryAction,
          assertionResult: "PASS",
          externalCalls: 0,
          ...(caseId === "VS1-RETRY-014" || caseId === "VS1-DEAD-015" ? { attemptHistory: result.receipt!.attemptHistory } : {}),
          ...(caseId === "VS1-DEAD-015" ? { deadLetterDelta: 1 as const } : {}),
          ...(domainRollbackVerified ? { domainRollbackVerified: true as const } : {})
        });
      } finally {
        pipeline.cleanupVs1TaskRoot(result.taskRoot);
      }
    }

    const happy = pipeline.runVs1Case(appRoot, "VS1-HAPPY-001", () => guard.externalCalls);
    try {
      const replay = pipeline.replaySucceededReceipt(appRoot, happy);
      assert.deepEqual(replay.receipt, happy.receipt);
      assert.ok(replay.vops.every((line) => line.reasonCode === "IDEMPOTENT_REPLAY"));
      assert.ok(replay.vops.every((line) => line.recoveryAction === "NO_ACTION"));
      assert.equal(replay.receipt.externalCalls, 0);
      assertionsByCase.set("VS1-REPLAY-002", {
        caseId: "VS1-REPLAY-002", reasonCode: "IDEMPOTENT_REPLAY", exitCode: 0,
        recoveryAction: "NO_ACTION", assertionResult: "PASS", externalCalls: 0
      });
    } finally {
      pipeline.cleanupVs1TaskRoot(happy.taskRoot);
    }

    const noWork = pipeline.runVs1Case(appRoot, "VS1-NO-WORK-018", () => guard.externalCalls);
    try {
      assert.equal(noWork.receipt, null);
      assert.ok(noWork.vops.every((line) => line.status === "NO_WORK"));
      assert.ok(noWork.vops.every((line) => line.reasonCode === "NO_WORK" && line.recoveryAction === "NO_ACTION" && line.externalCalls === 0));
      assertionsByCase.set("VS1-NO-WORK-018", {
        caseId: "VS1-NO-WORK-018", reasonCode: "NO_WORK", exitCode: 0,
        recoveryAction: "NO_ACTION", assertionResult: "PASS", externalCalls: 0
      });
    } finally {
      pipeline.cleanupVs1TaskRoot(noWork.taskRoot);
    }
    assert.equal(guard.externalCalls, 0);
    const cases = bundle.cases.map(({ case_id: caseId }) => {
      const assertionCase = assertionsByCase.get(caseId);
      assert.ok(assertionCase, `${caseId}:assertion receipt missing`);
      return assertionCase;
    });
    assert.equal(cases.length, 25);
    assert.equal(assertionsByCase.size, 25);
    const receiptCore = { schemaVersion: "vs1-contract-assertion-receipt-v1", cases, externalCalls: 0 as const };
    const assertionReceiptHash = cryptoModule.createHash("sha256").update(JSON.stringify(receiptCore)).digest("hex");
    process.stdout.write(`${JSON.stringify({ event: "vs1_contract", status: "ok", ...receiptCore, assertionReceiptHash })}\n`);
  }, () => guard.externalCalls);
} finally {
  guard.restore();
}
