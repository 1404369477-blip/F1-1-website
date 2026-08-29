import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../db/profile.ts";
import {
  PUBLIC_BILINGUAL_POINTER_FILE,
  PUBLIC_MIGRATION_0010_SHA256,
  PUBLIC_SCHEMA10_SHA256,
  PublicBilingualPayloadSchema,
  SignedPublicBilingualPointerSchema,
  publicBilingualPointerSignaturePayload,
  publicBilingualSnapshotSignaturePayload,
} from "../public/bilingual-snapshot.ts";
import { AdminBilingualProjectionWriter, type BilingualProjectionArtifact, type BilingualPublicationAuthorization, type BilingualPublicationReceipt } from "./bilingual-projection-writer.ts";

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function atomicWrite(path: string, value: string, replace = false): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === value) return;
    if (!replace) throw new Error("BILINGUAL_EXPORT_IDEMPOTENCY_CONFLICT");
  }
  const temporary = `${path}.tmp-${process.pid}-${sha256(value).slice(0, 12)}`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, value, "utf8"); fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* absent */ }
    throw error;
  }
}

export class AdminBilingualProjectionExporter {
  private readonly publicKey: KeyObject;
  public constructor(private readonly database: DatabaseSync, private readonly root: string, private readonly signingKeyId: string, private readonly privateKey: KeyObject, private readonly fail?: (stage: "after_generation" | "before_pointer") => void) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.publicKey = createPublicKey(privateKey);
  }

  public artifact(payload: unknown, input: Readonly<{ releaseSha256: string; manifestSha256: string; generationId: string; generation: number }>): BilingualProjectionArtifact {
    const parsed = PublicBilingualPayloadSchema.parse(payload);
    const payloadJson = canonicalJson(parsed); const payloadHash = sha256(payloadJson);
    const signature = sign(null, Buffer.from(`f1plus1-public-bilingual-projection-v1\n${payloadHash}`, "utf8"), this.privateKey).toString("base64url");
    return Object.freeze({ payloadJson, payloadHash, signature, ...input });
  }

  public export(receipt: BilingualPublicationReceipt): Readonly<{ generationHash: string; pointerHash: string }> {
    const projection = this.database.prepare(`SELECT projection.*,publication.bundle_id,publication.bundle_hash,publication.revision AS publication_revision,publication.status AS publication_status
      FROM bilingual_public_projection_v1 projection JOIN bilingual_publication_v1 publication ON publication.publication_id=projection.publication_id WHERE projection.projection_id=?`).get(receipt.projectionId) as Record<string, unknown> | undefined;
    if (!projection || projection.payload_hash !== receipt.projectionHash) throw new Error("BILINGUAL_EXPORT_DB_DRIFT");
    const payload = PublicBilingualPayloadSchema.parse(JSON.parse(String(projection.payload_json)));
    const pointer = this.database.prepare("SELECT pointer_version FROM bilingual_public_projection_active_v1 WHERE public_id=? AND projection_id=?").get(receipt.publicId, receipt.projectionId) as Record<string, unknown> | undefined;
    if (!pointer) throw new Error("BILINGUAL_EXPORT_POINTER_DRIFT");
    const generatedAt = String(projection.updated_at);
    const previous = this.database.prepare("SELECT payload_hash FROM bilingual_public_projection_v1 WHERE public_id=? AND generation<? ORDER BY generation DESC LIMIT 1").get(receipt.publicId, receipt.generation) as Record<string, unknown> | undefined;
    const body = {
      schemaVersion: "public-bilingual-snapshot-v1" as const,
      schema10Sha256: PUBLIC_SCHEMA10_SHA256,
      migration0010Sha256: PUBLIC_MIGRATION_0010_SHA256,
      generationId: String(projection.generation_id), generatedAt,
      records: receipt.status === "published" ? [{ projectionId: receipt.projectionId, publicationId: receipt.publicationId, publicationRevision: Number(projection.publication_revision), bundleId: String(projection.bundle_id), bundleHash: String(projection.bundle_hash), pointerVersion: Number(pointer.pointer_version), projectionHash: receipt.projectionHash, payload }] : [],
      withdrawals: receipt.status === "withdrawn" ? [{ publicId: receipt.publicId, publicationId: receipt.publicationId, publicationRevision: Number(projection.publication_revision), supersededProjectionHash: String(previous?.payload_hash), withdrawnAt: generatedAt }] : [],
    };
    const bodyHash = sha256(canonicalJson(body));
    const envelope = { schemaVersion: "public-bilingual-snapshot-signed-v1" as const, body, bodyHash, signingKeyId: this.signingKeyId, signature: sign(null, publicBilingualSnapshotSignaturePayload(bodyHash), this.privateKey).toString("base64url") };
    const generationFile = `bilingual-generation-${bodyHash}.json`;
    atomicWrite(join(this.root, generationFile), canonicalJson(envelope));
    this.fail?.("after_generation");
    const oldPointerPath = join(this.root, PUBLIC_BILINGUAL_POINTER_FILE);
    let lkg: { file: string; generationId: string; generationHash: string } | null = null;
    if (existsSync(oldPointerPath)) {
      const old = SignedPublicBilingualPointerSchema.parse(JSON.parse(readFileSync(oldPointerPath, "utf8")));
      if (old.bodyHash !== sha256(canonicalJson(old.body)) || !verify(null, publicBilingualPointerSignaturePayload(old.bodyHash), this.publicKey, Buffer.from(old.signature, "base64url"))) throw new Error("BILINGUAL_EXPORT_POINTER_INVALID");
      lkg = old.body.active;
    }
    const pointerBody = { schemaVersion: "public-bilingual-active-pointer-v1" as const, schema10Sha256: body.schema10Sha256, migration0010Sha256: body.migration0010Sha256, active: { file: generationFile, generationId: body.generationId, generationHash: bodyHash }, lkg, updatedAt: generatedAt };
    const pointerHash = sha256(canonicalJson(pointerBody));
    const signedPointer = { schemaVersion: "public-bilingual-active-pointer-signed-v1" as const, body: pointerBody, bodyHash: pointerHash, signingKeyId: this.signingKeyId, signature: sign(null, publicBilingualPointerSignaturePayload(pointerHash), this.privateKey).toString("base64url") };
    this.fail?.("before_pointer");
    const pointerJson = canonicalJson(signedPointer);
    atomicWrite(oldPointerPath, pointerJson, true);
    return Object.freeze({ generationHash: bodyHash, pointerHash });
  }
}

