import { describe, expect, it } from "vitest";

import { assertRawAdminRequest } from "../server/source-management/security";
import { AdminError } from "../server/source-management/types";

const origin = "http://127.0.0.1:3019";

function request(target: string, method = "POST") {
  return {
    rawHeaders: ["Host", "127.0.0.1:3019", "Origin", origin],
    socket: { remoteAddress: "127.0.0.1" },
    url: target,
    method,
    httpVersion: "1.1"
  };
}

function expectRawTargetDenied(target: string): void {
  try {
    assertRawAdminRequest(request(target) as never, origin, true);
    throw new Error("EXPECTED_RAW_TARGET_DENIAL");
  } catch (error) {
    expect(error).toBeInstanceOf(AdminError);
    expect((error as AdminError).reasonCode).toBe("ADMIN_HOST_DENIED");
    expect((error as AdminError).status).toBe(403);
  }
}

describe("source-management raw request-target gate", () => {
  it.each([
    "/api/admin/./session",
    "/api/admin/alias/../session",
    "/./api/admin/session",
    "/../api/admin/session",
    "/api/admin/%2e/session",
    "/api/admin/%2E/session",
    "/api/admin/%2e%2e/session",
    "/api/admin/%2E%2e/session",
    "/api/admin/.%2e/session",
    "/api/admin/%2e./session",
    "/api/admin%2fsession",
    "/api/admin%2Fsession",
    "/api/admin%5csession",
    "/api/admin%5Csession",
    "/api/admin\\session",
    "/api/admin/%61ession",
    "http://127.0.0.1:3019/api/admin/session",
    "//127.0.0.1:3019/api/admin/session"
  ])("rejects the raw alias before URL normalization: %s", (target) => {
    expectRawTargetDenied(target);
  });

  it("preserves legal session and list targets while leaving query parsing downstream", () => {
    const session = assertRawAdminRequest(request("/api/admin/session") as never, origin, true);
    expect(session.path).toBe("/api/admin/session");

    const list = assertRawAdminRequest(
      request("/api/admin/sources?platform=x%2Dfeed&limit=100", "GET") as never,
      origin,
      true
    );
    expect(list.path).toBe("/api/admin/sources");
  });
});
