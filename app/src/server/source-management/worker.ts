import type { SourceManagementRepository } from "./repository.ts";

export function runSourceActivationWorker(
  repository: SourceManagementRepository,
  outcome: "success" | "MOCK_TIMEOUT" | "MOCK_TERMINAL" = "success"
): { processed: boolean; externalCalls: 0 } {
  const result = repository.runActivationWorker(outcome);
  return { processed: result !== null, externalCalls: 0 };
}