export class AdminBilingualPublicationService {
  public constructor(private readonly database: DatabaseSync, private readonly writer: AdminBilingualProjectionWriter, private readonly exporter: AdminBilingualProjectionExporter, private readonly releaseSha256: string, private readonly manifestSha256: string, private readonly now: () => Date = () => new Date()) {}

  public publish(authorization: BilingualPublicationAuthorization, input: Readonly<{ candidateId: string; expectedBundleRevision: number }>): BilingualPublicationReceipt {
    const value = this.database.prepare(`SELECT b.payload_json,source.display_name AS source_name,c.author,c.published_at,c.canonical_url
      FROM bilingual_bundle_v1 b
      JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id
      JOIN source_registry_v1 source ON source.source_id=c.source_id
      WHERE b.candidate_id=? AND b.revision=? AND b.state='reviewable'`).get(input.candidateId, input.expectedBundleRevision) as Record<string, unknown> | undefined;
    if (!value) throw new Error("BILINGUAL_PUBLICATION_BUNDLE_STALE");
    const bundle = JSON.parse(String(value.payload_json)) as Record<string, any>;
    const at = this.now().toISOString();
    const localized = (draft: Record<string, any>) => ({ title: draft.title, summary: draft.summary, lead: draft.lead, body: Array.isArray(draft.body) ? draft.body.join("\n") : draft.body, keyPoints: draft.keyPoints, contentHash: draft.contentHash });
    const payload = { schemaVersion: "public-read-bilingual-v2", publicId: bundle.publicId, category: "race_news", defaultLanguage: "zh-CN", availableLanguages: ["zh-CN", "en"], localized: { "zh-CN": localized(bundle.zh), en: localized(bundle.en) }, source: { name: value.source_name, author: value.author, publishedAt: value.published_at, canonicalUrl: value.canonical_url }, publishedAt: at, updatedAt: at, media: [] };
    const generation = Number((this.database.prepare("SELECT COALESCE(MAX(generation),0)+1 AS generation FROM bilingual_public_projection_v1").get() as Record<string, unknown>).generation);
    const artifact = this.exporter.artifact(payload, { releaseSha256: this.releaseSha256, manifestSha256: this.manifestSha256, generationId: `generation-${authorization.operationId}`, generation });
    const receipt = this.writer.publish(authorization, { ...input, artifact, activationOperationId: `${authorization.operationId}.activate` });
    this.exporter.export(receipt);
    return receipt;
  }

  public withdraw(authorization: BilingualPublicationAuthorization, input: Readonly<{ publicationId: string; expectedRevision: number }>): BilingualPublicationReceipt {
    const previous = this.database.prepare(`SELECT projection.payload_json FROM bilingual_publication_v1 publication JOIN bilingual_public_projection_v1 projection ON projection.publication_id=publication.publication_id WHERE publication.publication_id=? AND publication.revision=? AND publication.status='published' ORDER BY projection.generation DESC LIMIT 1`).get(input.publicationId, input.expectedRevision) as Record<string, unknown> | undefined;
    if (!previous) throw new Error("BILINGUAL_WITHDRAW_PUBLICATION_STALE");
    const payload = PublicBilingualPayloadSchema.parse(JSON.parse(String(previous.payload_json)));
    const at = this.now().toISOString();
    const generation = Number((this.database.prepare("SELECT COALESCE(MAX(generation),0)+1 AS generation FROM bilingual_public_projection_v1").get() as Record<string, unknown>).generation);
    const artifact = this.exporter.artifact({ ...payload, updatedAt: at }, { releaseSha256: this.releaseSha256, manifestSha256: this.manifestSha256, generationId: `generation-${authorization.operationId}`, generation });
    const receipt = this.writer.withdraw(authorization, { ...input, artifact });
    this.exporter.export(receipt);
    return receipt;
  }
}
