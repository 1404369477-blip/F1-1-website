import type { NoEgressGuard } from "../vs1/no-egress.ts";
import { appRoot, loadRuntimeConfig, projectRoot } from "../runtime-config.ts";
import { openSourceManagementDatabase } from "../db/source-management-synthetic.ts";
import { SourceManagementRepository } from "./repository.ts";
import { AdminSessionStore } from "./security.ts";
import { AdminError } from "./types.ts";

type RuntimeState = {
  closeDatabase(): void;
  guard: NoEgressGuard;
  repository: SourceManagementRepository;
  sessions: AdminSessionStore;
};

let state: RuntimeState | undefined;

export function initializeSourceManagementRuntime(guard: NoEgressGuard): RuntimeState {
  if (state) return state;
  const config = loadRuntimeConfig();
  if (config.dataProfile !== "source-management-synthetic" || guard.externalCalls !== 0) {
    throw new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
  }
  const sessions = new AdminSessionStore();
  const opened = openSourceManagementDatabase(config, appRoot, projectRoot);
  state = {
    closeDatabase: opened.close,
    guard,
    repository: new SourceManagementRepository(opened.database, config, appRoot, projectRoot),
    sessions
  };
  return state;
}

export function sourceManagementRuntime(): RuntimeState {
  if (!state || state.guard.externalCalls !== 0) throw new AdminError("ADMIN_NO_EGRESS_REQUIRED", 503);
  return state;
}

export function closeSourceManagementRuntime(): void {
  if (!state) return;
  const current = state;
  state = undefined;
  current.closeDatabase();
  current.guard.restore();
}
