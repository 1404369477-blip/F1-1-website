import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "../db/database.ts";
import { withSqliteAuthorizerContext } from "./authorizer.ts";
import type { EgressClass, Phase } from "./gateway.ts";

export const PHASE_BATCH_LIMIT = 20 as const;
export const PHASE_EPOCH_START = 1 as const;

export type PhaseAction = "enter_backlog" | "enter_live" | "pause" | "disable";
export type PhaseSnapshot = Readonly<{
  phase: Phase;
  epoch: number;
  cutoffAt: string | null;
  batchLimit: 20;
  globalStopState: "clear" | "stopped";
  emergencyStopState: "clear" | "stopped";
  recoveryState: "fenced" | "restoring" | "verifying" | "ready" | "failed";
}>;
export type PhaseEgressDecision = Readonly<{ allowed: boolean; reasonCode: string }>;
export type BacklogItem = Readonly<{ publicationId: string; candidateId: string | null; approvedAt: string; epoch: number }>;

function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function rowValue(row: Record<string, unknown>, key: string): unknown { assert(Object.prototype.hasOwnProperty.call(row, key), "PHASE_COLUMN_MISSING"); return row[key]; }
function stringValue(value: unknown, code: string): string { assert(typeof value === "string", code); return value; }
function intValue(value: unknown, code: string): number { assert(Number.isSafeInteger(Number(value)), code); return Number(value); }
function phaseValue(value: unknown): Phase { assert(value === "disabled" || value === "backlog" || value === "live" || value === "paused", "PHASE_INVALID"); return value; }

