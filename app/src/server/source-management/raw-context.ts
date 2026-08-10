import { AsyncLocalStorage } from "node:async_hooks";

import type { RawAdminContext } from "./security.ts";
import { AdminError } from "./types.ts";

const storage = new AsyncLocalStorage<RawAdminContext>();

export function runWithRawAdminContext<T>(context: RawAdminContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function requireRawAdminContext(): RawAdminContext {
  const context = storage.getStore();
  if (!context) throw new AdminError("ADMIN_HOST_DENIED", 403);
  return context;
}
