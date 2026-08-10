import type { PublicReasonCodeV1 } from "./types.ts";

export class PublicReadError extends Error {
  readonly reasonCode: PublicReasonCodeV1;

  constructor(reasonCode: PublicReasonCodeV1) {
    super(reasonCode);
    this.name = "PublicReadError";
    this.reasonCode = reasonCode;
  }
}

export function asPublicReadError(error: unknown): PublicReadError {
  if (error instanceof PublicReadError) return error;
  const candidate = error as { code?: unknown; errcode?: unknown; message?: unknown };
  if (
    candidate.code === "ERR_SQLITE_ERROR" &&
    (candidate.errcode === 5 || candidate.errcode === 6 || /(?:busy|locked)/i.test(String(candidate.message)))
  ) {
    return new PublicReadError("PUBLIC_DB_BUSY");
  }
  const message = String(candidate.message ?? "");
  if (/PUBLIC_SEED_DRIFT: public entity counts|PUBLIC_SEED_DRIFT: .* is missing|PUBLIC_SEED_PARTIAL/.test(message)) {
    return new PublicReadError("PUBLIC_READ_INCOMPLETE_CHAIN");
  }
  if (/PUBLIC_ROOT_DRIFT|PUBLIC_FIXTURE_|PUBLIC_MULTIMEDIA_(?:FIXTURE|GRAPH|MANIFEST|ARTIFACT)|MIGRATION_|PROFILE_MIX|PROFILE_PATH_MIX|RECEIPT_/.test(message)) {
    return new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
  }
  if (/PUBLIC_SEED_DRIFT|PROFILE_LEDGER_|PUBLIC_READ_|SEED_DRIFT/.test(message)) {
    return new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  return new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
}
