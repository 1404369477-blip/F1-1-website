import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../server/db/profile.ts";
import {
  PUBLIC_BILINGUAL_POINTER_FILE,
  PUBLIC_MIGRATION_0010_SHA256,
  PUBLIC_SCHEMA10_SHA256,
  PublicBilingualSnapshotBodySchema,
  publicBilingualPointerSignaturePayload,
  publicBilingualSnapshotSignaturePayload,
  type PublicBilingualPointerBody,
  type PublicBilingualSnapshotBody
} from "../server/public/bilingual-snapshot.ts";
import { handlePublicFeed, handlePublicStory } from "../server/public/http.ts";
import { PublicRealSnapshotReader } from "../server/public/snapshot-adapter.ts";
import type { PublicBilingualFeedResponseV2, PublicBilingualStoryDetailResponseV2, PublicProblemV1 } from "../server/public/types.ts";

const roots: string[] = [];
const SIGNING_KEY_ID = "public-bilingual-evidence-key-v1";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function localized(language: "zh-CN" | "en", sequence: number, revision: number) {
  const body = language === "zh-CN"
    ? [`第 ${sequence} 条提炼第一段，修订 ${revision}。`, `第 ${sequence} 条提炼第二段。`]
    : [`First extract paragraph for item ${sequence}, revision ${revision}.`, `Second extract paragraph for item ${sequence}.`];
  const value = {
    title: language === "zh-CN" ? `第 ${sequence} 条中文标题 R${revision}` : `English title ${sequence} R${revision}`,
    summary: language === "zh-CN" ? `第 ${sequence} 条中文详细摘要。` : `Detailed English summary for item ${sequence}.`,
    lead: language === "zh-CN" ? `第 ${sequence} 条中文导语。` : `English lead for item ${sequence}.`,
    body: body.join("\n"),
    keyPoints: language === "zh-CN" ? [`要点 ${sequence}A`, `要点 ${sequence}B`] : [`Point ${sequence}A`, `Point ${sequence}B`]
  };
  return { ...value, contentHash: sha256(canonicalJson({ ...value, language, body })) };
}

function record(sequence: number, revision = 1) {
  const payload = {
    schemaVersion: "public-read-bilingual-v2" as const,
    publicId: `public-bilingual-${sequence}`,
    category: sequence % 2 === 0 ? "driver_social" : "race_news",
    defaultLanguage: "zh-CN" as const,
    availableLanguages: ["zh-CN", "en"] as ["zh-CN", "en"],
    localized: { "zh-CN": localized("zh-CN", sequence, revision), en: localized("en", sequence, revision) },
    source: {
      name: `Verified source ${sequence}`,
      author: sequence === 4 ? null : `Author ${sequence}`,
      publishedAt: `2026-08-2${sequence}T0${sequence}:00:00.000Z`,
      canonicalUrl: `https://example.com/f1/source-${sequence}`
    },
    publishedAt: `2026-08-2${sequence}T0${sequence}:00:00.000Z`,
    updatedAt: `2026-08-2${sequence}T0${sequence}:00:0${revision}.000Z`,
    media: sequence === 2 ? [] : [{
      kind: "image" as const,
      url: `https://media.example.com/f1/${sequence}.jpg`,
      alt: `Licensed image ${sequence}`,
      width: 1600,
      height: 900,
      rightsPolicyId: `rights-policy-${sequence}`,
      mediaHash: sha256(`media-${sequence}`)
    }]
  };
  return {
    projectionId: `projection-${sequence}-r${revision}`,
    publicationId: `publication-${sequence}`,
    publicationRevision: revision,
    bundleId: `bundle-${sequence}-r${revision}`,
    bundleHash: sha256(`bundle-${sequence}-r${revision}`),
    pointerVersion: revision,
    projectionHash: sha256(canonicalJson(payload)),
    payload
  };
}

function signEnvelope(body: PublicBilingualSnapshotBody, privateKey: KeyObject) {
  const bodyHash = sha256(canonicalJson(body));
  return {
    schemaVersion: "public-bilingual-snapshot-signed-v1" as const,
    body,
    bodyHash,
    signingKeyId: SIGNING_KEY_ID,
    signature: sign(null, publicBilingualSnapshotSignaturePayload(bodyHash), privateKey).toString("base64url")
  };
}

function writeGeneration(root: string, body: PublicBilingualSnapshotBody, privateKey: KeyObject) {
  const parsedBody = PublicBilingualSnapshotBodySchema.safeParse(body);
  if (!parsedBody.success) throw new Error(parsedBody.error.message);
  const envelope = signEnvelope(body, privateKey);
  const reference = {
    file: `bilingual-generation-${envelope.bodyHash}.json`,
    generationId: body.generationId,
    generationHash: envelope.bodyHash
  };
  writeFileSync(join(root, reference.file), canonicalJson(envelope), { mode: 0o600 });
  return reference;
}

