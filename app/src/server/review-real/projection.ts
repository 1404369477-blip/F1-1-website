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
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
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
const MAX_VERIFIED_GENERATIONS = 4096;

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
type VerifiedGeneration = Readonly<{
  snapshotGeneration: number;
  snapshotManifestHash: string;
  previousSnapshotManifestHash: string | null;
  deliveryId: string;
  receivedAt: string;
  activatedAt: string;
}>;

function generationProof(generation: CommittedGeneration): VerifiedGeneration {
  const snapshot = generation.package.taskEnvelope.snapshot;
  return Object.freeze({
    snapshotGeneration: snapshot.snapshotGeneration,
    snapshotManifestHash: snapshot.snapshotManifestHash,
    previousSnapshotManifestHash: snapshot.previousSnapshotManifestHash,
    deliveryId: generation.package.taskEnvelope.deliveryId,
    receivedAt: generation.receivedAt,
    activatedAt: generation.activatedAt
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

function writeExclusive(path: string, value: string): void {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
  try {
    writeFileSync(descriptor, value, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readProjectionFile(path: string): Buffer {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let descriptor: number | null = null;
  let raw: Buffer;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor);
    const pathIdentity = lstatSync(path);
    const currentUid = process.getuid?.();
    if (
      !before.isFile() || before.nlink !== 1 || currentUid === undefined || before.uid !== currentUid ||
      (before.mode & 0o077) !== 0 || pathIdentity.isSymbolicLink() ||
      before.dev !== pathIdentity.dev || before.ino !== pathIdentity.ino || before.size > MAX_PACKAGE_BYTES
    ) throw new Error("PUBLIC_SNAPSHOT_FILE_IDENTITY_INVALID");
    raw = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPathIdentity = lstatSync(path);
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      after.dev !== finalPathIdentity.dev || after.ino !== finalPathIdentity.ino ||
      finalPathIdentity.isSymbolicLink()
    ) throw new Error("PUBLIC_SNAPSHOT_FILE_CHANGED");
  } catch {
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  return raw;
}

function parseCanonicalValue<T>(raw: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; }
  catch { throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503); }
  const parsed = schema.safeParse(value);
  if (!parsed.success || raw !== canonicalJson(parsed.data)) {
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  }
  return parsed.data;
}

function parseCanonicalFile<T>(path: string, schema: z.ZodType<T>): T {
  return parseCanonicalValue(readProjectionFile(path).toString("utf8"), schema);
}

function assertReadableProjectionDirectory(path: string): void {
  try {
    const stat = lstatSync(path);
    const canonicalStat = lstatSync(realpathSync(path));
    const currentUid = process.getuid?.();
    if (
      !stat.isDirectory() || stat.isSymbolicLink() || currentUid === undefined || stat.uid !== currentUid ||
      stat.nlink < 1 || (stat.mode & 0o077) !== 0 ||
      canonicalStat.ino !== stat.ino || canonicalStat.dev !== stat.dev
    ) throw new Error("PUBLIC_SNAPSHOT_DIRECTORY_IDENTITY_INVALID");
  } catch {
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  }
}

export function readProjectionSnapshot(input: Readonly<{
  root: string;
  signingKeyId: string;
  publicKey: KeyObject;
}>): ProjectionSnapshot | null {
  const root = resolve(input.root);
  assertReadableProjectionDirectory(root);
  const activePath = join(root, "active.json");
  try {
    lstatSync(activePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  }
  const active = parseCanonicalFile(activePath, ActivePointerSchema);
  const generationsRoot = join(root, "generations");
  assertReadableProjectionDirectory(generationsRoot);
  const generationPath = join(generationsRoot, `${active.snapshotManifestHash}.json`);
  const generation = parseCanonicalFile(generationPath, CommittedGenerationSchema);
  const packageValue = verifySignedProjectionPackage(generation.package, {
    signingKeyId: input.signingKeyId,
    publicKey: input.publicKey
  });
  const snapshot = packageValue.taskEnvelope.snapshot;
  if (
    snapshot.snapshotGeneration !== active.snapshotGeneration ||
    snapshot.snapshotManifestHash !== active.snapshotManifestHash ||
    generation.activatedAt !== active.activatedAt
  ) throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
  try { return verifyProjectionSnapshot(snapshot); }
  catch { throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503); }
}

export class ProjectionReceiver {
  private readonly root: string;
  private readonly generationsRoot: string;
  private readonly activePath: string;
  private readonly signingKeyId: string;
  private readonly publicKey: KeyObject;
  private readonly activationLockPath: string;
  private readonly now: () => number;
  private readonly verifiedGenerations = new Map<string, Readonly<{ rawSha256: string; proof: VerifiedGeneration }>>();

  constructor(input: Readonly<{
    root: string;
    signingKeyId: string;
    publicKey: KeyObject;
    /** Deprecated compatibility input. Bootstrap identity is established by a valid signed generation 1. */
    bootstrapPin?: unknown;
    now?: () => number;
  }>) {
    this.root = resolve(input.root);
    this.generationsRoot = join(this.root, "generations");
    this.activePath = join(this.root, "active.json");
    this.signingKeyId = input.signingKeyId;
    this.publicKey = input.publicKey;
    this.activationLockPath = join(this.root, "activation.lock");
    this.now = input.now ?? Date.now;
    ensurePrivateDirectory(this.root);
    ensurePrivateDirectory(this.generationsRoot);
  }

  private generationPath(hash: string): string {
    if (!HashSchema.safeParse(hash).success) throw new ReviewRealError("PROJECTION_SCHEMA_INVALID", 422);
    return join(this.generationsRoot, `${hash}.json`);
  }

  private readPointer(): ActivePointer | null {
    assertReadableProjectionDirectory(this.root);
    assertReadableProjectionDirectory(this.generationsRoot);
    if (!existsSync(this.activePath)) return null;
    return parseCanonicalFile(this.activePath, ActivePointerSchema);
  }

  private readGeneration(hash: string): VerifiedGeneration {
    // Read and hash current bytes on every traversal. Cache only the expensive
    // canonical/schema/signature verification, never the file or chain checks.
    const raw = readProjectionFile(this.generationPath(hash));
    const rawSha256 = sha256(raw);
    const cached = this.verifiedGenerations.get(hash);
    if (cached?.rawSha256 === rawSha256) return cached.proof;
    const generation = parseCanonicalValue(raw.toString("utf8"), CommittedGenerationSchema);
    verifySignedProjectionPackage(generation.package, {
      signingKeyId: this.signingKeyId,
      publicKey: this.publicKey
    });
    if (generation.package.taskEnvelope.snapshot.snapshotManifestHash !== hash) {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
    const proof = generationProof(generation);
    if (!this.verifiedGenerations.has(hash) && this.verifiedGenerations.size >= MAX_VERIFIED_GENERATIONS) {
      this.verifiedGenerations.delete(this.verifiedGenerations.keys().next().value!);
    }
    this.verifiedGenerations.set(hash, Object.freeze({ rawSha256, proof }));
    return proof;
  }

  private receiptFor(generation: VerifiedGeneration, active: ActivePointer): ProjectionReceipt {
    return ProjectionReceiptSchema.parse({
      schemaVersion: "admin-public-projection-receipt-v1",
      deliveryId: generation.deliveryId,
      snapshotManifestHash: generation.snapshotManifestHash,
      snapshotGeneration: generation.snapshotGeneration,
      status: generation.snapshotManifestHash === active.snapshotManifestHash ? "active" : "superseded",
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
    let matched: VerifiedGeneration | null = null;
    while (hash !== null && steps <= active.snapshotGeneration) {
      const generation = this.readGeneration(hash);
      if (generation.snapshotGeneration !== expectedGeneration ||
          (steps === 0 && generation.activatedAt !== active.activatedAt)) {
        throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
      }
      if (generation.deliveryId === deliveryId) {
        matched = generation;
      }
      const previousHash = generation.previousSnapshotManifestHash;
      if (expectedGeneration === 1 && previousHash === null) {
        hash = null;
        expectedGeneration = 0;
      } else {
        if (expectedGeneration <= 1 || previousHash === null) {
          throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
        }
        hash = previousHash;
        expectedGeneration -= 1;
      }
      steps += 1;
    }
    if (expectedGeneration !== 0) {
      throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
    }
    return matched === null ? null : this.receiptFor(matched, active);
  }

  /** Cold verification belongs before the HTTP listener accepts delivery work. */
  verifyActiveChain(): void {
    this.findCommitted(`op-snapshot-${"0".repeat(64)}`);
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
    let lockDescriptor: number | null = null;
    let ownsActivationLock = false;
    try {
      lockDescriptor = openSync(
        this.activationLockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
        0o600
      );
      closeSync(lockDescriptor);
      lockDescriptor = null;
      ownsActivationLock = true;
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
        if (activeGeneration.snapshotGeneration !== active.snapshotGeneration || activeGeneration.activatedAt !== active.activatedAt) {
          throw new ReviewRealError("PUBLIC_SNAPSHOT_INTEGRITY_FAILED", 503);
        }
      }
      if (
        (active === null && snapshot.snapshotGeneration !== 1) ||
        (active !== null && (
          snapshot.snapshotGeneration !== active.snapshotGeneration + 1 ||
          snapshot.previousSnapshotManifestHash !== active.snapshotManifestHash
        ))
      ) {
        throw new ReviewRealError("PROJECTION_GENERATION_CONFLICT", 409);
      }
      const receivedAt = iso(this.now());
      let committed = CommittedGenerationSchema.parse({
        schemaVersion: "projection-committed-generation-v1",
        package: packageValue,
        receivedAt,
        activatedAt: receivedAt
      });
      const generationPath = this.generationPath(snapshot.snapshotManifestHash);
      if (existsSync(generationPath)) {
        const prior = parseCanonicalFile(generationPath, CommittedGenerationSchema);
        if (canonicalJson(prior.package) !== rawPackage) {
          throw new ReviewRealError("PROJECTION_IDEMPOTENCY_CONFLICT", 409);
        }
        committed = prior;
      } else {
        writeExclusive(generationPath, canonicalJson(committed));
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
      return this.receiptFor(generationProof(committed), pointer);
    } catch (error) {
      if (error instanceof ReviewRealError) throw error;
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ReviewRealError("PROJECTION_GENERATION_CONFLICT", 409);
      }
      throw new ReviewRealError("PROJECTION_ACTIVATION_FAILED", 503);
    } finally {
      if (lockDescriptor !== null) closeSync(lockDescriptor);
      if (ownsActivationLock && existsSync(this.activationLockPath)) unlinkSync(this.activationLockPath);
    }
  }

  getReceipt(deliveryId: string): ProjectionReceipt {
    if (!DELIVERY_PATTERN.test(deliveryId)) {
      throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    }
    // Generation files precede pointer activation and can survive a failed
    // activation. Only membership in the active chain proves a commit.
    const receipt = this.findCommitted(deliveryId);
    if (receipt === null) throw new ReviewRealError("PROJECTION_RECEIPT_UNKNOWN", 404);
    return receipt;
  }

  readActiveSnapshot(): ProjectionSnapshot | null {
    return readProjectionSnapshot({
      root: this.root,
      signingKeyId: this.signingKeyId,
      publicKey: this.publicKey
    });
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
