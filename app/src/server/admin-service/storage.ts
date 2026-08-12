import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "../review-real/error.ts";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const CredentialSchema = z.object({
  id: z.string().min(1).max(2048).regex(BASE64URL_PATTERN),
  publicKey: z.string().min(1).max(16_384).regex(BASE64URL_PATTERN),
  counter: z.number().int().nonnegative().safe(),
  transports: z.array(z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"])).max(16),
  deviceType: z.enum(["singleDevice", "multiDevice"]),
  backedUp: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  disabledAt: z.string().datetime({ offset: true }).nullable()
}).strict();

const CredentialFileSchema = z.object({
  schemaVersion: z.literal("admin-passkey-credentials-v1"),
  operatorRef: z.string().min(1).max(256),
  webauthnUserId: z.string().regex(TOKEN_PATTERN),
  credentials: z.array(CredentialSchema).min(1).max(16)
}).strict();

const BootstrapStateSchema = z.object({
  schemaVersion: z.literal("admin-passkey-bootstrap-v1"),
  tokenHash: z.string().regex(HASH_PATTERN),
  createdAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
  consumedAt: z.number().int().nonnegative().safe().nullable()
}).strict();

export type StoredPasskeyCredential = z.infer<typeof CredentialSchema>;
export type StoredCredentialFile = z.infer<typeof CredentialFileSchema>;
type BootstrapState = z.infer<typeof BootstrapStateSchema>;

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return uid;
}

export function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== currentUid() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  chmodSync(path, 0o700);
}

export function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== currentUid() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  chmodSync(path, 0o600);
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWrite(path: string, value: string): void {
  const parent = resolve(path, "..");
  assertPrivateDirectory(parent);
  if (existsSync(path)) assertPrivateFile(path);
  const temporary = `${path}.stage-${randomUUID()}`;
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600
    );
    writeFileSync(descriptor, value, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function parseCanonical<T>(path: string, schema: z.ZodType<T>): T {
  assertPrivateFile(path);
  let raw: string;
  let value: unknown;
  try {
    raw = readFileSync(path, "utf8");
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || raw !== canonicalJson(parsed.data)) {
    throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  }
  return parsed.data;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export class PasskeyCredentialStore {
  readonly path: string;

  constructor(root: string) {
    const privateRoot = resolve(root);
    assertPrivateDirectory(privateRoot);
    this.path = join(privateRoot, "credentials.json");
    if (existsSync(this.path)) this.read();
  }

  read(): StoredCredentialFile | null {
    if (!existsSync(this.path)) return null;
    return parseCanonical(this.path, CredentialFileSchema);
  }

  addInitial(input: Readonly<{
    operatorRef: string;
    webauthnUserId: string;
    credential: StoredPasskeyCredential;
  }>): StoredCredentialFile {
    if (this.read() !== null) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    const value = CredentialFileSchema.parse({
      schemaVersion: "admin-passkey-credentials-v1",
      operatorRef: input.operatorRef,
      webauthnUserId: input.webauthnUserId,
      credentials: [input.credential]
    });
    atomicWrite(this.path, canonicalJson(value));
    return parseCanonical(this.path, CredentialFileSchema);
  }

  activeCredentials(): readonly StoredPasskeyCredential[] {
    return (this.read()?.credentials ?? []).filter((credential) => credential.disabledAt === null);
  }

  credential(id: string): StoredPasskeyCredential {
    const credential = this.activeCredentials().find((candidate) => candidate.id === id);
    if (!credential) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    return credential;
  }

  commitAuthenticationState(input: Readonly<{
    credentialId: string;
    expectedCounter: number;
    newCounter: number;
    deviceType: StoredPasskeyCredential["deviceType"];
    backedUp: boolean;
    now: string;
  }>): void {
    const current = this.read();
    if (current === null) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    const parsed = z.object({
      credentialId: z.string().min(1).max(2048).regex(BASE64URL_PATTERN),
      expectedCounter: z.number().int().nonnegative().safe(),
      newCounter: z.number().int().nonnegative().safe(),
      deviceType: z.enum(["singleDevice", "multiDevice"]),
      backedUp: z.boolean(),
      now: z.string().datetime({ offset: true })
    }).strict().safeParse(input);
    if (!parsed.success) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    let found = false;
    const credentials = current.credentials.map((credential) => {
      if (credential.id !== parsed.data.credentialId || credential.disabledAt !== null) return credential;
      found = true;
      if (
        credential.counter !== parsed.data.expectedCounter ||
        credential.deviceType !== parsed.data.deviceType ||
        ((credential.counter !== 0 || parsed.data.newCounter !== 0) &&
          parsed.data.newCounter <= credential.counter) ||
        (credential.deviceType === "singleDevice" &&
          (credential.backedUp || parsed.data.backedUp)) ||
        (credential.backedUp && !parsed.data.backedUp)
      ) {
        throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
      }
      return CredentialSchema.parse({
        ...credential,
        counter: parsed.data.newCounter,
        backedUp: parsed.data.backedUp,
        updatedAt: parsed.data.now
      });
    });
    if (!found) throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    atomicWrite(this.path, canonicalJson(CredentialFileSchema.parse({ ...current, credentials })));
  }
}

export class BootstrapTokenStore {
  readonly tokenPath: string;
  readonly statePath: string;

  constructor(root: string) {
    const privateRoot = resolve(root);
    assertPrivateDirectory(privateRoot);
    this.tokenPath = join(privateRoot, "bootstrap-token");
    this.statePath = join(privateRoot, "bootstrap-state.json");
  }

  prepare(now: number, ttlMs = 10 * 60 * 1000): Readonly<{
    tokenPath: string;
    statePath: string;
    expiresAt: number;
  }> {
    if (!Number.isFinite(now) || !Number.isSafeInteger(now) || ttlMs < 1 || ttlMs > 10 * 60 * 1000) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    if (existsSync(this.tokenPath) || existsSync(this.statePath)) {
      throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    }
    const token = randomBytes(32).toString("base64url");
    if (!TOKEN_PATTERN.test(token)) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
    const state = BootstrapStateSchema.parse({
      schemaVersion: "admin-passkey-bootstrap-v1",
      tokenHash: sha256(token),
      createdAt: now,
      expiresAt: now + ttlMs,
      consumedAt: null
    });
    atomicWrite(this.tokenPath, token);
    atomicWrite(this.statePath, canonicalJson(state));
    return { tokenPath: this.tokenPath, statePath: this.statePath, expiresAt: state.expiresAt };
  }

  assertUsable(token: string, now: number): BootstrapState {
    if (!TOKEN_PATTERN.test(token) || !Number.isFinite(now)) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
    if (!existsSync(this.statePath) || !existsSync(this.tokenPath)) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
    const state = parseCanonical(this.statePath, BootstrapStateSchema);
    if (
      state.consumedAt !== null ||
      now > state.expiresAt ||
      !equalHash(state.tokenHash, sha256(token))
    ) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 404);
    }
    return state;
  }

  consume(token: string, now: number): void {
    const state = this.assertUsable(token, now);
    atomicWrite(this.statePath, canonicalJson(BootstrapStateSchema.parse({ ...state, consumedAt: now })));
    if (existsSync(this.tokenPath)) {
      assertPrivateFile(this.tokenPath);
      unlinkSync(this.tokenPath);
      fsyncDirectory(resolve(this.tokenPath, ".."));
    }
  }
}