/** Derive the 0007 phase view from the frozen internal_control singleton. */
export function readPhaseSnapshot(database: DatabaseSync): PhaseSnapshot {
  const row = database.prepare("SELECT phase,version,updated_at,global_stop_state,emergency_stop_state,recovery_state FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
  assert(row !== undefined, "PHASE_CONTROL_MISSING");
  const phase = phaseValue(rowValue(row, "phase"));
  const epoch = intValue(rowValue(row, "version"), "PHASE_EPOCH_INVALID");
  const updatedAt = stringValue(rowValue(row, "updated_at"), "PHASE_CUTOFF_INVALID");
  assert(Number.isFinite(Date.parse(updatedAt)), "PHASE_CUTOFF_INVALID");
  const snapshot = Object.freeze({
    phase,
    epoch,
    cutoffAt: phase === "disabled" ? null : updatedAt,
    batchLimit: PHASE_BATCH_LIMIT,
    globalStopState: rowValue(row, "global_stop_state") as PhaseSnapshot["globalStopState"],
    emergencyStopState: rowValue(row, "emergency_stop_state") as PhaseSnapshot["emergencyStopState"],
    recoveryState: rowValue(row, "recovery_state") as PhaseSnapshot["recoveryState"]
  });
  assertPhaseSnapshot(snapshot);
  return snapshot;
}

export function assertPhaseSnapshot(snapshot: PhaseSnapshot): void {
  assert(snapshot.batchLimit === 20, "PHASE_BATCH_LIMIT_INVALID");
  assert(snapshot.epoch >= PHASE_EPOCH_START, "PHASE_EPOCH_INVALID");
  assert(snapshot.phase === "disabled" ? snapshot.cutoffAt === null : snapshot.cutoffAt !== null, "PHASE_CUTOFF_INVALID");
  assert(snapshot.globalStopState === "clear" || snapshot.globalStopState === "stopped", "GLOBAL_STOP_INVALID");
  assert(snapshot.emergencyStopState === "clear" || snapshot.emergencyStopState === "stopped", "EMERGENCY_STOP_INVALID");
  assert(["fenced", "restoring", "verifying", "ready", "failed"].includes(snapshot.recoveryState), "RECOVERY_STATE_INVALID");
}

export function phaseTransitionAllowed(current: Phase, action: PhaseAction): boolean {
  if (action === "enter_backlog") return current === "disabled" || current === "paused";
  if (action === "enter_live") return current === "backlog" || current === "paused";
  if (action === "pause") return current === "disabled" || current === "backlog" || current === "live";
  return current === "paused";
}

export function phaseTransitionAllowedForSnapshot(snapshot: PhaseSnapshot, action: PhaseAction): boolean {
  assertPhaseSnapshot(snapshot);
  if (!phaseTransitionAllowed(snapshot.phase, action)) return false;
  if ((action === "enter_backlog" || action === "enter_live") && snapshot.recoveryState !== "ready") return false;
  if (snapshot.globalStopState !== "clear" || snapshot.emergencyStopState !== "clear") return false;
  return true;
}

/**
 * Phase egress policy.  Disabled and paused are hard zero-egress states;
 * backlog is bounded to the already queued private projection path.  Live is
 * the only phase that opens provider/model/RSS/backup egress.
 */
export function phaseEgressDecision(phase: Phase, egressClass: EgressClass): PhaseEgressDecision {
  if (egressClass === "none") return Object.freeze({ allowed: true, reasonCode: "NO_EGRESS" });
  if (phase === "live") return Object.freeze({ allowed: true, reasonCode: "PHASE_LIVE" });
  if (phase === "backlog" && egressClass === "projection_private") return Object.freeze({ allowed: true, reasonCode: "PHASE_BACKLOG_BOUNDED_PROJECTION" });
  return Object.freeze({ allowed: false, reasonCode: phase === "disabled" ? "PHASE_DISABLED" : phase === "paused" ? "PHASE_PAUSED" : "PHASE_BACKLOG_EGRESS_BLOCKED" });
}

export function assertPhaseAllowsExternal(snapshot: PhaseSnapshot, egressClass: EgressClass): void {
  assertPhaseSnapshot(snapshot);
  const decision = phaseEgressDecision(snapshot.phase, egressClass);
  assert(decision.allowed, decision.reasonCode);
  assert(snapshot.globalStopState === "clear" && snapshot.emergencyStopState === "clear", "GLOBAL_OR_EMERGENCY_STOPPED");
  assert(snapshot.recoveryState === "ready", "RECOVERY_NOT_READY");
}

/** Both control and collector paths use the same SQLite writer lock boundary. */
export function withPhaseControlLock<T>(database: DatabaseSync, callback: () => T): T {
  return withImmediateTransaction(database, callback);
}
export function withCollectorClaimLock<T>(database: DatabaseSync, callback: () => T): T {
  return withImmediateTransaction(database, callback);
}

/**
 * Select an oldest-first bounded backlog snapshot while holding the same
 * BEGIN IMMEDIATE lock as phase control.  Claim/update is deliberately left
 * to a gateway operation; this read cannot create an outbox or call a
 * provider.
 */
export function selectBacklogBatch(database: DatabaseSync): readonly BacklogItem[] {
  return withCollectorClaimLock(database, () => {
    const snapshot = readPhaseSnapshot(database);
    assertPhaseSnapshot(snapshot);
    assert(snapshot.phase === "backlog", "PHASE_BACKLOG_REQUIRED");
    assert(snapshot.globalStopState === "clear" && snapshot.emergencyStopState === "clear", "GLOBAL_OR_EMERGENCY_STOPPED");
    assert(snapshot.recoveryState === "ready", "RECOVERY_NOT_READY");
    // The 0007 schema predates a dedicated cutoff column.  updated_at is the
    // durable phase transition timestamp and therefore the only admissible
    // cutoff source without changing the frozen schema identity.
    const rows = database.prepare(
      "SELECT publication_id,NULL AS candidate_id,updated_at AS approved_at FROM publication WHERE publication_status='queued' AND updated_at<=? ORDER BY updated_at ASC,publication_id ASC LIMIT 20"
    ).all(snapshot.cutoffAt) as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((row) => Object.freeze({
      publicationId: stringValue(row.publication_id, "BACKLOG_PUBLICATION_ID_INVALID"),
      candidateId: row.candidate_id === null ? null : stringValue(row.candidate_id, "BACKLOG_CANDIDATE_ID_INVALID"),
      approvedAt: stringValue(row.approved_at, "BACKLOG_CUTOFF_INVALID"),
      epoch: snapshot.epoch
    })));
  });
}

export function withAuthorizerPhaseControlLock<T>(database: DatabaseSync, callback: () => T): T {
  return withSqliteAuthorizerContext(database, "phase_control", () => withPhaseControlLock(database, callback));
}
