import { createPublicKey, type KeyObject } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import { readXCapturePrivateFile } from "./private-artifact-file.ts";
import { snapshotXCaptureTrust, xCaptureSha256, type XCaptureDeploymentTrust } from "./trusted-capture.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const KeyFile = z.object({ path: z.string(), rawSha256: Hash, spkiSha256: Hash }).strict();
const ConfigSchema = z.object({
  schemaVersion: z.literal("x-page-runtime-trust-config-v1"),
  // Final deployment hash is supplied by the verified runtime, avoiding a
  // deployment -> config -> deployment hash cycle. Capture cannot supply it.
  producerTrust: z.record(z.string(), z.unknown()),
  producerPublicKey: KeyFile,
  verifier: z.object({ verifierId: Id, keyId: Id, publicKey: KeyFile }).strict(),
  adapterRelativePath: z.string().regex(/^src\/server\/x-page\/[a-z0-9-]+\.ts$/),
  toolId: z.enum(["codex-browser-visible-dom-v1", "codex-chrome-visible-dom-v1"]),
  artifactFormat: z.literal("utf8-json-visible-dom-v1"),
  artifactRoot: z.object({ path: z.string(), device: z.number().int().nonnegative(), inode: z.number().int().positive() }).strict(),
}).strict();
export type XPageRuntimeTrustConfig = Readonly<z.infer<typeof ConfigSchema>>;
export type LoadedXPageRuntimeTrust = Readonly<{
  trust: XCaptureDeploymentTrust;
  verifier: Readonly<{ verifierId: string; keyId: string; publicKey: KeyObject }>;
  toolId: XPageRuntimeTrustConfig["toolId"];
  artifactFormat: "utf8-json-visible-dom-v1";
  artifactRoot: Readonly<{ path: string; device: number; inode: number }>;
  configurationSha256: string;
}>;
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

export function assertXCaptureArtifactRoot(root: LoadedXPageRuntimeTrust["artifactRoot"]): void {
  const stat = lstatSync(root.path);
  assert(resolve(root.path) === root.path && realpathSync(root.path) === root.path && stat.isDirectory()
    && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && !(stat.mode & 0o077)
    && stat.dev === root.device && stat.ino === root.inode, "X_CAPTURE_ARTIFACT_ROOT_INVALID");
}
function publicKey(file: z.infer<typeof KeyFile>): KeyObject {
  const bytes = readXCapturePrivateFile(file.path, 4096);
  assert(bytes && xCaptureSha256(bytes.text) === file.rawSha256
    && /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(bytes.text),
  "X_CAPTURE_PUBLIC_KEY_FILE_INVALID");
  const key = createPublicKey(bytes.text);
  assert(key.type === "public" && key.asymmetricKeyType === "ed25519"
    && xCaptureSha256(key.export({ format: "der", type: "spki" })) === file.spkiSha256, "X_CAPTURE_PUBLIC_KEY_IDENTITY_INVALID");
  return key;
}
function implementationHash(appRoot: string, relative: string): string {
  const root = lstatSync(appRoot);
  assert(resolve(appRoot) === appRoot && realpathSync(appRoot) === appRoot && root.isDirectory()
    && root.uid === process.getuid?.() && !(root.mode & 0o022), "X_CAPTURE_RELEASE_ROOT_INVALID");
  const path = join(appRoot, relative), parent = dirname(path), directory = lstatSync(parent);
  assert(realpathSync(parent) === parent && directory.isDirectory() && directory.uid === process.getuid?.()
    && !(directory.mode & 0o022), "X_CAPTURE_ADAPTER_PATH_INVALID");
  const first = lstatSync(path);
  assert(first.isFile() && !first.isSymbolicLink() && first.nlink === 1 && first.uid === process.getuid?.()
    && !(first.mode & 0o022) && first.size > 0 && first.size <= 1024 * 1024, "X_CAPTURE_ADAPTER_FILE_INVALID");
  const signature = (stat: typeof first) => [stat.dev, stat.ino, stat.uid, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd); assert(signature(opened) === signature(first), "X_CAPTURE_ADAPTER_CHANGED");
    const bytes = Buffer.alloc(opened.size + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count;
    }
    const endRoot = lstatSync(appRoot), endParent = lstatSync(parent);
    assert(length === first.size && signature(fstatSync(fd)) === signature(first) && signature(lstatSync(path)) === signature(first)
      && realpathSync(appRoot) === appRoot && endRoot.dev === root.dev && endRoot.ino === root.ino
      && realpathSync(parent) === parent && endParent.dev === directory.dev && endParent.ino === directory.ino,
    "X_CAPTURE_ADAPTER_CHANGED");
    return xCaptureSha256(bytes.subarray(0, length));
  } finally { closeSync(fd); }
}

/** All four input pins come from the verified deployment/release. This loader
 * reads no private signing keys and grants no source admission by itself.
 */
export function loadXPageRuntimeTrust(input: Readonly<{
  configurationPath: string;
  expectedConfigurationSha256: string;
  expectedDeploymentManifestSha256: string;
  releaseAppRoot: string;
}>): LoadedXPageRuntimeTrust {
  assert(Hash.safeParse(input.expectedConfigurationSha256).success && Hash.safeParse(input.expectedDeploymentManifestSha256).success,
    "X_CAPTURE_RUNTIME_PINS_INVALID");
  const file = readXCapturePrivateFile(input.configurationPath, 64 * 1024);
  assert(file && xCaptureSha256(file.text) === input.expectedConfigurationSha256, "X_CAPTURE_CONFIG_IDENTITY_INVALID");
  let data: unknown; try { data = JSON.parse(file.text); } catch { throw new Error("X_CAPTURE_CONFIG_INVALID"); }
  const parsed = ConfigSchema.safeParse(data); assert(parsed.success, "X_CAPTURE_CONFIG_INVALID");
  const config = parsed.data;
  assert(!Object.hasOwn(config.producerTrust, "deploymentManifestSha256") && !Object.hasOwn(config.producerTrust, "publicKey"),
    "X_CAPTURE_CONFIG_CIRCULAR_OR_UNTRUSTED_BINDING");
  const key = publicKey(config.producerPublicKey), verifierKey = publicKey(config.verifier.publicKey);
  const trust = snapshotXCaptureTrust({ ...config.producerTrust, publicKey: key,
    deploymentManifestSha256: input.expectedDeploymentManifestSha256 } as XCaptureDeploymentTrust);
  assert(implementationHash(input.releaseAppRoot, config.adapterRelativePath) === trust.adapterSha256, "X_CAPTURE_ADAPTER_IDENTITY_INVALID");
  assertXCaptureArtifactRoot(config.artifactRoot);
  const unchanged = readXCapturePrivateFile(input.configurationPath, 64 * 1024);
  assert(unchanged?.identity === file.identity && xCaptureSha256(unchanged.text) === input.expectedConfigurationSha256,
    "X_CAPTURE_CONFIG_CHANGED");
  return Object.freeze({ trust, verifier: Object.freeze({ verifierId: config.verifier.verifierId,
    keyId: config.verifier.keyId, publicKey: verifierKey }), toolId: config.toolId,
  artifactFormat: config.artifactFormat, artifactRoot: Object.freeze(config.artifactRoot),
  configurationSha256: input.expectedConfigurationSha256 });
}
