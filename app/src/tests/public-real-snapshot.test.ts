import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AdminDeploymentManifestSchema } from "../server/admin-service/deployment.ts";
import {
  buildProjectionSnapshot,
  buildProjectionTaskEnvelope,
  buildPublicProjectionRecord,
  derivePublicId
} from "../server/review-real/mapping.ts";
import {
  ProjectionReceiver,
  signProjectionTaskEnvelope
} from "../server/review-real/projection.ts";
import {
  createProjectionReceiverServer,
  listenProjectionReceiver
} from "../server/review-real/receiver-http.ts";
import { ProjectionHttpTransport } from "../server/review-real/sender.ts";
import { PublicRealSnapshotReader } from "../server/public/snapshot-adapter.ts";
import { handlePublicFeed, handlePublicStory } from "../server/public/http.ts";
import type { PublicFeedResponseV1, PublicProblemV1, PublicStoryDetailResponseV1 } from "../server/public/types.ts";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function signedGeneration(root: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bundleHash = hash("public-real-bundle");
  const candidateId = "rss-candidate-public-real";
  const record = buildPublicProjectionRecord({
    publicId: derivePublicId(candidateId, bundleHash),
    bundleHash,
    publishedAt: "2026-08-12T03:00:00.000Z",
    publicPayload: {
      candidateId,
      sourceId: "motorsport-f1-news",
      sourceRevision: 1,
      sourcePayloadHash: hash("public-real-source"),
      canonicalUrl: "https://www.motorsport.com/f1/news/public-real/",
      sourceTitle: "Public real source",
      sourceAuthor: "Motorsport.com",
      sourcePublishedAt: "2026-08-12T02:30:00.000Z",
      contentType: "race_news",
      titleZh: "F1 真实快照标题",
      summaryZh: "F1 真实快照中文摘要",
      media: [],
      sourceDisplayName: "Motorsport.com"
    }
  });
  const snapshot = buildProjectionSnapshot({
    snapshotGeneration: 1,
    previousSnapshotManifestHash: null,
    records: [record]
  });
  const task = buildProjectionTaskEnvelope({
    deliveryId: `op-snapshot-${snapshot.snapshotManifestHash}`,
    idempotencyKey: `snapshot-sync:0:${snapshot.snapshotManifestHash}`,
    reconcileKey: `reconcile:snapshot:${snapshot.snapshotManifestHash}`,
    snapshot,
    attempt: 0,
    createdAt: "2026-08-12T03:00:00.000Z",
    deadlineAt: "2026-08-12T03:15:00.000Z"
  });
  return {
    publicKey,
    privateKey,
    record,
    packageValue: signProjectionTaskEnvelope({
      envelopeJson: task.envelopeJson,
      envelopeHash: task.envelopeHash,
      signingKeyId: "projection-key-v1",
      privateKey
    }),
    receiver: new ProjectionReceiver({ root, signingKeyId: "projection-key-v1", publicKey })
  };
}

describe("ADR-M5-REAL-PROJECTION-RUNTIME-002 public B", () => {
  it("closes loopback POST/receipt GET and reads one verified generation without fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "f1-public-real-http-"));
    chmodSync(root, 0o700);
    const fixture = signedGeneration(join(root, "projection"));
    const server = createProjectionReceiverServer({
      receiver: fixture.receiver,
      senderServiceIdentity: "admin-projection-sender"
    });
    try {
      await listenProjectionReceiver(server);
      const transport = new ProjectionHttpTransport({
        endpoint: "http://127.0.0.1:3102/internal/projections",
        serviceIdentity: "admin-projection-sender"
      });
      const posted = await transport.post(fixture.packageValue);
      expect(posted.kind).toBe("response");
      expect(posted.kind === "response" && posted.status).toBe(200);
      const reconciled = await transport.getReceipt(fixture.packageValue.taskEnvelope.deliveryId);
      expect(reconciled).toMatchObject({ kind: "response", status: 200 });

      const keyPath = join(root, "verify.pem");
      writeFileSync(keyPath, fixture.publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
      const reader = new PublicRealSnapshotReader({
        projectionRoot: join(root, "projection"),
        signingKeyId: "projection-key-v1",
        verifyKeyPath: keyPath
      });
      const feedResponse = handlePublicFeed(new Request("http://127.0.0.1:3000/api/public/feed"), reader);
      expect(feedResponse.status).toBe(200);
      const feed = await feedResponse.json() as PublicFeedResponseV1;
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0]).toMatchObject({
        publicId: fixture.record.publicId,
        originalLink: {
          enabled: true,
          url: "https://www.motorsport.com/f1/news/public-real/",
          reason: null
        }
      });
      const detailResponse = handlePublicStory(fixture.record.publicId, reader);
      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json() as PublicStoryDetailResponseV1;
      expect(detail.story.keyPointsZh).toEqual([]);
    } finally {
      if (server.listening) {
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        server.closeAllConnections();
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps no-active empty, corruption 503, symlink fail-closed, and v2 rejects v1 deployment", async () => {
    const root = mkdtempSync(join(tmpdir(), "f1-public-real-boundary-"));
    chmodSync(root, 0o700);
    const fixture = signedGeneration(join(root, "empty"));
    const keyPath = join(root, "verify.pem");
    writeFileSync(keyPath, fixture.publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
    try {
      const emptyReader = new PublicRealSnapshotReader({
        projectionRoot: join(root, "empty"),
        signingKeyId: "projection-key-v1",
        verifyKeyPath: keyPath
      });
      const empty = await handlePublicFeed(new Request("http://127.0.0.1:3000/api/public/feed"), emptyReader).json() as PublicFeedResponseV1;
      expect(empty.items).toEqual([]);

      fixture.receiver.receive(fixture.packageValue);
      const activePath = join(root, "empty", "active.json");
      const activeBytes = readFileSync(activePath);
      writeFileSync(activePath, `${activeBytes.toString("utf8")} `, { mode: 0o600 });
      const corruptResponse = handlePublicFeed(new Request("http://127.0.0.1:3000/api/public/feed"), emptyReader);
      expect(corruptResponse.status).toBe(500);
      expect((await corruptResponse.json() as PublicProblemV1).reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");

      rmSync(activePath, { force: true });
      const outside = join(root, "outside.json");
      writeFileSync(outside, activeBytes, { mode: 0o600 });
      symlinkSync(outside, activePath);
      const symlinkResponse = handlePublicFeed(new Request("http://127.0.0.1:3000/api/public/feed"), emptyReader);
      expect(symlinkResponse.status).toBe(500);
      expect((await symlinkResponse.json() as PublicProblemV1).reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");

      expect(AdminDeploymentManifestSchema.safeParse({ schemaVersion: "admin-service-deployment-v1" }).success).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
