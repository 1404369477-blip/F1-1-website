import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseTweetInboxDrop } from "../server/tweet-inbox/drop.ts";
import { parseOfficialTweetOembed } from "../server/tweet-inbox/oembed.ts";
import {
  applyTweetInboxMigration,
  applyXManualInboxMigration,
  assertXManualInboxSchema,
  readXManualInboxMigrationSql,
  XManualInboxRepository,
  X_MANUAL_INBOX_SCHEMA_SHA256,
  readTweetInboxMigrationSql,
  TweetInboxRepository
} from "../server/tweet-inbox/repository.ts";
import { applyInternalOperationMigration } from "../server/review-real/migration.ts";
import { installSqliteAuthorizer } from "../server/internal-operation/authorizer.ts";
import { SqliteInternalOperationGateway, type XManualFailurePoint } from "../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../server/internal-operation/mutation-port.ts";
import { persistOwnerSupervisorHandoff } from "../server/internal-operation/owner-supervisor.ts";
import { runManualXInboxCycle, runTweetInboxCycle } from "../server/tweet-inbox/run.ts";
import { buildOfficialOembedRequestUrl, fetchOfficialTweetOembed } from "../server/tweet-inbox/transport.ts";
import { TweetInboxError } from "../server/tweet-inbox/types.ts";
import { normalizeManualStatusUrl, normalizeTweetStatusUrl, snowflakePublishedAt } from "../server/tweet-inbox/url.ts";
import { openAdmittedReviewDatabase, disposeAdmittedReviewDatabases } from "./helpers/admitted-review-database.ts";

const sampleOembed = readFileSync(new URL("../../fixtures/tweet-inbox/oembed-sample.json", import.meta.url), "utf8");
const SAMPLE_TWEET_ID = "507185938380689408";

function openInbox(): { database: DatabaseSync; repository: TweetInboxRepository } {
  const database = new DatabaseSync(":memory:");
  applyTweetInboxMigration(database, readTweetInboxMigrationSql());
  return { database, repository: new TweetInboxRepository(database) };
}

const ZERO = "0".repeat(64);

function adminHandoff(index: number) {
  return {
    handoffId: `x-manual-handoff-${index}`,
    ownerProcess: "admin_http" as const,
    issuer: "f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce: `xmanual${String(index).padStart(2, "0")}`.padEnd(43, "a"),
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    receiptSha256: String(index + 1).repeat(64),
    verifiedAt: "2026-08-24T00:00:00.000Z",
    expiresAt: "2099-08-25T00:00:00.000Z",
  };
}

function openSchema8(withAdminAuthority = false, options: Readonly<{
  beforeGateway?: (database: DatabaseSync) => void;
  failureInjector?: (point: XManualFailurePoint) => void;
  afterAuthorizeInjector?: () => void;
}> = {}): {
  database: DatabaseSync;
  repository: XManualInboxRepository;
  gateway: SqliteInternalOperationGateway | null;
  port: SqliteGatewayMutationPort | null;
} {
  const applyBase = (database: DatabaseSync): void => {
    for (const migration of [
    "0001_rss_real.sql",
    "0002_admin_review_publish.sql",
    "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql",
    "0005_second_rss_autosport.sql",
    "0006_independent_rss_racefans_the_race.sql"
    ]) {
      database.exec(readFileSync(new URL(`../../migrations/rss-real/${migration}`, import.meta.url), "utf8"));
    }
    applyInternalOperationMigration(
      database,
      readFileSync(new URL("../../migrations/rss-real/0007_internal_operation_recovery_phase.sql", import.meta.url), "utf8")
    );
    applyXManualInboxMigration(database, readXManualInboxMigrationSql());
  };
  if (!withAdminAuthority) {
    const database = new DatabaseSync(":memory:");
    applyBase(database);
    options.beforeGateway?.(database);
    return { database, repository: new XManualInboxRepository(database), gateway: null, port: null };
  }
  const handoffs = [1, 2, 3, 4, 5, 6, 7, 8].map(adminHandoff);
  const database = openAdmittedReviewDatabase({
    finalVersion: 8,
    seed: (seedDatabase: DatabaseSync) => {
      applyBase(seedDatabase);
      options.beforeGateway?.(seedDatabase);
      for (const handoff of handoffs) persistOwnerSupervisorHandoff(seedDatabase, handoff, () => true);
    }
  });
  let handoffIndex = 0;
  const gateway = new SqliteInternalOperationGateway({
    database,
    releaseSha256: ZERO,
    manifestSha256: ZERO,
    schemaSha256: X_MANUAL_INBOX_SCHEMA_SHA256,
    now: () => new Date("2026-08-24T00:30:00.000Z"),
    xManualFailureInjector: options.failureInjector,
  });
  const port = new SqliteGatewayMutationPort({
    database,
    gateway,
    ownerProcess: "admin_http",
    handoffProvider: () => handoffs[handoffIndex++]!,
    now: () => new Date("2026-08-24T00:30:00.000Z"),
    xManualAfterAuthorizeInjector: options.afterAuthorizeInjector,
  });
  return { database, repository: new XManualInboxRepository(database, port), gateway, port };
}

