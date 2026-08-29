import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { TWEET_INBOX_DROP_TEMPLATE } from "../src/server/tweet-inbox/drop.ts";
import { runManualXInboxCycle } from "../src/server/tweet-inbox/run.ts";
import { TweetInboxError, type XManualInboxReceipt } from "../src/server/tweet-inbox/types.ts";

const adminRoot = resolve(homedir(), "Library/Application Support/F1Plus1/Admin");
const deploymentPath = resolve(adminRoot, "deployment.json");
const inboxRoot = resolve(homedir(), "Library/Application Support/F1Plus1/XManualInbox");

export type XManualWriterGate = { ok: true } | { ok: false; reasonCode: "WRITER_NOT_ACTIVATED" };
export type XManualWriterNotActivatedReceipt = Omit<XManualInboxReceipt, "reasonCode"> & { reasonCode: "WRITER_NOT_ACTIVATED" };

export function xManualWriterGate(schemaTarget: number | null | undefined): XManualWriterGate {
  return schemaTarget === 8 ? { ok: true } : { ok: false, reasonCode: "WRITER_NOT_ACTIVATED" };
}

export function writerNotActivatedReceipt(): XManualWriterNotActivatedReceipt {
  return {
    schemaVersion: "x-manual-inbox-receipt-v1",
    profile: "x-manual-inbox-private",
    status: "failed",
    reasonCode: "WRITER_NOT_ACTIVATED",
    dropLineCount: 0,
    submittedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    externalCalls: 0,
    automaticReview: false,
    automaticPublish: false,
    media: "none"
  };
}

function safeFailure(error: unknown): XManualInboxReceipt {
  const reasonCode = error instanceof TweetInboxError && error.reasonCode === "X_MANUAL_URL_REJECTED"
    ? "X_MANUAL_URL_REJECTED"
    : "SQLITE_FAILURE";
  return {
    schemaVersion: "x-manual-inbox-receipt-v1",
    profile: "x-manual-inbox-private",
    status: "failed",
    reasonCode,
    dropLineCount: 0,
    submittedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    externalCalls: 0,
    automaticReview: false,
    automaticPublish: false,
    media: "none"
  };
}

function emit(receipt: XManualInboxReceipt | XManualWriterNotActivatedReceipt): void {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (receipt.status === "failed") process.exitCode = 1;
}

async function main(): Promise<void> {
  process.umask(0o077);
  if (process.argv.length !== 2) {
    emit(safeFailure(new TweetInboxError("CLI_ARGUMENTS_FORBIDDEN")));
    return;
  }

  const { readAdminDeploymentManifest } = await import("../src/server/admin-service/deployment.ts");
  const { adminRuntimeConfigFromDeployment, openReviewAdminDatabase } = await import("../src/server/admin-service/runtime.ts");
  const deployment = readAdminDeploymentManifest(deploymentPath);
  const gate = xManualWriterGate(deployment.reviewSchemaTarget);
  if (!gate.ok) {
    emit(writerNotActivatedReceipt());
    return;
  }

  const config = adminRuntimeConfigFromDeployment(deployment);
  const recheck = xManualWriterGate(config.reviewSchemaTarget ?? null);
  if (!recheck.ok) {
    emit(writerNotActivatedReceipt());
    return;
  }

  // The drop file is only created or modified once the x-manual writer is
  // gated active; a gated-off run keeps the working directory unwritten.
  mkdirSync(inboxRoot, { recursive: true, mode: 0o700 });
  chmodSync(inboxRoot, 0o700);
  const dropPath = join(inboxRoot, "drop.txt");
  if (!existsSync(dropPath)) {
    writeFileSync(dropPath, TWEET_INBOX_DROP_TEMPLATE, { encoding: "utf8", mode: 0o600 });
  }
  const dropText = readFileSync(dropPath, "utf8");

  if (config.releaseGate === undefined) throw new Error("X_MANUAL_WRITER_NOT_ACTIVATED");
  const opened = openReviewAdminDatabase({
    targetReleaseAppRoot: deployment.targetReleaseAppRoot,
    reviewDatabasePath: deployment.reviewDatabasePath,
    reviewDatabaseIdentity: deployment.reviewDatabaseIdentity,
    requiredSchemaVersion: 8,
    ownerProcess: "admin_http",
    releaseGate: config.releaseGate
  });
  if (opened.xManualRepository === null) throw new Error("X_MANUAL_WRITER_NOT_AVAILABLE");
  try {
    const result = runManualXInboxCycle({
      repository: opened.xManualRepository,
      dropText,
      nowIso: new Date().toISOString()
    });
    emit(result);
  } finally {
    try {
      opened.gateway?.close();
    } finally {
      opened.database.close();
    }
  }
}

try {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
  }
} catch (error) {
  emit(safeFailure(error));
}