function writePointer(root: string, active: ReturnType<typeof writeGeneration>, lkg: ReturnType<typeof writeGeneration> | null, privateKey: KeyObject): void {
  const body: PublicBilingualPointerBody = {
    schemaVersion: "public-bilingual-active-pointer-v1",
    schema10Sha256: PUBLIC_SCHEMA10_SHA256,
    migration0010Sha256: PUBLIC_MIGRATION_0010_SHA256,
    active,
    lkg,
    updatedAt: "2026-08-25T01:30:00.000Z"
  };
  const bodyHash = sha256(canonicalJson(body));
  const envelope = {
    schemaVersion: "public-bilingual-active-pointer-signed-v1" as const,
    body,
    bodyHash,
    signingKeyId: SIGNING_KEY_ID,
    signature: sign(null, publicBilingualPointerSignaturePayload(bodyHash), privateKey).toString("base64url")
  };
  writeFileSync(join(root, PUBLIC_BILINGUAL_POINTER_FILE), canonicalJson(envelope), { mode: 0o600 });
}

function snapshotBody(generationId: string, records = [record(4), record(3), record(2), record(1)], withdrawals: PublicBilingualSnapshotBody["withdrawals"] = []): PublicBilingualSnapshotBody {
  return {
    schemaVersion: "public-bilingual-snapshot-v1",
    schema10Sha256: PUBLIC_SCHEMA10_SHA256,
    migration0010Sha256: PUBLIC_MIGRATION_0010_SHA256,
    generationId,
    generatedAt: "2026-08-25T01:25:00.000Z",
    records,
    withdrawals
  };
}

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-public-bilingual-v2-"));
  roots.push(root);
  chmodSync(root, 0o700);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const verifyKeyPath = join(root, "verify.pem");
  writeFileSync(verifyKeyPath, publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
  const createReader = () => new PublicRealSnapshotReader({ projectionRoot: root, signingKeyId: SIGNING_KEY_ID, verifyKeyPath });
  return { root, privateKey, createReader };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Public signed bilingual schema10 snapshot", () => {
  it("serves the latest-three backfill plus new bilingual content from one immutable generation", async () => {
    const value = fixture();
    const active = writeGeneration(value.root, snapshotBody("generation-latest3-plus-new"), value.privateKey);
    writePointer(value.root, active, null, value.privateKey);
    const response = handlePublicFeed(new Request("http://127.0.0.1/api/public/feed?v=2&limit=4"), value.createReader());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=300");
    const feed = await response.json() as PublicBilingualFeedResponseV2;
    expect(feed.schemaVersion).toBe("public-read-bilingual-v2");
    expect(feed.items).toHaveLength(4);
    expect(feed.items.every((item) => item.defaultLanguage === "zh-CN" && item.availableLanguages.join(",") === "zh-CN,en")).toBe(true);
    expect(feed.items.map((item) => item.source.canonicalUrl)).toHaveLength(4);
    expect(canonicalJson(feed)).not.toMatch(/sourceExcerpt|sourceBody|fullBody|prompt|modelResponse|admin|secret/i);
    const detailResponse = handlePublicStory("public-bilingual-4", value.createReader(), new Request("http://127.0.0.1/api/public/stories/public-bilingual-4?v=2"));
    const detail = await detailResponse.json() as PublicBilingualStoryDetailResponseV2;
    expect(detail.generationHash).toBe(feed.generationHash);
    expect(detail.story.localized.en.title).toBe("English title 4 R1");
    expect(canonicalJson(detail)).not.toMatch(/sourceExcerpt|sourceBody|fullBody|prompt|modelResponse|admin|secret/i);
  });

  it("keeps correction active while preserving the prior generation as LKG", async () => {
    const value = fixture();
    const lkg = writeGeneration(value.root, snapshotBody("generation-before-correction"), value.privateKey);
    const corrected = [record(4, 2), record(3), record(2), record(1)];
    const active = writeGeneration(value.root, snapshotBody("generation-after-correction", corrected), value.privateKey);
    writePointer(value.root, active, lkg, value.privateKey);
    const request = new Request("http://127.0.0.1/api/public/feed?v=2&limit=4");
    const correctedFeed = await handlePublicFeed(request, value.createReader()).json() as PublicBilingualFeedResponseV2;
    expect(correctedFeed.items[0]?.localized["zh-CN"].title).toContain("R2");
    writeFileSync(join(value.root, active.file), `${readFileSync(join(value.root, active.file), "utf8")} `, { mode: 0o600 });
    const lkgFeed = await handlePublicFeed(request, value.createReader()).json() as PublicBilingualFeedResponseV2;
    expect(lkgFeed.generationId).toBe("generation-before-correction");
    expect(lkgFeed.items[0]?.localized["zh-CN"].title).toContain("R1");
  });

  it("withdraws without replacement and rejects old pins, missing language, and raw source fields", async () => {
    const value = fixture();
    const active = writeGeneration(value.root, snapshotBody("generation-withdrawal", [record(4), record(3), record(2)], [{
      publicId: "public-bilingual-1",
      publicationId: "publication-1",
      publicationRevision: 2,
      supersededProjectionHash: record(1).projectionHash,
      withdrawnAt: "2026-08-25T01:20:00.000Z"
    }]), value.privateKey);
    writePointer(value.root, active, null, value.privateKey);
    expect(handlePublicStory("public-bilingual-1", value.createReader(), new Request("http://127.0.0.1/api/public/stories/public-bilingual-1?v=2")).status).toBe(404);

    const attacks: Array<(body: Record<string, unknown>) => void> = [
      (body) => { body.schema10Sha256 = "cbef4631e4ad3503fb7086c24d2356899e7aaaa802e49c1d58d86bd0d06ed24b"; },
      (body) => { body.migration0010Sha256 = "628e155b5b91e3ad76f67a28480a091374ec9f8d3d1d38a7b686c56c15c35693"; },
      (body) => { delete (((body.records as Array<Record<string, unknown>>)[0]?.payload as Record<string, unknown>).localized as Record<string, unknown>).en; },
      (body) => { ((body.records as Array<Record<string, unknown>>)[0]?.payload as Record<string, unknown>).sourceExcerpt = "forbidden raw source text"; }
    ];
    for (const [index, attack] of attacks.entries()) {
      const unsafeBody = structuredClone(snapshotBody(`generation-unsafe-${index}`)) as unknown as Record<string, unknown>;
      attack(unsafeBody);
      const unsafeEnvelope = signEnvelope(unsafeBody as PublicBilingualSnapshotBody, value.privateKey);
      const unsafeReference = { file: `bilingual-generation-${unsafeEnvelope.bodyHash}.json`, generationId: `generation-unsafe-${index}`, generationHash: unsafeEnvelope.bodyHash };
      writeFileSync(join(value.root, unsafeReference.file), canonicalJson(unsafeEnvelope), { mode: 0o600 });
      writePointer(value.root, unsafeReference, null, value.privateKey);
      const rejected = handlePublicFeed(new Request("http://127.0.0.1/api/public/feed?v=2"), value.createReader());
      expect(rejected.status, `attack ${index}`).toBe(503);
      expect((await rejected.json() as PublicProblemV1).reasonCode).toBe("PUBLIC_READ_INTEGRITY_FAILED");
    }
  });

  it("uses an intact LKG when the active generation signature is invalid", async () => {
    const value = fixture();
    const lkg = writeGeneration(value.root, snapshotBody("generation-before-invalid-active"), value.privateKey);
    const active = writeGeneration(value.root, snapshotBody("generation-invalid-active"), value.privateKey);
    writePointer(value.root, active, lkg, value.privateKey);
    const envelope = JSON.parse(readFileSync(join(value.root, active.file), "utf8")) as { signature: string };
    envelope.signature = `0${envelope.signature.slice(1)}`;
    writeFileSync(join(value.root, active.file), canonicalJson(envelope), { mode: 0o600 });

    const response = handlePublicFeed(new Request("http://127.0.0.1/api/public/feed?v=2&limit=4"), value.createReader());
    expect(response.status).toBe(200);
    const feed = await response.json() as PublicBilingualFeedResponseV2;
    expect(feed.generationId).toBe(lkg.generationId);
    expect(feed.generationHash).toBe(lkg.generationHash);
  });

  it("rejects stale cursors, extra detail query fields, and exposes no write method", async () => {
    const value = fixture();
    const active = writeGeneration(value.root, snapshotBody("generation-query-boundary"), value.privateKey);
    writePointer(value.root, active, null, value.privateKey);
    const reader = value.createReader();
    const first = await handlePublicFeed(new Request("http://127.0.0.1/api/public/feed?v=2&limit=1"), reader).json() as PublicBilingualFeedResponseV2;
    expect(first.page.nextCursor).not.toBeNull();
    const badCursor = `${first.page.nextCursor ?? ""}x`;
    expect(handlePublicFeed(new Request(`http://127.0.0.1/api/public/feed?v=2&cursor=${badCursor}`), reader).status).toBe(400);
    expect(handlePublicStory("public-bilingual-4", reader, new Request("http://127.0.0.1/api/public/stories/public-bilingual-4?v=2&admin=1")).status).toBe(400);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(reader)).filter((name) => /write|publish|correct|withdraw|admin|secret/i.test(name))).toEqual([]);
  });
});
