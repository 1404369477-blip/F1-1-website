import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "../src/server/db/profile.ts";
import {
  PUBLIC_BILINGUAL_POINTER_FILE,
  PUBLIC_MIGRATION_0010_SHA256,
  PUBLIC_SCHEMA10_SHA256,
  PublicBilingualSnapshotBodySchema,
  publicBilingualPointerSignaturePayload,
  publicBilingualSnapshotSignaturePayload
} from "../src/server/public/bilingual-snapshot.ts";

const output = process.argv[2];
if (!output || !resolve(output).startsWith("/tmp/")) throw new Error("one /tmp output directory is required");
const root = resolve(output);
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const localize = (language: "zh-CN" | "en", index: number) => {
  const body = language === "zh-CN" ? [`第 ${index} 条详细提炼。`] : [`Detailed extract ${index}.`];
  const value = {
    title: language === "zh-CN" ? `第 ${index} 条中文标题` : `English title ${index}`,
    summary: language === "zh-CN" ? `第 ${index} 条中文摘要。` : `English summary ${index}.`,
    lead: language === "zh-CN" ? `第 ${index} 条中文导语。` : `English lead ${index}.`,
    body: body.join("\n"),
    keyPoints: language === "zh-CN" ? [`要点 ${index}`] : [`Point ${index}`]
  };
  return { ...value, contentHash: hash(canonicalJson({ ...value, language, body })) };
};

const records = Array.from({ length: 4 }, (_, offset) => {
  const index = 4 - offset;
  const payload = {
    schemaVersion: "public-read-bilingual-v2" as const,
    publicId: `public-bilingual-${index}`,
    category: index % 2 === 0 ? "driver_social" : "race_news",
    defaultLanguage: "zh-CN" as const,
    availableLanguages: ["zh-CN", "en"] as ["zh-CN", "en"],
    localized: { "zh-CN": localize("zh-CN", index), en: localize("en", index) },
    source: {
      name: `Verified source ${index}`,
      author: null,
      publishedAt: `2026-08-2${index}T0${index}:00:00.000Z`,
      canonicalUrl: `https://example.com/f1/source-${index}`
    },
    publishedAt: `2026-08-2${index}T0${index}:00:00.000Z`,
    updatedAt: `2026-08-2${index}T0${index}:00:01.000Z`,
    media: []
  };
  return {
    projectionId: `projection-${index}`,
    publicationId: `publication-${index}`,
    publicationRevision: 1,
    bundleId: `bundle-${index}`,
    bundleHash: hash(`bundle-${index}`),
    pointerVersion: 1,
    projectionHash: hash(canonicalJson(payload)),
    payload
  };
});

const body = PublicBilingualSnapshotBodySchema.parse({
  schemaVersion: "public-bilingual-snapshot-v1",
  schema10Sha256: PUBLIC_SCHEMA10_SHA256,
  migration0010Sha256: PUBLIC_MIGRATION_0010_SHA256,
  generationId: "generation-production-shaped-smoke",
  generatedAt: "2026-08-25T02:30:00.000Z",
  records,
  withdrawals: []
});
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const snapshotBodyHash = hash(canonicalJson(body));
const snapshot = {
  schemaVersion: "public-bilingual-snapshot-signed-v1" as const,
  body,
  bodyHash: snapshotBodyHash,
  signingKeyId: "public-bilingual-smoke-key-v1",
  signature: sign(null, publicBilingualSnapshotSignaturePayload(snapshotBodyHash), privateKey).toString("base64url")
};
const snapshotFile = `bilingual-generation-${snapshotBodyHash}.json`;
writeFileSync(resolve(root, snapshotFile), canonicalJson(snapshot), { mode: 0o600 });

const pointerBody = {
  schemaVersion: "public-bilingual-active-pointer-v1" as const,
  schema10Sha256: PUBLIC_SCHEMA10_SHA256,
  migration0010Sha256: PUBLIC_MIGRATION_0010_SHA256,
  active: { file: snapshotFile, generationId: body.generationId, generationHash: snapshotBodyHash },
  lkg: null,
  updatedAt: "2026-08-25T02:31:00.000Z"
};
const pointerBodyHash = hash(canonicalJson(pointerBody));
const pointer = {
  schemaVersion: "public-bilingual-active-pointer-signed-v1" as const,
  body: pointerBody,
  bodyHash: pointerBodyHash,
  signingKeyId: snapshot.signingKeyId,
  signature: sign(null, publicBilingualPointerSignaturePayload(pointerBodyHash), privateKey).toString("base64url")
};
writeFileSync(resolve(root, PUBLIC_BILINGUAL_POINTER_FILE), canonicalJson(pointer), { mode: 0o600 });
const verifyKeyPath = resolve(root, "verify.pem");
writeFileSync(verifyKeyPath, publicKey.export({ format: "pem", type: "spki" }), { mode: 0o600 });
process.stdout.write(`${canonicalJson({ root, verifyKeyPath, signingKeyId: snapshot.signingKeyId, snapshotFile, snapshotBodyHash })}\n`);
