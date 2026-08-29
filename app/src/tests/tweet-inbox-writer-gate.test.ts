import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  xManualWriterGate,
  writerNotActivatedReceipt
} from "../../scripts/tweet-inbox-once.ts";

const FORBIDDEN = ["child_process", "node:http", "node:https", "node:net", "node:tls", "node:dgram", "launchctl"];

describe("B2a tweet-inbox writer gate", () => {
  test("schema8 opens the writer gate; schema10 or null fails closed", () => {
    expect(xManualWriterGate(8)).toEqual({ ok: true });
    expect(xManualWriterGate(10)).toEqual({ ok: false, reasonCode: "WRITER_NOT_ACTIVATED" });
    expect(xManualWriterGate(null)).toEqual({ ok: false, reasonCode: "WRITER_NOT_ACTIVATED" });
    expect(xManualWriterGate(undefined)).toEqual({ ok: false, reasonCode: "WRITER_NOT_ACTIVATED" });
  });

  test("writerNotActivatedReceipt is a structured zero-write failure", () => {
    const receipt = writerNotActivatedReceipt();
    expect(receipt.status).toBe("failed");
    expect(receipt.reasonCode).toBe("WRITER_NOT_ACTIVATED");
    expect(receipt.dropLineCount).toBe(0);
    expect(receipt.submittedCount).toBe(0);
    expect(receipt.duplicateCount).toBe(0);
    expect(receipt.invalidCount).toBe(0);
    expect(receipt.externalCalls).toBe(0);
  });

  test("tweet-inbox-once uses the admin opener, no direct DB open and no network import", () => {
    const source = readFileSync(fileURLToPath(new URL("../../scripts/tweet-inbox-once.ts", import.meta.url)), "utf8");
    for (const forbidden of FORBIDDEN) {
      expect(source.includes(`from "${forbidden}"`)).toBe(false);
      expect(source.includes(`from '${forbidden}'`)).toBe(false);
    }
    expect(source).not.toContain("new DatabaseSync(");
    expect(source).not.toContain("inspectExistingPrivateDatabase");
    expect(source).not.toContain("assertQuiesceLeaseAbsent");
    expect(source).not.toContain(".sqlite");
    expect(source).toContain("readAdminDeploymentManifest");
    expect(source).toContain("adminRuntimeConfigFromDeployment");
    expect(source).toContain("openReviewAdminDatabase");
    expect(source).toContain("runManualXInboxCycle");
    expect(source).toContain("requiredSchemaVersion: 8");
    expect(source).toContain('ownerProcess: "admin_http"');
    expect(source).toContain("releaseGate: config.releaseGate");
    expect(source).toContain("opened.gateway?.close()");
    expect(source).toContain("opened.database.close()");
  });
});
