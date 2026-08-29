import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  ReviewAdminBackend,
  prepareApproveMutation,
  preparePublishMutation,
  prepareRejectMutation,
  prepareRevisionMutation
} from "../server/review-real/backend.ts";
import { ReviewRealError } from "../server/review-real/error.ts";
import { applyReviewRealAdminMigration } from "../server/review-real/migration.ts";
import {
  ProjectionReceiver,
  PublicSnapshotRepository,
  signProjectionTaskEnvelope
} from "../server/review-real/projection.ts";
import { ReviewRealRepository } from "../server/review-real/repository.ts";
import { ReviewAdminRoutes } from "../server/review-real/routes.ts";
import { ReviewListSchema, RevisionSuccessSchema } from "../server/review-real/schema.ts";
import { ReviewAdminSecurity } from "../server/review-real/security.ts";
import type { RawAdminContext } from "../server/source-management/security.ts";

const migration0001 = readFileSync(new URL("../../migrations/rss-real/0001_rss_real.sql", import.meta.url), "utf8");
const migration0002 = readFileSync(new URL("../../migrations/rss-real/0002_admin_review_publish.sql", import.meta.url), "utf8");
const ADMIN_ORIGIN = "https://admin.f1.test";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>;
  return Number(row.count);
}

function seedCandidate(database: DatabaseSync, suffix: string, publishedAt: string): string {
  const candidateId = `rss-candidate-backend-${suffix}`;
  database.prepare(
    "INSERT INTO pending_review_candidate (candidate_id, source_id, external_id, dedupe_key, canonical_url, title, excerpt, author, published_at, source_payload_hash, source_revision, first_seen_at, last_seen_at) VALUES (?, 'motorsport-f1-news', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)"
  ).run(
    candidateId,
    `backend-${suffix}`,
    sha256(`dedupe-${suffix}`),
    `https://www.motorsport.com/f1/news/backend-${suffix}/`,
    `Source title ${suffix}`,
    `Source excerpt ${suffix}`,
    publishedAt,
    sha256(`source-payload-${suffix}`),
    publishedAt,
    publishedAt
  );
  return candidateId;
}

function rawContext(input: Readonly<{
  method: "GET" | "POST";
  path: string;
  cookie: string;
  origin?: boolean;
  csrf?: string;
  fresh?: string;
}>): RawAdminContext {
  const rawHeaders = new Map<string, readonly string[]>();
  rawHeaders.set("cookie", [input.cookie]);
  if (input.origin) {
    rawHeaders.set("origin", [ADMIN_ORIGIN]);
    rawHeaders.set("sec-fetch-site", ["same-origin"]);
  }
  if (input.csrf !== undefined) rawHeaders.set("x-csrf-token", [input.csrf]);
  if (input.fresh !== undefined) rawHeaders.set("x-f1-fresh-reauth", [input.fresh]);
  return Object.freeze({
    method: input.method,
    path: input.path,
    authority: "admin.f1.test",
    origin: input.origin ? ADMIN_ORIGIN : null,
    peer: "loopback" as const,
    rawHeaders,
    noEgressReady: true as const
  });
}

function expectReason(action: () => unknown, reasonCode: string): void {
  try {
    action();
    throw new Error(`expected ${reasonCode}`);
  } catch (error) {
    if (!(error instanceof ReviewRealError)) throw error;
    expect(error.reasonCode).toBe(reasonCode);
  }
}

