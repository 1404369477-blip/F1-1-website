import {
  createHash,
  randomUUID,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "./error.ts";
import {
  verifyProjectionSnapshot,
  verifyStoredProjectionTaskEnvelope
} from "./mapping.ts";
import {
  HashSchema,
  IdentifierSchema,
  ProjectionTaskEnvelopeSchema,
  UtcTimestampSchema,
  type ProjectionSnapshot,
  type ProjectionTaskEnvelope
} from "./schema.ts";

const DELIVERY_PATTERN = /^op-snapshot-[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,128}$/;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

export const SignedProjectionPackageSchema = z.object({
  schemaVersion: z.literal("admin-public-projection-signed-v1"),
  taskEnvelope: ProjectionTaskEnvelopeSchema,
  taskEnvelopeHash: HashSchema,
  signingKeyId: IdentifierSchema,
  signature: z.string().regex(SIGNATURE_PATTERN)
}).strict();

export const ProjectionReceiptSchema = z.object({
  schemaVersion: z.literal("admin-public-projection-receipt-v1"),
  deliveryId: z.string().regex(DELIVERY_PATTERN),
  snapshotManifestHash: HashSchema,
  snapshotGeneration: z.number().int().positive(),
  status: z.enum(["active", "superseded"]),
  activeSnapshotGeneration: z.number().int().nonnegative(),
  activeSnapshotManifestHash: HashSchema.nullable(),
  reasonCode: z.null(),
  receivedAt: UtcTimestampSchema,
  activatedAt: UtcTimestampSchema
}).strict();

const ActivePointerSchema = z.object({
  schemaVersion: z.literal("projection-active-pointer-v1"),
  snapshotGeneration: z.number().int().positive(),
  snapshotManifestHash: HashSchema,
  activatedAt: UtcTimestampSchema
}).strict();

const CommittedGenerationSchema = z.object({
  schemaVersion: z.literal("projection-committed-generation-v1"),
  package: SignedProjectionPackageSchema,
  receivedAt: UtcTimestampSchema,
  activatedAt: UtcTimestampSchema
}).strict();

export type SignedProjectionPackage = z.infer<typeof SignedProjectionPackageSchema>;
export type ProjectionReceipt = z.infer<typeof ProjectionReceiptSchema>;
type ActivePointer = z.infer<typeof ActivePointerSchema>;
type CommittedGeneration = z.infer<typeof CommittedGenerationSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function signaturePayload(snapshotManifestHash: string): Buffer {
  return Buffer.from(`admin-public-projection-v1\n${snapshotManifestHash}`, "utf8");
}

function iso(now: number): string {
  if (!Number.isFinite(now)) throw new ReviewRealError("PROJECTION_STORAGE_FAILED", 503);
  return new Date(now).toISOString();
}

export function signProjectionTaskEnvelope(input: Readonly<{
  envelopeJson: string;
  envelopeHash: string;
  signingKeyId: string;
  privateKey: KeyObject;
}>): SignedProjectionPackage {
  const envelope = verifyStoredProjectionTaskEnvelope(input.envelopeJson, input.envelopeHash);
  const expectedDeliveryId = `op-snapshot-${envelope.snapshot.snapshotManifestHash}`;
  if (
    envelope.deliveryId !== expectedDeliveryId ||
    !envelope.idempotencyKey.endsWith(`:${envelope.snapshot.snapshotManifestHash}`) ||
    envelope.reconcileKey !== `reconcile:snapshot:${envelope.snapshot.snapshotManifestHash}`
  ) {
    throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
  }
  const signature = sign(
    null,
    signaturePayload(envelope.snapshot.snapshotManifestHash),
    input.privateKey
  ).toString("base64url");
  return SignedProjectionPackageSchema.parse({
    schemaVersion: "admin-public-projection-signed-v1",
    taskEnvelope: envelope,
    taskEnvelopeHash: input.envelopeHash,
    signingKeyId: input.signingKeyId,
    signature
  });
}

export function verifySignedProjectionPackage(
  value: unknown,
  input: Readonly<{ signingKeyId: string; publicKey: KeyObject }>
): SignedProjectionPackage {
  const parsed = SignedProjectionPackageSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("PROJECTION_SCHEMA_INVALID", 422);
  if (parsed.data.signingKeyId !== input.signingKeyId) {
    throw new ReviewRealError("PROJECTION_SIGNING_KEY_INACTIVE", 403);
  }
  const envelopeJson = canonicalJson(parsed.data.taskEnvelope);
  let envelope: ProjectionTaskEnvelope;
  try {
    envelope = verifyStoredProjectionTaskEnvelope(envelopeJson, parsed.data.taskEnvelopeHash);
  } catch {
    throw new ReviewRealError("PROJECTION_MANIFEST_HASH_MISMATCH", 422);
  }
  if (envelope.deliveryId !== `op-snapshot-${envelope.snapshot.snapshotManifestHash}`) {
    throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
  }
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(parsed.data.signature, "base64url");
  } catch {
    throw new ReviewRealError("PROJECTION_SIGNATURE_INVALID", 403);
  }
  if (!verify(
    null,
    signaturePayload(envelope.snapshot.snapshotManifestHash),
    input.publicKey,
    signatureBytes
  )) {
    throw new ReviewRealError("PROJECTION_SIGNATURE_INVALID", 403);
  }
  return parsed.data;
}

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700, recursive: false });
  const stat = lstatSync(path);
  const currentUid = process.getuid?.();
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    currentUid === undefined ||
    stat.uid !== currentUid
  ) {
    throw new ReviewRealError("PROJECTION_STORAGE_FAILED", 503);
  }
  chmodSync(path, 0o700);
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAtomic(path: string, value: string): void {
  const temporary = `${path}.stage-${randomUUID()}`;
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
    writeFileSync(fd, value, { encoding: "utf8" });
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function parseCanonicalFile<T>(path: string, schema: z.ZodType<T>): T {
  let raw: string;
  let value: unknown;
  try {
    raw = readFileSync(path, "utf8");
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || raw !== canonicalJson(parsed.data)) {
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  }
  return parsed.data;
}

export class ProjectionReceiver {
  private readonly root: string;
  private readonly generationsRoot: string;
  private readonly activePath: string;
  private readonly signingKeyId: string;
  private readonly publicKey: KeyObject;
  private readonly bootstrapPin: Readonly<{
    snapshotGeneration: number;
    snapshotManifestHash: string;
  }>;
  private readonly now: () => number;

  constructor(input: Readonly<{
    root: string;
    signingKeyId: string;
    publicKey: KeyObject;
    bootstrapPin: Readonly<{
      snapshotGeneration: number;
      snapshotManifestHash: string;
    }>;
    now?: () => number;
  }>) {
    this.root = resolve(input.root);
    this.generationsRoot = join(this.root, "generations");
    this.activePath = join(this.root, "active.json");
    this.signingKeyId = input.signingKeyId;
    this.publicKey = input.publicKey;
    if (
      !Number.isSafeInteger(input.bootstrapPin.snapshotGeneration) ||
      input.bootstrapPin.snapshotGeneration < 1 ||
      !HashSchema.safeParse(input.bootstrapPin.snapshotManifestHash).success
    ) {
      throw new ReviewRealError("PROJECTION_STORAGE_FAILED", 503);
    }
    this.bootstrapPin = Object.freeze({ ...input.bootstrapPin });
    this.now = input.now ?? Date.now;
    ensurePrivateDirectory(this.root);
    ensurePrivateDirectory(this.generationsRoot);
  }

  private generationPath(hash: string): string {
    if (!HashSchema.safeParse(hash).success) throw new ReviewRealError("PROJECTION_SCHEMA_INVALID", 422);
    return join(this.generationsRoot, `${hash}.json`);
  }

  private readPointer(): ActivePointer | null {
    if (!existsSync(this.activePath)) return null;
    return parseCanonicalFile(this.activePath, ActivePointerSchema);
  }

  private readGeneration(hash: string): CommittedGeneration {
    const generation = parseCanonicalFile(this.generationPath(hash), CommittedGenerationSchema);
    verifySignedProjectionPackage(generation.package, {
      signingKeyId: this.signingKeyId,
      publicKey: this.publicKey
    });
    if (generation.package.taskEnvelope.snapshot.snapshotManifestHash !== hash) {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
    return generation;
  }

  private receiptFor(generation: CommittedGeneration, active: ActivePointer): ProjectionReceipt {
    const snapshot = generation.package.taskEnvelope.snapshot;
    return ProjectionReceiptSchema.parse({
      schemaVersion: "admin-public-projection-receipt-v1",
      deliveryId: generation.package.taskEnvelope.deliveryId,
      snapshotManifestHash: snapshot.snapshotManifestHash,
      snapshotGeneration: snapshot.snapshotGeneration,
      status: snapshot.snapshotManifestHash === active.snapshotManifestHash ? "active" : "superseded",
      activeSnapshotGeneration: active.snapshotGeneration,
      activeSnapshotManifestHash: active.snapshotManifestHash,
      reasonCode: null,
      receivedAt: generation.receivedAt,
      activatedAt: generation.activatedAt
    });
  }

  private findCommitted(deliveryId: string): ProjectionReceipt | null {
    const active = this.readPointer();
    if (active === null) return null;
    let hash: string | null = active.snapshotManifestHash;
    let expectedGeneration = active.snapshotGeneration;
    let steps = 0;
    let matched: CommittedGeneration | null = null;
    while (hash !== null && steps <= active.snapshotGeneration) {
      const generation = this.readGeneration(hash);
      if (generation.package.taskEnvelope.snapshot.snapshotGeneration !== expectedGeneration) {
        throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
      }
      if (generation.package.taskEnvelope.deliveryId === deliveryId) {
        matched = generation;
      }
      if (
        expectedGeneration === this.bootstrapPin.snapshotGeneration &&
        hash === this.bootstrapPin.snapshotManifestHash
      ) {
        hash = null;
        expectedGeneration = 0;
      } else {
        hash = generation.package.taskEnvelope.snapshot.previousSnapshotManifestHash;
        expectedGeneration -= 1;
      }
      steps += 1;
    }
    if (expectedGeneration !== 0) {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
    return matched === null ? null : this.receiptFor(matched, active);
  }

  receive(value: unknown): ProjectionReceipt {
    const packageValue = verifySignedProjectionPackage(value, {
      signingKeyId: this.signingKeyId,
      publicKey: this.publicKey
    });
    const rawPackage = canonicalJson(packageValue);
    if (Buffer.byteLength(rawPackage, "utf8") > MAX_PACKAGE_BYTES) {
      throw new ReviewRealError("PROJECTION_REQUEST_INVALID", 413);
    }
    const existingReceipt = this.findCommitted(packageValue.taskEnvelope.deliveryId);
    if (existingReceipt !== null) {
      if (existingReceipt.snapshotManifestHash !== packageValue.taskEnvelope.snapshot.snapshotManifestHash) {
        throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
      }
      return existingReceipt;
    }

    const active = this.readPointer();
    const snapshot = packageValue.taskEnvelope.snapshot;
    if ((snapshot.snapshotGeneration === 1) !== (snapshot.previousSnapshotManifestHash === null)) {
      throw new ReviewRealError("PROJECTION_GENERATION_CONFLICT", 409);
    }
    if (active !== null) {
      const activeGeneration = this.readGeneration(active.snapshotManifestHash);
      if (activeGeneration.package.taskEnvelope.snapshot.snapshotGeneration !== active.snapshotGeneration) {
        throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
      }
    }
    if (
      (active === null && (
        snapshot.snapshotGeneration !== this.bootstrapPin.snapshotGeneration ||
        snapshot.snapshotManifestHash !== this.bootstrapPin.snapshotManifestHash
      )) ||
      (active !== null && (
        snapshot.snapshotGeneration !== active.snapshotGeneration + 1 ||
        snapshot.previousSnapshotManifestHash !== active.snapshotManifestHash
      ))
    ) {
      throw new ReviewRealError("PROJECTION_GENERATION_CONFLICT", 409);
    }

    const receivedAt = iso(this.now());
    const activatedAt = receivedAt;
    let committed = CommittedGenerationSchema.parse({
      schemaVersion: "projection-committed-generation-v1",
      package: packageValue,
      receivedAt,
      activatedAt
    });
    const generationPath = this.generationPath(snapshot.snapshotManifestHash);
    try {
      if (existsSync(generationPath)) {
        const prior = parseCanonicalFile(generationPath, CommittedGenerationSchema);
        if (canonicalJson(prior.package) !== rawPackage) {
          throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
        }
        committed = prior;
      } else {
        writeAtomic(generationPath, canonicalJson(committed));
        fsyncDirectory(this.generationsRoot);
      }
      const pointer = ActivePointerSchema.parse({
        schemaVersion: "projection-active-pointer-v1",
        snapshotGeneration: snapshot.snapshotGeneration,
        snapshotManifestHash: snapshot.snapshotManifestHash,
        activatedAt: committed.activatedAt
      });
      writeAtomic(this.activePath, canonicalJson(pointer));
      fsyncDirectory(this.root);
      return this.receiptFor(committed, pointer);
    } catch (error) {
      if (error instanceof ReviewRealError) throw error;
      throw new ReviewRealError("PROJECTION_ACTIVATION_FAILED", 503);
    }
  }

  getReceipt(deliveryId: string): ProjectionReceipt {
    if (!DELIVERY_PATTERN.test(deliveryId)) {
      throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    }
    const receipt = this.findCommitted(deliveryId);
    if (receipt === null) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    return receipt;
  }

  readActiveSnapshot(): ProjectionSnapshot | null {
    const active = this.readPointer();
    if (active === null) return null;
    const generation = this.readGeneration(active.snapshotManifestHash);
    if (generation.package.taskEnvelope.snapshot.snapshotGeneration !== active.snapshotGeneration) {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
    try {
      return verifyProjectionSnapshot(generation.package.taskEnvelope.snapshot);
    } catch {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
  }
}

export class PublicSnapshotRepository {
  private readonly receiver: ProjectionReceiver;

  constructor(receiver: ProjectionReceiver) {
    this.receiver = receiver;
  }

  list(): Readonly<{
    schemaVersion: "public-read-real-v0.1";
    items: ProjectionSnapshot["records"];
    page: { pageSize: 12; hasMore: boolean; nextCursor: null };
  }> {
    const snapshot = this.receiver.readActiveSnapshot();
    if (snapshot === null) {
      return {
        schemaVersion: "public-read-real-v0.1",
        items: [],
        page: { pageSize: 12, hasMore: false, nextCursor: null }
      };
    }
    const ordered = [...snapshot.records].sort((left, right) => {
      const time = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
      return time !== 0 ? time : left.publicId.localeCompare(right.publicId);
    });
    return {
      schemaVersion: "public-read-real-v0.1",
      items: ordered.slice(0, 12),
      page: { pageSize: 12, hasMore: ordered.length > 12, nextCursor: null }
    };
  }

  detail(publicId: string): Readonly<{
    schemaVersion: "public-read-real-v0.1";
    story: ProjectionSnapshot["records"][number];
    relatedItems: ProjectionSnapshot["records"];
  }> {
    const snapshot = this.receiver.readActiveSnapshot();
    if (snapshot === null) throw new ReviewRealError("PUBLIC_SNAPSHOT_UNAVAILABLE", 404);
    const story = snapshot.records.find((record) => record.publicId === publicId);
    if (!story) throw new ReviewRealError("PUBLIC_SNAPSHOT_UNAVAILABLE", 404);
    return {
      schemaVersion: "public-read-real-v0.1",
      story,
      relatedItems: snapshot.records.filter((record) => record.publicId !== publicId).slice(0, 4)
    };
  }
}
