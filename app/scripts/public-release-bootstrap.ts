import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync
} from "node:fs";
import { basename, resolve } from "node:path";

import { ConfigError } from "../src/server/config/env.ts";
import {
  CLOSED_RECEIPT_PATHS,
  generateClosedReceipt,
  type ClosedProfileId
} from "../src/server/db/closed-receipt.ts";
import { createPublicMultimediaCanonical } from "../src/server/db/public-multimedia-synthetic.ts";
import { M3_PROFILE_ID, PUBLIC_PROFILE_ID } from "../src/server/db/profile.ts";
import { assertRuntimeReady } from "../src/server/health.ts";
import { runReceiptIntegrityBoundary, runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, loadRuntimeConfig, projectRoot } from "../src/server/runtime-config.ts";

type BootstrapAsset = {
  profileId: ClosedProfileId;
  sourceRelativePath: string;
  targetRelativePath: string;
  sha256: string;
  size: number;
};

const ASSETS: readonly BootstrapAsset[] = [
  {
    profileId: M3_PROFILE_ID,
    sourceRelativePath: "deployment/bootstrap/legacy/f1plus1.sqlite",
    targetRelativePath: "app/.local/f1plus1.sqlite",
    sha256: "df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0",
    size: 290_816
  },
  {
    profileId: PUBLIC_PROFILE_ID,
    sourceRelativePath: "deployment/bootstrap/legacy/f1plus1-public-synthetic.sqlite",
    targetRelativePath: "app/.local/f1plus1-public-synthetic.sqlite",
    sha256: "24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041",
    size: 507_904
  }
] as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertPrivateRegularFile(path: string, expectedSha256: string, expectedSize?: number): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || uid === undefined || stat.uid !== uid ||
    (stat.mode & 0o077) !== 0 || (expectedSize !== undefined && stat.size !== expectedSize) ||
    sha256(path) !== expectedSha256
  ) {
    throw new ConfigError("RELEASE_BOOTSTRAP_ASSET", "release database asset identity changed");
  }
}

function assertTrackedAsset(asset: BootstrapAsset): string {
  const path = resolve(projectRoot, asset.sourceRelativePath);
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    realpathSync(path) !== path || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
    uid === undefined || stat.uid !== uid || (stat.mode & 0o022) !== 0 ||
    stat.size !== asset.size || sha256(path) !== asset.sha256
  ) {
    throw new ConfigError("RELEASE_BOOTSTRAP_ASSET", "tracked bootstrap asset identity changed");
  }
  return path;
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function installAsset(asset: BootstrapAsset, localRoot: string): boolean {
  const source = assertTrackedAsset(asset);
  const target = resolve(projectRoot, asset.targetRelativePath);
  for (const suffix of ["-wal", "-shm", "-journal", ".journal"]) {
    if (existsSync(`${target}${suffix}`)) {
      throw new ConfigError("RELEASE_BOOTSTRAP_SIDECAR", "legacy database has an open or unknown sidecar");
    }
  }
  if (existsSync(target)) {
    assertPrivateRegularFile(target, asset.sha256, asset.size);
    return false;
  }

  const candidate = resolve(localRoot, `.bootstrap-${basename(target)}-${process.pid}`);
  if (existsSync(candidate)) throw new ConfigError("RELEASE_BOOTSTRAP_TEMP", "bootstrap candidate already exists");
  try {
    copyFileSync(source, candidate, fsConstants.COPYFILE_EXCL);
    chmodSync(candidate, 0o600);
    const descriptor = openSync(candidate, fsConstants.O_RDONLY);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    assertPrivateRegularFile(candidate, asset.sha256, asset.size);
    linkSync(candidate, target);
    unlinkSync(candidate);
    fsyncDirectory(localRoot);
    assertPrivateRegularFile(target, asset.sha256, asset.size);
    return true;
  } finally {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

function refresh(profileId: ClosedProfileId): ReturnType<typeof generateClosedReceipt> {
  return runReceiptIntegrityBoundary(() => generateClosedReceipt(profileId, { appRoot, projectRoot }));
}

await runSafeCli(() => {
  process.umask(0o077);
  const localRoot = resolve(appRoot, ".local");
  mkdirSync(localRoot, { recursive: true, mode: 0o700 });
  const localStat = lstatSync(localRoot);
  const uid = process.getuid?.();
  if (!localStat.isDirectory() || localStat.isSymbolicLink() || uid === undefined || localStat.uid !== uid) {
    throw new ConfigError("RELEASE_BOOTSTRAP_ROOT", "app local root is not an owner-controlled directory");
  }
  chmodSync(localRoot, 0o700);

  const installed = Object.fromEntries(ASSETS.map((asset) => [asset.profileId, installAsset(asset, localRoot)]));
  const m3 = refresh(M3_PROFILE_ID);
  const publicSynthetic = refresh(PUBLIC_PROFILE_ID);
  const config = loadRuntimeConfig();
  if (config.dataProfile !== "public-multimedia-synthetic") {
    throw new ConfigError("RELEASE_PROFILE", "public multimedia profile is required for release bootstrap");
  }
  const multimedia = createPublicMultimediaCanonical(config, appRoot, projectRoot);
  const runtime = assertRuntimeReady({ config });
  const multimediaPath = resolve(appRoot, config.dbPath);

  process.stdout.write(`${JSON.stringify({
    command: "release:bootstrap",
    status: "ready",
    installed,
    receipts: {
      m3: CLOSED_RECEIPT_PATHS.m3,
      publicSynthetic: CLOSED_RECEIPT_PATHS.public,
      publicData: CLOSED_RECEIPT_PATHS.publicData,
      m3Sha256: m3.dbReceipt.receiptSha256,
      publicSyntheticSha256: publicSynthetic.dbReceipt.receiptSha256
    },
    multimedia: {
      profileId: multimedia.profileId,
      databaseSha256: sha256(multimediaPath),
      rowCounts: multimedia.rowCounts
    },
    runtime,
    externalCalls: 0
  })}\n`);
});