describe("tweet inbox", () => {
  afterEach(() => disposeAdmittedReviewDatabases());

  it("normalizes status URLs and rejects profiles, search, and cookie-style junk", () => {
    expect(normalizeTweetStatusUrl("https://x.com/F1/status/507185938380689408?s=20")).toEqual({
      tweetId: SAMPLE_TWEET_ID,
      handle: "F1",
      canonicalUrl: `https://x.com/f1/status/${SAMPLE_TWEET_ID}`,
      submittedUrl: "https://x.com/F1/status/507185938380689408?s=20"
    });
    expect(normalizeTweetStatusUrl(`https://mobile.twitter.com/F1/status/${SAMPLE_TWEET_ID}/photo/1`).canonicalUrl)
      .toBe(`https://x.com/f1/status/${SAMPLE_TWEET_ID}`);
    expect(normalizeTweetStatusUrl(`https://x.com/i/web/status/${SAMPLE_TWEET_ID}`).handle).toBeNull();
    expect(() => normalizeTweetStatusUrl("https://x.com/F1")).toThrow(TweetInboxError);
    expect(() => normalizeTweetStatusUrl("https://x.com/home")).toThrow(TweetInboxError);
    expect(() => normalizeTweetStatusUrl("https://x.com/search?q=f1")).toThrow(TweetInboxError);
    expect(() => normalizeTweetStatusUrl("http://x.com/F1/status/1")).toThrow(TweetInboxError);
  });

  it("keeps snowflake timestamp decoding valid under the ES2017 typecheck target", () => {
    expect(snowflakePublishedAt(SAMPLE_TWEET_ID, Date.parse("2026-08-19T00:00:00Z")))
      .toBe("2014-09-03T15:18:45.426Z");
  });

  it("parses official oEmbed html into text and refuses iframe or script payloads", () => {
    const parsed = parseOfficialTweetOembed(sampleOembed, SAMPLE_TWEET_ID, Date.parse("2026-08-19T00:00:00Z"));
    expect(parsed.handle).toBe("interior");
    expect(parsed.canonicalUrl).toBe(`https://x.com/interior/status/${SAMPLE_TWEET_ID}`);
    expect(parsed.text).toContain("Sunsets don't get much better");
    expect(parsed.text).not.toMatch(/iframe|script/i);
    expect(parsed.sourcePublishedAt).toBe("2014-09-03T15:18:45.426Z");

    const payload = JSON.parse(sampleOembed) as { html: string };
    expect(() => parseOfficialTweetOembed(
      JSON.stringify({ ...payload, html: `<iframe src="https://x.com"></iframe>${payload.html}` }),
      SAMPLE_TWEET_ID
    )).toThrow(TweetInboxError);
    expect(() => parseOfficialTweetOembed(
      JSON.stringify({ ...payload, html: `${payload.html}<script src="https://platform.twitter.com/widgets.js"></script>` }),
      SAMPLE_TWEET_ID
    )).toThrow(TweetInboxError);
  });

  it("keeps the legacy oEmbed transport disabled", () => {
    expect(() => buildOfficialOembedRequestUrl(`https://x.com/f1/status/${SAMPLE_TWEET_ID}`)).toThrow(
      expect.objectContaining({ reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 })
    );
    expect(() => buildOfficialOembedRequestUrl("https://rsshub.example/twitter/user/F1")).toThrow(
      expect.objectContaining({ reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 })
    );
  });

  it("rejects every oEmbed I/O attempt before any network", async () => {
    await expect(fetchOfficialTweetOembed({
      canonicalStatusUrl: `https://x.com/f1/status/${SAMPLE_TWEET_ID}`,
      env: { NODE_ENV: "test", TWEET_INBOX_IO: "false" }
    })).rejects.toMatchObject({ reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 });

    await expect(fetchOfficialTweetOembed({
      canonicalStatusUrl: `https://x.com/f1/status/${SAMPLE_TWEET_ID}`,
      env: { NODE_ENV: "test", TWEET_INBOX_IO: "true", HTTPS_PROXY: "http://127.0.0.1:8888" }
    })).rejects.toMatchObject({ reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 });
  });

  it("keeps legacy queued rows without invoking an injected oEmbed client", async () => {
    const { database, repository } = openInbox();
    try {
      const drop = `
# comment
https://x.com/F1/status/${SAMPLE_TWEET_ID}?s=20
https://x.com/F1
https://x.com/F1/status/${SAMPLE_TWEET_ID}
`;
      expect(parseTweetInboxDrop(drop)).toMatchObject({
        lineCount: 3,
        invalidCount: 1
      });
      const receipt = await runTweetInboxCycle({
        repository,
        dropText: drop,
        scheduledAt: "2026-08-19T15:00:00.000Z",
        ioEnabled: true,
        fetchOembed: async () => sampleOembed
      });
      expect(receipt).toMatchObject({
        status: "failed",
        reasonCode: "CAPABILITY_DISABLED",
        queuedCount: 1,
        duplicateCount: 1,
        invalidCount: 1,
        fetchedCount: 0,
        externalCalls: 0,
        media: "none"
      });
      const stored = repository.readItem(SAMPLE_TWEET_ID);
      expect(stored).toMatchObject({ status: "queued" });
    } finally {
      database.close();
    }
  });

  it("keeps queued items when I/O is disabled and does not call the fetcher", async () => {
    const { database, repository } = openInbox();
    let calls = 0;
    try {
      const receipt = await runTweetInboxCycle({
        repository,
        dropText: `https://x.com/F1/status/${SAMPLE_TWEET_ID}`,
        scheduledAt: "2026-08-19T15:15:00.000Z",
        ioEnabled: false,
        fetchOembed: async () => {
          calls += 1;
          return sampleOembed;
        }
      });
      expect(receipt.status).toBe("failed");
      expect(receipt.reasonCode).toBe("TWEET_INBOX_IO_DISABLED");
      expect(calls).toBe(0);
      expect(repository.readItem(SAMPLE_TWEET_ID)?.status).toBe("queued");
    } finally {
      database.close();
    }
  });

  it("never turns an injected failure into an outbound attempt", async () => {
    const { database, repository } = openInbox();
    try {
      const first = await runTweetInboxCycle({
        repository,
        dropText: "https://x.com/F1/status/111111111111111111",
        scheduledAt: "2026-08-19T15:30:00.000Z",
        ioEnabled: true,
        fetchOembed: async () => {
          throw new TweetInboxError("TWEET_UNAVAILABLE", { externalCalls: 1, httpStatus: 404 });
        }
      });
      expect(first).toMatchObject({ status: "failed", reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 });
      expect(repository.readItem("111111111111111111")?.status).toBe("queued");

      const second = await runTweetInboxCycle({
        repository,
        dropText: "https://x.com/F1/status/222222222222222222",
        scheduledAt: "2026-08-19T15:45:00.000Z",
        ioEnabled: true,
        fetchOembed: async () => {
          throw new TweetInboxError("HTTP_429", { externalCalls: 1, httpStatus: 429, nextAction: "next_slot" });
        }
      });
      expect(second).toMatchObject({ status: "failed", reasonCode: "CAPABILITY_DISABLED", externalCalls: 0 });
      expect(repository.readItem("222222222222222222")?.status).toBe("queued");
    } finally {
      database.close();
    }
  });
});

