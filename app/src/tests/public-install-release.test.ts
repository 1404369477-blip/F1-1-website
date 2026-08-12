import { generateKeyPairSync, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PUBLIC_APP_LABEL,
  PUBLIC_QUICK_TUNNEL_LABEL,
  preparePublicMacAgents
} from "../../scripts/install-macos-public-beta-core.ts";
import {
  buildAdminReleaseManifest,
  canonicalAdminReleaseJson
} from "../server/admin-service/release-manifest.ts";
import {
  publicProjectionDeploymentPaths,
  PUBLIC_PROJECTION_SERVICE_LABEL
} from "../server/public/deployment.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(projectRoot, "app");
const targetNodePath = "/Users/f1admin/.local/node-v24.18.0-darwin-arm64/bin/node";
const temporaryRoots: string[] = [];

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture(): Readonly<{
  home: string;
  rollbackRoot: string;
  environment: Record<string, string>;
  livePlists: readonly string[];
  oldBytes: readonly Buffer[];
}> {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "TASK-20260812-0E594C-public-prepare-"));
  chmodSync(home, 0o700);
  temporaryRoots.push(home);
  const publicPaths = publicProjectionDeploymentPaths(home);
  const verifyKeyPath = join(publicPaths.root, "verify.pem");
  mkdirSync(dirname(verifyKeyPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(verifyKeyPath), 0o700);
  const keys = generateKeyPairSync("ed25519");
  writeFileSync(verifyKeyPath, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  chmodSync(verifyKeyPath, 0o600);
  const manifest = buildAdminReleaseManifest(appRoot, projectRoot, targetNodePath, process.execPath);
  const manifestRoot = join(home, "release");
  mkdirSync(manifestRoot, { mode: 0o700 });
  chmodSync(manifestRoot, 0o700);
  const manifestPath = join(manifestRoot, "manifest.json");
  const manifestBytes = `${canonicalAdminReleaseJson(manifest)}\n`;
  writeFileSync(manifestPath, manifestBytes, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  const rollbackRoot = join(home, "synthetic-rollback-app");
  mkdirSync(join(rollbackRoot, ".next"), { recursive: true, mode: 0o700 });
  mkdirSync(join(rollbackRoot, ".local"), { recursive: true, mode: 0o700 });
  chmodSync(rollbackRoot, 0o700);
  chmodSync(join(rollbackRoot, ".next"), 0o700);
  chmodSync(join(rollbackRoot, ".local"), 0o700);
  writeFileSync(join(rollbackRoot, ".next/BUILD_ID"), readFileSync(join(appRoot, ".next/BUILD_ID")), { mode: 0o600 });
  writeFileSync(
    join(rollbackRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite"),
    readFileSync(join(appRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite")),
    { mode: 0o600 }
  );
  const livePlists = [
    join(home, "Library/LaunchAgents", `${PUBLIC_APP_LABEL}.plist`),
    join(home, "Library/LaunchAgents", `${PUBLIC_QUICK_TUNNEL_LABEL}.plist`),
    publicPaths.plist
  ] as const;
  const oldBytes = livePlists.map((path, index) => Buffer.from(`old-plist-${index}\n`));
  for (let index = 0; index < livePlists.length; index += 1) {
    mkdirSync(dirname(livePlists[index]), { recursive: true, mode: 0o700 });
    chmodSync(dirname(livePlists[index]), 0o700);
    writeFileSync(livePlists[index], oldBytes[index], { mode: 0o600 });
    chmodSync(livePlists[index], 0o600);
  }
  return Object.freeze({
    home,
    environment: {
      F1_RELEASE_MANIFEST_PATH: manifestPath,
      F1_RELEASE_MANIFEST_SHA256: sha256(manifestBytes),
      F1_PUBLIC_READ_MODE: "public-real-snapshot",
      F1_PUBLIC_SIGNING_KEY_ID: "f1plus1-test-key",
      F1_PUBLIC_VERIFY_KEY_PATH: verifyKeyPath,
      F1_PUBLIC_PROJECTION_SENDER_SERVICE_IDENTITY: "sender-test",
      F1_PUBLIC_PROJECTION_RECEIVER_SERVICE_IDENTITY: "receiver-test",
      F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT: rollbackRoot,
      F1_PUBLIC_SYNTHETIC_ROLLBACK_RELEASE: readFileSync(join(rollbackRoot, ".next/BUILD_ID"), "utf8").trim(),
      F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH: sha256(readFileSync(join(rollbackRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite")))
    },
    rollbackRoot,
    livePlists,
    oldBytes: Object.freeze(oldBytes)
  });
}

function prepare(value: ReturnType<typeof fixture>, hooks: Readonly<{
  beforeCommit?: () => void;
  afterCommit?: (index: number) => void;
}> = {}) {
  return preparePublicMacAgents({
    appRoot,
    projectRoot,
    home: value.home,
    nodePath: targetNodePath,
    localNodePath: process.execPath,
    environment: value.environment,
    ...hooks
  });
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("public prepare release anchor and atomic disabled plists", () => {
  it("rejects an incorrect external SHA before touching live plists", () => {
    const value = fixture();
    value.environment.F1_RELEASE_MANIFEST_SHA256 = "0".repeat(64);
    expect(() => prepare(value)).toThrow(/external expected SHA/);
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("leaves all live plists byte-identical when full staging fails", () => {
    const value = fixture();
    expect(() => prepare(value, { beforeCommit: () => { throw new Error("STAGE_FAIL"); } })).toThrow("STAGE_FAIL");
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("rejects a rollback anchor mismatch before touching live plists", () => {
    const value = fixture();
    value.environment.F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH = "0".repeat(64);
    expect(() => prepare(value)).toThrow(/PUBLIC_ROLLBACK_ANCHOR/);
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("restores every old plist when the commit is interrupted", () => {
    const value = fixture();
    expect(() => prepare(value, { afterCommit: (index) => { if (index === 4) throw new Error("COMMIT_FAIL"); } })).toThrow("COMMIT_FAIL");
    value.livePlists.forEach((path, index) => expect(readFileSync(path)).toEqual(value.oldBytes[index]));
  }, 30_000);

  it("prepares exactly three disabled plists without launchctl", () => {
    const value = fixture();
    const result = prepare(value);
    expect(result.plistPaths).toEqual(value.livePlists);
    expect(result.plistPaths.map((path) => path.endsWith(`${PUBLIC_PROJECTION_SERVICE_LABEL}.plist`))).toEqual([false, false, true]);
    for (const path of result.plistPaths) {
      const plist = readFileSync(path, "utf8");
      expect(plist).toContain("<key>RunAtLoad</key><false/>");
      expect(plist).toContain("<key>KeepAlive</key><false/>");
      expect(plist).not.toContain("launchctl");
      expect(plist).toContain(appRoot);
      expect(plist).not.toContain(value.rollbackRoot);
      expect(existsSync(path)).toBe(true);
    }
    const publicPaths = publicProjectionDeploymentPaths(value.home);
    const manifest = JSON.parse(readFileSync(publicPaths.manifest, "utf8")) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe("public-projection-deployment-v2");
    expect(manifest.targetReleaseAppRoot).toBe(appRoot);
    expect(manifest.syntheticRollbackAppRoot).toBe(value.rollbackRoot);
    expect(manifest.publicDataRoot).toBe(publicPaths.root);
    expect(readFileSync(value.livePlists[0], "utf8")).toContain(resolve(publicPaths.root, "logs"));
  }, 30_000);
});
