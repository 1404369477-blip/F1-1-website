import { closeSync, existsSync, lstatSync, openSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { z } from "zod";

import {
  AdminTrustedIdentityDeploymentSchema,
  adminDeploymentPaths,
  adminDeploymentStatus,
  PublicReadModeSchema,
  prepareAdminDeployment,
  renderAdminServicePlist
} from "../src/server/admin-service/deployment.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot } from "../src/server/runtime-config.ts";

const TrustedIdentitiesSchema = z.array(AdminTrustedIdentityDeploymentSchema).length(1);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("ADMIN_PREPARE_INPUT_MISSING");
  return value;
}

function requiredReceiptInteger(name: string): number {
  const value = required(name);
  if (!/^[0-9]+$/.test(value)) throw new Error("ADMIN_PREPARE_INPUT_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("ADMIN_PREPARE_INPUT_INVALID");
  return parsed;
}

function privateTemporaryOutput(path: string): string {
  const root = resolve(tmpdir());
  const output = resolve(path);
  const parent = resolve(dirname(output));
  const relativePath = relative(root, output);
  if (
    basename(output) !== "com.f1plus1.admin-service.plist" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    !existsSync(parent)
  ) {
    throw new Error("ADMIN_RENDER_PATH_INVALID");
  }
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || existsSync(output)) {
    throw new Error("ADMIN_RENDER_PATH_INVALID");
  }
  return output;
}

await runSafeCli(() => {
  process.umask(0o077);
  const arguments_ = process.argv.slice(2);
  const paths = adminDeploymentPaths(homedir());
  if (arguments_.length === 1 && arguments_[0] === "--status") {
    process.stdout.write(`${JSON.stringify({
      command: "admin:status",
      ...adminDeploymentStatus(paths.manifest),
      externalCalls: 0
    })}\n`);
    return;
  }
  if (arguments_.length === 2 && arguments_[0] === "--render-plist") {
    const output = privateTemporaryOutput(arguments_[1]);
    const value = renderAdminServicePlist({
      nodePath: process.execPath,
      targetReleaseAppRoot: appRoot,
      manifestPath: paths.manifest,
      stdoutLog: paths.stdoutLog,
      stderrLog: paths.stderrLog
    });
    const descriptor = openSync(output, "wx", 0o600);
    try { writeFileSync(descriptor, value, "utf8"); }
    finally { closeSync(descriptor); }
    process.stdout.write(`${JSON.stringify({
      command: "admin:render-plist",
      status: "rendered-not-installed",
      externalCalls: 0
    })}\n`);
    return;
  }
  if (arguments_.length !== 0) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  let identities: unknown;
  try { identities = JSON.parse(required("F1_ADMIN_TRUSTED_IDENTITIES_JSON")) as unknown; }
  catch { throw new Error("ADMIN_PREPARE_INPUT_INVALID"); }
  const prepared = prepareAdminDeployment({
    home: homedir(),
    targetReleaseAppRoot: appRoot,
    reviewDatabasePath: required("F1_ADMIN_REVIEW_DATABASE_PATH"),
    reviewDatabaseExpectedDev: requiredReceiptInteger("F1_ADMIN_REVIEW_DATABASE_DEV"),
    reviewDatabaseExpectedIno: requiredReceiptInteger("F1_ADMIN_REVIEW_DATABASE_INO"),
    nodePath: process.execPath,
    canonicalOrigin: required("F1_ADMIN_CANONICAL_ORIGIN"),
    rpName: "F1+1 Admin",
    operatorRef: required("F1_ADMIN_OPERATOR_REF"),
    tailscaleAppCapabilityId: required("F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID"),
    trustedIdentities: TrustedIdentitiesSchema.parse(identities),
    projectionSigningKeyId: required("F1_ADMIN_PROJECTION_SIGNING_KEY_ID"),
    projectionSigningPrivateKeyPath: resolve(required("F1_ADMIN_PROJECTION_SIGNING_PRIVATE_KEY_PATH")),
    projectionVerifyKeyPath: resolve(required("F1_ADMIN_PROJECTION_VERIFY_KEY_PATH")),
    publicReadMode: PublicReadModeSchema.parse(required("F1_ADMIN_PUBLIC_READ_MODE")),
    syntheticRollbackRelease: required("F1_ADMIN_SYNTHETIC_ROLLBACK_RELEASE"),
    syntheticRollbackHash: required("F1_ADMIN_SYNTHETIC_ROLLBACK_HASH"),
    projectionSenderServiceIdentity: required("F1_ADMIN_PROJECTION_SENDER_SERVICE_IDENTITY"),
    projectionReceiverServiceIdentity: required("F1_ADMIN_PROJECTION_RECEIVER_SERVICE_IDENTITY")
  });
  process.stdout.write(`${JSON.stringify({
    command: "admin:install-macos",
    status: "prepared-disabled-not-loaded",
    label: "com.f1plus1.admin-service",
    manifestSha256: prepared.manifestSha256,
    plistSha256: prepared.plistSha256,
    bootstrapTokenPath: prepared.bootstrapTokenPath,
    bootstrapExpiresAt: prepared.bootstrapExpiresAt,
    externalCalls: 0
  })}\n`);
});