describe("schema-8 manual X inbox", () => {
  it("accepts only human status URLs and strips query/fragment from identity", () => {
    expect(normalizeManualStatusUrl("https://x.com/F1/status/1234567890123456789?utm_source=human#copy")).toEqual({
      statusId: "1234567890123456789",
      handle: "F1",
      canonicalUrl: "https://x.com/f1/status/1234567890123456789",
      submittedUrl: "https://x.com/F1/status/1234567890123456789?utm_source=human#copy"
    });
    for (const value of [
      "https://x.com/F1",
      "https://x.com/search?q=f1",
      "https://x.com/i/web/status/1234567890123456789",
      "https://x.com/F1/status/1234567890123456789/photo/1",
      "https://www.x.com/F1/status/1234567890123456789",
      "http://x.com/F1/status/1234567890123456789",
      "https://x.com/home/status/1234567890123456789"
    ]) {
      expect(() => normalizeManualStatusUrl(value)).toThrow(TweetInboxError);
    }
  });

  it("applies schema 7 to 8 idempotently and seeds exactly 59 disabled manual sources", () => {
    const { database, repository } = openSchema8();
    try {
      assertXManualInboxSchema(database);
      expect(repository.listSources()).toHaveLength(59);
      expect(repository.listSources().every((source) =>
        source.enabled === false && source.lifecycleStatus === "proposed" &&
        source.collectionMode === "manual_url" && source.sourceKind === "x_manual"
      )).toBe(true);
      applyXManualInboxMigration(database, readXManualInboxMigrationSql());
      expect(repository.listSources()).toHaveLength(59);
      expect(database.prepare("SELECT count(*) AS count FROM x_manual_submission").get()).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("stores a submission locally, deduplicates status IDs, retires through a permit, and proves zero outbound", () => {
    const { database, repository, gateway } = openSchema8(true);
    const controlBefore = database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get();
    try {
      const submitted = repository.submitManualStatusUrl({
        submittedUrl: "https://x.com/F1/status/1234567890123456789?copied=1",
        nowIso: "2026-08-24T01:00:00.000Z"
      });
      expect(submitted).toMatchObject({ duplicate: false, externalCalls: 0, automaticReview: false, automaticPublish: false });
      expect(submitted.submission).toMatchObject({
        state: "submitted",
        canonicalUrl: "https://x.com/f1/status/1234567890123456789",
        sourceId: "x_f1",
        oembedAttemptId: null,
        candidateId: null,
        mediaPublicationEligible: false,
        externalCalls: 0
      });
      const receipt = runManualXInboxCycle({
        repository,
        dropText: "https://x.com/f1/status/987654321012345678\nhttps://x.com/f1\n",
        nowIso: "2026-08-24T01:00:30.000Z"
      });
      expect(receipt).toMatchObject({
        status: "succeeded",
        reasonCode: "OK",
        dropLineCount: 2,
        submittedCount: 1,
        duplicateCount: 0,
        invalidCount: 1,
        externalCalls: 0,
        automaticReview: false,
        automaticPublish: false
      });
      const duplicate = repository.submitManualStatusUrl({
        submittedUrl: "https://twitter.com/f1/status/1234567890123456789",
        nowIso: "2026-08-24T01:01:00.000Z"
      });
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.submission.submissionId).toBe(submitted.submission.submissionId);
      expect(repository.resolveOembed()).toEqual({ capability: "x-oembed", enabled: false, externalCalls: 0, reasonCode: "CAPABILITY_DISABLED" });
      const retired = repository.retireManualStatus({
        submissionId: submitted.submission.submissionId,
        expectedRevision: 0,
        nowIso: "2026-08-24T02:00:00.000Z"
      });
      expect(retired).toMatchObject({ state: "retired", revision: 1, externalCalls: 0 });
      expect(repository.retireManualStatus({
        submissionId: submitted.submission.submissionId,
        expectedRevision: 0,
        nowIso: "2026-08-24T02:00:01.000Z"
      })).toEqual(retired);
      expect(repository.snapshot()).toMatchObject({
        sourceCount: 59,
        submissionCount: 2,
        operationCount: 3,
        externalCalls: 0,
        collectors: 0,
        search: 0,
        rules: 0,
        rsshub: 0,
        cookies: 0,
        automaticBackfill: 0
      });
      expect(() => database.exec(`UPDATE x_manual_submission SET state = 'validated' WHERE submission_id = '${submitted.submission.submissionId}'`)).toThrow();
      const retiredRow = database.prepare("SELECT * FROM x_manual_submission WHERE submission_id=?").get(submitted.submission.submissionId) as Record<string, unknown>;
      expect(retiredRow).toMatchObject({
        state: "retired",
        revision: 1,
        candidate_id: null,
        submitted_url: "https://x.com/F1/status/1234567890123456789?copied=1",
        retention_expires_at: "2027-08-24T01:00:00.000Z",
        created_at: "2026-08-24T01:00:00.000Z",
      });
      const retireOperationId = String(retiredRow.retire_operation_id);
      expect(database.prepare("SELECT event_kind FROM x_manual_audit WHERE operation_id=? ORDER BY audit_seq").all(retireOperationId))
        .toEqual([{ event_kind: "requested" }, { event_kind: "authorized" }, { event_kind: "retired" }, { event_kind: "succeeded" }]);
      expect(database.prepare("SELECT event_type,event_json FROM internal_operation_audit WHERE operation_id=? ORDER BY audit_seq").all(retireOperationId))
        .toEqual([
          expect.objectContaining({ event_type: "operation_requested" }),
          expect.objectContaining({ event_type: "operation_authorized" }),
          expect.objectContaining({ event_type: "write_permit_consumed", event_json: expect.stringContaining('"domainEvent":"retired"') }),
          expect.objectContaining({ event_type: "operation_succeeded", event_json: expect.stringContaining('"domainEvent":"retired"') }),
        ]);
      expect(database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get()).toEqual(controlBefore);
    } finally {
      gateway?.close();
      database.close();
    }
  });

  it("keeps schema-7 worker authority fail-closed for the new additive tables", () => {
    const { database, repository } = openSchema8();
    const authorizer = installSqliteAuthorizer(database, "worker_or_repository");
    try {
      expect(() => repository.submitManualStatusUrl({
        submittedUrl: "https://x.com/f1/status/333333333333333333",
        nowIso: "2026-08-24T03:00:00.000Z"
      })).toThrow("X_MANUAL_AUTHORITY_REQUIRED");
      expect(database.prepare("SELECT count(*) AS count FROM x_manual_operation").get()).toMatchObject({ count: 0 });
    } finally {
      authorizer.uninstall();
      database.close();
    }
  });

  it("rejects a bare repository write before creating any operation", () => {
    const { database, repository } = openSchema8();
    try {
      expect(() => repository.submitManualStatusUrl({
        submittedUrl: "https://x.com/f1/status/444444444444444444",
        nowIso: "2026-08-24T03:30:00.000Z",
      })).toThrow();
      expect(database.prepare("SELECT count(*) AS count FROM internal_operation").get()).toMatchObject({ count: 0 });
      expect(database.prepare("SELECT count(*) AS count FROM x_manual_submission").get()).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("cancels an FK-failed authorized operation and retries the same business idempotency safely", () => {
    const { database, gateway, port } = openSchema8(true);
    const mutation = {
      semanticKind: "x_submit" as const,
      submissionId: "xsub_fkfailure0001",
      expectedRevision: 0,
      submittedUrl: "https://x.com/unknown/status/777777777777777771",
      canonicalUrl: "https://x.com/unknown/status/777777777777777771",
      statusId: "777777777777777771",
      dedupeKey: "a".repeat(64),
      sourceId: "x_missing_source",
      retentionExpiresAt: "2027-08-24T04:00:00.000Z",
      nowIso: "2026-08-24T04:00:00.000Z",
    };
    try {
      expect(() => port!.mutateXManual({ operationId: "xop_fkfailure0001", idempotencyKey: "x-submit-fkfailure0001", mutation })).toThrow();
      expect(database.prepare("SELECT state,reason_code FROM internal_operation WHERE operation_id='xop_fkfailure0001'").get())
        .toMatchObject({ state: "cancelled", reason_code: "X_MANUAL_MUTATION_ROLLED_BACK" });
      expect(database.prepare("SELECT count(*) AS count FROM x_manual_write_permit WHERE operation_id='xop_fkfailure0001'").get()).toMatchObject({ count: 0 });
      expect(database.prepare("SELECT event_kind FROM x_manual_audit WHERE operation_id='xop_fkfailure0001' ORDER BY audit_seq").all())
        .toEqual([{ event_kind: "requested" }, { event_kind: "authorized" }, { event_kind: "blocked" }]);

      expect(port!.mutateXManual({
        operationId: "xop_fkfailure0001",
        idempotencyKey: "x-submit-fkfailure0001",
        mutation: { ...mutation, sourceId: null },
      })).toBe(1);
      expect(database.prepare("SELECT state FROM internal_operation WHERE operation_id='xop_fkfailure0001.retry1'").get()).toMatchObject({ state: "succeeded" });
      expect(database.prepare("SELECT semantic_kind FROM x_manual_operation WHERE operation_id='xop_fkfailure0001.retry1'").get()).toMatchObject({ semantic_kind: "x_submit" });
      expect(port!.mutateXManual({
        operationId: "xop_fkfailure0001",
        idempotencyKey: "x-submit-fkfailure0001",
        mutation: { ...mutation, sourceId: null },
      })).toBe(0);
      expect(database.prepare("SELECT count(*) AS count FROM x_manual_operation WHERE submission_id='xsub_fkfailure0001'").get()).toMatchObject({ count: 2 });
      const requestedAudit = database.prepare("SELECT event_json FROM internal_operation_audit WHERE operation_id='xop_fkfailure0001.retry1' AND event_type='operation_requested'").get() as Record<string, unknown>;
      expect(String(requestedAudit.event_json)).toContain('"operationKind":"x_submit"');
      expect(String(requestedAudit.event_json)).toContain('"authorityCarrier":{"controlAction":"fence_update","operationKind":"phase_control"');
    } finally {
      gateway?.close();
      database.close();
    }
  });

  it("rolls back a real trigger failure after permit issuance and leaves no reusable permit", () => {
    let targetDatabase!: DatabaseSync;
    const opened = openSchema8(true, {
      failureInjector: (point) => {
        if (point !== "after_permit") return;
        targetDatabase.prepare(`INSERT INTO x_manual_submission
          (submission_id,revision,submitted_url,canonical_url,status_id,dedupe_key,state,source_id,oembed_attempt_id,candidate_id,retention_expires_at,external_calls,media_publication_eligible,submit_operation_id,retire_operation_id,created_at,updated_at)
          VALUES('xsub_triggerfail001',0,'https://x.com/f1/status/777777777777777772','https://x.com/f1/status/777777777777777772','777777777777777772',?,'submitted','x_f1',NULL,NULL,?,1,0,'xop_triggerfail001',NULL,?,?)`)
          .run("b".repeat(64), "2027-08-24T04:10:00.000Z", "2026-08-24T04:10:00.000Z", "2026-08-24T04:10:00.000Z");
      },
    });
    targetDatabase = opened.database;
    try {
      expect(() => opened.port!.mutateXManual({
        operationId: "xop_triggerfail001",
        idempotencyKey: "x-submit-triggerfail001",
        mutation: {
          semanticKind: "x_submit", submissionId: "xsub_triggerfail001", expectedRevision: 0,
          submittedUrl: "https://x.com/f1/status/777777777777777772", canonicalUrl: "https://x.com/f1/status/777777777777777772",
          statusId: "777777777777777772", dedupeKey: "b".repeat(64), sourceId: "x_f1",
          retentionExpiresAt: "2027-08-24T04:10:00.000Z", nowIso: "2026-08-24T04:10:00.000Z",
        },
      })).toThrow("X_MANUAL_SUBMISSION_PERMIT_REQUIRED");
      expect(targetDatabase.prepare("SELECT state FROM internal_operation WHERE operation_id='xop_triggerfail001'").get()).toMatchObject({ state: "cancelled" });
      expect(targetDatabase.prepare("SELECT count(*) AS count FROM x_manual_submission WHERE submission_id='xsub_triggerfail001'").get()).toMatchObject({ count: 0 });
      expect(targetDatabase.prepare("SELECT count(*) AS count FROM x_manual_write_permit WHERE operation_id='xop_triggerfail001'").get()).toMatchObject({ count: 0 });
    } finally {
      opened.gateway?.close();
      targetDatabase.close();
    }
  });

  it.each(["after_mutation", "after_permit_consumed"] as const)(
    "atomically cancels a failure at the %s seam",
    (failurePoint) => {
      const suffix = failurePoint === "after_mutation" ? "mutation" : "consumed";
      const statusId = failurePoint === "after_mutation" ? "777777777777777774" : "777777777777777775";
      const opened = openSchema8(true, {
        failureInjector: (point) => {
          if (point === failurePoint) throw new Error(`SIMULATED_${failurePoint.toUpperCase()}_FAILURE`);
        },
      });
      const operationId = `xop_${suffix}fail0001`;
      const submissionId = `xsub_${suffix}fail0001`;
      try {
        expect(() => opened.port!.mutateXManual({
          operationId,
          idempotencyKey: `x-submit-${suffix}fail0001`,
          mutation: {
            semanticKind: "x_submit", submissionId, expectedRevision: 0,
            submittedUrl: `https://x.com/f1/status/${statusId}`, canonicalUrl: `https://x.com/f1/status/${statusId}`,
            statusId, dedupeKey: (failurePoint === "after_mutation" ? "d" : "e").repeat(64), sourceId: "x_f1",
            retentionExpiresAt: "2027-08-24T04:15:00.000Z", nowIso: "2026-08-24T04:15:00.000Z",
          },
        })).toThrow(`SIMULATED_${failurePoint.toUpperCase()}_FAILURE`);
        expect(opened.database.prepare("SELECT state,reason_code FROM internal_operation WHERE operation_id=?").get(operationId))
          .toMatchObject({ state: "cancelled", reason_code: "X_MANUAL_MUTATION_ROLLED_BACK" });
        expect(opened.database.prepare("SELECT count(*) AS count FROM x_manual_submission WHERE submission_id=?").get(submissionId)).toMatchObject({ count: 0 });
        expect(opened.database.prepare("SELECT count(*) AS count FROM x_manual_write_permit WHERE operation_id=?").get(operationId)).toMatchObject({ count: 0 });
      } finally {
        opened.gateway?.close();
        opened.database.close();
      }
    },
  );

  it("recovers an authorize-before-mutation crash seam and rejects permit reuse", () => {
    let crashOnce = true;
    const opened = openSchema8(true, {
      afterAuthorizeInjector: () => {
        if (!crashOnce) return;
        crashOnce = false;
        throw new Error("SIMULATED_PROCESS_CRASH_AFTER_AUTHORIZE");
      },
    });
    const input = {
      operationId: "xop_crashseam0001",
      idempotencyKey: "x-submit-crashseam0001",
      mutation: {
        semanticKind: "x_submit" as const, submissionId: "xsub_crashseam0001", expectedRevision: 0,
        submittedUrl: "https://x.com/f1/status/777777777777777773", canonicalUrl: "https://x.com/f1/status/777777777777777773",
        statusId: "777777777777777773", dedupeKey: "c".repeat(64), sourceId: "x_f1",
        retentionExpiresAt: "2027-08-24T04:20:00.000Z", nowIso: "2026-08-24T04:20:00.000Z",
      },
    };
    try {
      expect(() => opened.port!.mutateXManual(input)).toThrow("SIMULATED_PROCESS_CRASH_AFTER_AUTHORIZE");
      expect(opened.database.prepare("SELECT state FROM internal_operation WHERE operation_id='xop_crashseam0001'").get()).toMatchObject({ state: "authorized" });
      expect(opened.port!.mutateXManual(input)).toBe(1);
      expect(opened.database.prepare("SELECT state,reason_code FROM internal_operation WHERE operation_id='xop_crashseam0001'").get())
        .toMatchObject({ state: "cancelled", reason_code: "X_MANUAL_STALE_OPERATION_RECOVERED" });
      expect(opened.database.prepare("SELECT state FROM internal_operation WHERE operation_id='xop_crashseam0001.retry1'").get()).toMatchObject({ state: "succeeded" });
      const permit = opened.database.prepare("SELECT permit_id,consumed_at FROM x_manual_write_permit WHERE operation_id='xop_crashseam0001.retry1'").get() as Record<string, unknown>;
      expect(permit.consumed_at).not.toBeNull();
      opened.gateway?.close();
      expect(() => opened.database.prepare("UPDATE x_manual_write_permit SET consumed_at=NULL WHERE permit_id=?").run(String(permit.permit_id))).toThrow("X_MANUAL_WRITE_PERMIT_APPEND_ONLY");
    } finally {
      if (opened.gateway !== null) {
        try { opened.gateway.close(); } catch { /* already closed for raw trigger proof */ }
      }
      opened.database.close();
    }
  });
});
