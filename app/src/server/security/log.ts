type LogLevel = "debug" | "info" | "warn" | "error";

export const CLI_REASON_CODES = [
  "ADAPTER_DISABLED",
  "ADMIN_DISABLED",
  "APP_BIND_HOST",
  "APP_COMMAND_PROFILE",
  "APP_ENV",
  "APP_PORT",
  "APP_PUBLIC_ORIGIN",
  "CAPABILITY_DISABLED",
  "CAPABILITY_REGISTRY",
  "CLI_ARGUMENTS_FORBIDDEN",
  "CLI_INTERNAL_ERROR",
  "DB_OWNER",
  "DB_PATH",
  "DB_PERMISSIONS",
  "ENV_FILE",
  "ENV_FORBIDDEN",
  "ENV_UNKNOWN",
  "EXTERNAL_IO_FORBIDDEN",
  "FIXTURE_HASH",
  "FIXTURE_JSON",
  "FIXTURE_OWNER",
  "FIXTURE_PATH",
  "FIXTURE_POLICY",
  "FIXTURE_SCHEMA",
  "FIXTURE_SIZE",
  "HEALTH_DB_MISSING",
  "LEGACY_GATE_DRIFT",
  "LOCK_CONTENTION",
  "LOG_LEVEL",
  "MEDIA_DISABLED",
  "MIGRATION_DRIFT",
  "MIGRATION_LEDGER",
  "MIGRATION_ORDER",
  "MIGRATION_PRECLAIM",
  "MIGRATION_SCHEMA",
  "MIGRATION_VERSION",
  "NODE_VERSION",
  "PROVIDER_DISABLED",
  "PUBLISH_DISABLED",
  "RECEIPT_INTEGRITY",
  "SEED_DRIFT",
  "SEED_INSERT",
  "SEED_LEDGER_DRIFT",
  "SEED_LEDGER_MISSING",
  "SEED_POLICY",
  "SOURCE_BRIDGE_ORDER",
  "SOURCE_BRIDGE_PATH",
  "SOURCE_BRIDGE_POLICY",
  "SOURCE_BRIDGE_SCHEMA",
  "SOURCE_MAPPING_HASH",
  "SOURCE_MAPPING_PATH",
  "SOURCE_MAPPING_POLICY",
  "SOURCE_PROJECTION_HASH",
  "SOURCE_SCHEMA",
  "SOURCE_VALUE",
  "SQLITE_FAILURE",
  "SQLITE_INTEGRITY",
  "SQLITE_PRAGMA",
  "SQLITE_VERSION",
  "SUMMARY_DISABLED"
] as const;

export type CliReasonCode = (typeof CLI_REASON_CODES)[number];

export type SafeLogEvent =
  | {
      event: "verify_env";
      level?: LogLevel;
      status: "ok";
      capability: "fixture/mock/manual_only";
      externalCalls: 0;
    }
  | {
      event: "cli_failure";
      level?: LogLevel;
      status: "rejected";
      reasonCode: CliReasonCode;
      externalCalls: number;
    }
  | {
      event: "redacted_incident";
      level?: LogLevel;
      reasonCode: "redacted_fields";
      externalCalls?: 0;
    };

const CLI_REASON_CODE_SET = new Set<string>(CLI_REASON_CODES);
const LOG_LEVELS = new Set<unknown>(["debug", "info", "warn", "error"]);

export function isCliReasonCode(value: string): value is CliReasonCode {
  return CLI_REASON_CODE_SET.has(value);
}

function redactedIncident(input: Record<string, unknown>): SafeLogEvent {
  const incident: SafeLogEvent = {
    event: "redacted_incident",
    reasonCode: "redacted_fields"
  };
  if (LOG_LEVELS.has(input.level)) incident.level = input.level as LogLevel;
  if (input.externalCalls === 0 || input.externalCalls === false) incident.externalCalls = 0;
  return incident;
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(input).every((key) => allowedSet.has(key));
}

export function redactLogEvent(input: Record<string, unknown>): SafeLogEvent {
  const levelValid = input.level === undefined || LOG_LEVELS.has(input.level);
  if (input.event === "verify_env") {
    if (
      levelValid &&
      hasOnlyKeys(input, ["event", "level", "status", "capability", "externalCalls"]) &&
      input.status === "ok" &&
      input.capability === "fixture/mock/manual_only" &&
      (input.externalCalls === 0 || input.externalCalls === false)
    ) {
      return {
        event: "verify_env",
        ...(input.level === undefined ? {} : { level: input.level as LogLevel }),
        status: "ok",
        capability: "fixture/mock/manual_only",
        externalCalls: 0
      };
    }
    return redactedIncident(input);
  }
  if (input.event === "cli_failure") {
    if (
      levelValid &&
      hasOnlyKeys(input, ["event", "level", "status", "reasonCode", "externalCalls"]) &&
      input.status === "rejected" &&
      typeof input.reasonCode === "string" &&
      isCliReasonCode(input.reasonCode) &&
      typeof input.externalCalls === "number" && Number.isInteger(input.externalCalls) && input.externalCalls >= 0 && input.externalCalls <= 1_000_000
    ) {
      return {
        event: "cli_failure",
        ...(input.level === undefined ? {} : { level: input.level as LogLevel }),
        status: "rejected",
        reasonCode: input.reasonCode,
        externalCalls: input.externalCalls
      };
    }
    return redactedIncident(input);
  }
  if (
    input.event === "redacted_incident" &&
    levelValid &&
    hasOnlyKeys(input, ["event", "level", "reasonCode", "externalCalls"]) &&
    input.reasonCode === "redacted_fields" &&
    (input.externalCalls === undefined || input.externalCalls === 0 || input.externalCalls === false)
  ) {
    return redactedIncident(input);
  }
  return redactedIncident(input);
}

export type LogSink = (line: string) => void;

export function createRedactedLogger(sink: LogSink = (line) => console.error(line)) {
  const write = (level: LogLevel, event: Record<string, unknown>): void => {
    const safe = redactLogEvent({ ...event, level });
    sink(JSON.stringify(safe));
  };
  return {
    debug: (event: Record<string, unknown>) => write("debug", event),
    info: (event: Record<string, unknown>) => write("info", event),
    warn: (event: Record<string, unknown>) => write("warn", event),
    error: (event: Record<string, unknown>) => write("error", event)
  };
}