describe("DEV-REAL-REVIEW-BE-01", () => {
  it("keeps approval private until a fresh-authenticated manual publish activates one signed full snapshot", () => {
    const database = new DatabaseSync(":memory:");
    const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "f1-review-backend-"));
    chmodSync(temporaryRoot, 0o700);
    try {
      const schemaProbePath = join(temporaryRoot, "schema-fingerprint.sqlite");
      const freshSchemaDatabase = new DatabaseSync(schemaProbePath);
      try {
        freshSchemaDatabase.exec(migration0001);
        applyReviewRealAdminMigration(freshSchemaDatabase, migration0002);
      } finally {
        freshSchemaDatabase.close();
      }
      const legitimateV2Database = new DatabaseSync(schemaProbePath);
      try {
        applyReviewRealAdminMigration(legitimateV2Database, migration0002);
        legitimateV2Database.exec("DROP TRIGGER publication_no_delete");
      } finally {
        legitimateV2Database.close();
      }
      const damagedV2Database = new DatabaseSync(schemaProbePath);
      try {
        let repositoryConstructed = false;
        expectReason(() => {
          applyReviewRealAdminMigration(damagedV2Database, migration0002);
          repositoryConstructed = true;
          void new ReviewRealRepository(damagedV2Database);
        }, "ADMIN_INTERNAL_FAILURE");
        expect(repositoryConstructed).toBe(false);
      } finally {
        damagedV2Database.close();
      }

      database.exec(migration0001);
      applyReviewRealAdminMigration(database, migration0002);
      const candidateA = seedCandidate(database, "a", "2026-08-12T01:00:00.000Z");
      const candidateB = seedCandidate(database, "b", "2026-08-12T00:00:00.000Z");

      let repositoryNow = Date.parse("2026-08-12T02:00:00.000Z");
      const repository = new ReviewRealRepository(database, () => {
        const value = new Date(repositoryNow);
        repositoryNow += 1_000;
        return value;
      });
      let securityNow = Date.parse("2026-08-12T02:00:00.000Z");
      let randomCounter = 0;
      const security = new ReviewAdminSecurity({
        canonicalOrigin: ADMIN_ORIGIN,
        sessionHashKey: Buffer.alloc(32, 0x5a),
        readRecoveryFence: () => ({
          clockTrusted: true,
          writerReady: true,
          lastSuccessfulRecoveryPointAt: securityNow - 60_000
        }),
        now: () => securityNow,
        randomBytes: (size) => {
          randomCounter += 1;
          return Buffer.alloc(size, randomCounter);
        }
      });
      const backend = new ReviewAdminBackend(repository, security);
      const routes = new ReviewAdminRoutes(backend);
      const initialSession = security.acceptVerifiedSession({
        operatorRef: "operator-primary",
        deviceRef: "device-mac",
        tailnetUserRef: "tailnet-owner"
      });
      let cookie = initialSession.cookieHeader;

      const initialListResult = routes.handle(rawContext({
        method: "GET",
        path: "/api/admin/reviews",
        cookie
      }));
      expect(initialListResult.status).toBe(200);
      const initialList = ReviewListSchema.parse(initialListResult.body);
      expect(initialList.items.map((item) => item.candidateId)).toEqual([candidateA, candidateB]);

      const revisionRequest = {
        schemaVersion: "admin-review-v0.2",
        operationId: "operation-revision-a",
        expected: {
          candidateId: candidateA,
          sourceRevision: 1,
          sourceVersionTag: sha256("source-payload-a").slice(0, 12),
          latestBundleId: null,
          latestBundleVersionTag: null
        },
        editable: {
          titleZh: "勒克莱尔谈新赛季赛车平衡",
          summaryZh: "Motorsport.com 报道了车手对赛车平衡与后续调校方向的最新看法。",
          notes: "private-review-note-must-never-leak"
        }
      } as const;
      const preparedRevision = prepareRevisionMutation(revisionRequest);
      const revisionCsrfResult = routes.handle(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        {
          schemaVersion: "admin-review-csrf-v1",
          operationType: "revision",
          mutation: revisionRequest
        }
      );
      expect(revisionCsrfResult.status).toBe(200);
      const revisionCsrf = String((revisionCsrfResult.body as Record<string, unknown>).csrfToken);
      const revisionResult = routes.handle(rawContext({
        method: "POST",
        path: preparedRevision.binding.path,
        cookie,
        origin: true,
        csrf: revisionCsrf
      }), revisionRequest);
      expect(revisionResult.status).toBe(200);
      const revision = RevisionSuccessSchema.parse(revisionResult.body);
      expect(revision.bundle.revision).toBe(1);
      expect(revision.candidate.reviewState).toBe("pending_review");

      const replayCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedRevision
      );
      expect(backend.revision(rawContext({
        method: "POST",
        path: preparedRevision.binding.path,
        cookie,
        origin: true,
        csrf: replayCsrf
      }), revisionRequest)).toEqual(revision);
      expect(backend.operation(rawContext({
        method: "GET",
        path: "/api/admin/operations/operation-revision-a",
        cookie
      }), "operation-revision-a")).toEqual(revision.operation);
      expect(count(database, "review_bundle")).toBe(1);
      expect(count(database, "admin_operation")).toBe(1);
      expect(count(database, "audit_event")).toBe(1);

      const changedReplay = {
        ...revisionRequest,
        editable: { ...revisionRequest.editable, titleZh: "同 operationId 的不同正文" }
      };
      const preparedChangedReplay = prepareRevisionMutation(changedReplay);
      const changedReplayCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedChangedReplay
      );
      expectReason(() => backend.revision(rawContext({
        method: "POST",
        path: preparedChangedReplay.binding.path,
        cookie,
        origin: true,
        csrf: changedReplayCsrf
      }), changedReplay), "REVIEW_DECISION_CONFLICT");
      expect(count(database, "review_bundle")).toBe(1);

      const approveRequest = {
        schemaVersion: "admin-review-v0.2",
        operationId: "operation-approve-a",
        expected: {
          candidateId: candidateA,
          sourceRevision: 1,
          bundleId: revision.bundle.id,
          bundleVersionTag: revision.bundle.versionTag
        }
      } as const;
      const preparedApprove = prepareApproveMutation(approveRequest);
      const approveCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedApprove
      );
      const approval = backend.approve(rawContext({
        method: "POST",
        path: preparedApprove.binding.path,
        cookie,
        origin: true,
        csrf: approveCsrf
      }), approveRequest);
      expect(approval.publication.status).toBe("queued");
      expect(approval.candidate.reviewState).toBe("approved_waiting_publish");
      expect(count(database, "review_decision")).toBe(1);
      expect(count(database, "publication")).toBe(1);
      expect(count(database, "published_projection")).toBe(0);
      expect(count(database, "projection_outbox")).toBe(0);

      const publishRequest = {
        schemaVersion: "admin-review-v0.2",
        operationId: "operation-publish-a",
        expected: {
          publicId: approval.publication.publicId,
          publishGeneration: 1,
          publicationStatus: "queued",
          approvedBundleVersionTag: revision.bundle.versionTag
        }
      } as const;
      const preparedPublish = preparePublishMutation(publishRequest);
      const fresh = security.acceptVerifiedFreshReauth(
        rawContext({
          method: "POST",
          path: "/api/admin/session/fresh-reauth",
          cookie,
          origin: true
        }),
        {
          operationId: publishRequest.operationId,
          action: "publish",
          resourceHash: preparedPublish.binding.resourceHash ?? ""
        }
      );
      cookie = fresh.cookieHeader;
      const publishCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedPublish
      );
      const published = backend.publish(rawContext({
        method: "POST",
        path: preparedPublish.binding.path,
        cookie,
        origin: true,
        csrf: publishCsrf,
        fresh: fresh.freshReceipt
      }), publishRequest);
      expect(published.status).toBe("delivery_pending");
      expect(published.publicPath).toBeNull();
      expect(count(database, "published_projection")).toBe(1);
      expect(count(database, "projection_outbox")).toBe(1);

      const task = repository.deliveryTask(published.delivery.id);
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const signedPackage = signProjectionTaskEnvelope({
        envelopeJson: task.envelopeJson,
        envelopeHash: task.envelopeHash,
        signingKeyId: "projection-key-primary",
        privateKey
      });
      const receiver = new ProjectionReceiver({
        root: join(temporaryRoot, "public-snapshots"),
        signingKeyId: "projection-key-primary",
        publicKey,
        bootstrapPin: {
          snapshotGeneration: task.envelope.snapshot.snapshotGeneration,
          snapshotManifestHash: task.envelope.snapshot.snapshotManifestHash
        },
        now: () => Date.parse("2026-08-12T02:10:00.000Z")
      });
      const publicReader = new PublicSnapshotRepository(receiver);
      expect(publicReader.list().items).toEqual([]);
      const activeReceipt = receiver.receive(signedPackage);
      expect(activeReceipt.status).toBe("active");
      expect(receiver.receive(signedPackage)).toEqual(activeReceipt);
      const publicList = publicReader.list();
      expect(publicList.items).toHaveLength(1);
      expect(publicList.items[0].publicId).toBe(approval.publication.publicId);
      const publicDetail = publicReader.detail(approval.publication.publicId);
      expect(publicDetail.story.titleZh).toBe(revisionRequest.editable.titleZh);
      expect(JSON.stringify({ publicList, publicDetail })).not.toContain(revisionRequest.editable.notes);
      expect(JSON.stringify({ publicList, publicDetail })).not.toContain("editorNotes");

      const revisionBRequest = {
        schemaVersion: "admin-review-v0.2",
        operationId: "operation-revision-b",
        expected: {
          candidateId: candidateB,
          sourceRevision: 1,
          sourceVersionTag: sha256("source-payload-b").slice(0, 12),
          latestBundleId: null,
          latestBundleVersionTag: null
        },
        editable: {
          titleZh: "被人工拒绝的候选",
          summaryZh: "这条候选用于证明拒绝不会创建 Publication 或公开投影。",
          notes: "private-reject-note"
        }
      } as const;
      const preparedRevisionB = prepareRevisionMutation(revisionBRequest);
      const revisionBCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedRevisionB
      );
      const revisionB = backend.revision(rawContext({
        method: "POST",
        path: preparedRevisionB.binding.path,
        cookie,
        origin: true,
        csrf: revisionBCsrf
      }), revisionBRequest);
      const rejectRequest = {
        schemaVersion: "admin-review-v0.2",
        operationId: "operation-reject-b",
        expected: {
          candidateId: candidateB,
          sourceRevision: 1,
          bundleId: revisionB.bundle.id,
          bundleVersionTag: revisionB.bundle.versionTag
        },
        reason: "信息价值不足，暂不进入公开站。"
      } as const;
      const preparedReject = prepareRejectMutation(rejectRequest);
      const rejectCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedReject
      );
      const rejection = backend.reject(rawContext({
        method: "POST",
        path: preparedReject.binding.path,
        cookie,
        origin: true,
        csrf: rejectCsrf
      }), rejectRequest);
      expect(rejection.candidate.reviewState).toBe("rejected");
      expect(count(database, "publication")).toBe(1);
      expect(count(database, "published_projection")).toBe(1);
      expect(count(database, "projection_outbox")).toBe(1);
      expect(count(database, "admin_operation")).toBe(5);
      expect(count(database, "audit_event")).toBe(5);

      const staleRequest = {
        ...revisionBRequest,
        operationId: "operation-stale-b",
        expected: { ...revisionBRequest.expected, sourceRevision: 2 }
      };
      const preparedStale = prepareRevisionMutation(staleRequest);
      const staleCsrf = backend.issueCsrf(
        rawContext({ method: "POST", path: "/api/admin/csrf", cookie, origin: true }),
        preparedStale
      );
      expectReason(() => backend.revision(rawContext({
        method: "POST",
        path: preparedStale.binding.path,
        cookie,
        origin: true,
        csrf: staleCsrf
      }), staleRequest), "REVIEW_SOURCE_STALE");
      expect(count(database, "admin_operation")).toBe(5);
      expect(count(database, "audit_event")).toBe(5);

      securityNow += 1_000;
      expectReason(() => backend.detail(rawContext({
        method: "GET",
        path: `/api/admin/reviews/${candidateA}`,
        cookie: initialSession.cookieHeader
      }), candidateA), "ADMIN_SESSION_REQUIRED");
      expect(database.prepare("PRAGMA foreign_key_check").get()).toBeUndefined();
      expect(database.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    } finally {
      database.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
