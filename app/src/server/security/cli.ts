import { ConfigError } from "../config/env.ts";
import {
  isCliReasonCode,
  redactLogEvent,
  type CliReasonCode
} from "./log.ts";

const ERROR_CODE_PATTERN = /^([A-Z][A-Z0-9_]{2,63})(?::|$)/;

function safeReasonCode(error: unknown): CliReasonCode {
  if (error instanceof ConfigError && isCliReasonCode(error.code)) return error.code;
  if (error instanceof Error) {
    const candidate = ERROR_CODE_PATTERN.exec(error.message)?.[1];
    if (candidate && isCliReasonCode(candidate)) return candidate;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_")
  ) {
    return "SQLITE_FAILURE";
  }
  return "CLI_INTERNAL_ERROR";
}

export function assertNoAdditionalCliArguments(arguments_: readonly string[]): void {
  if (arguments_.length !== 0) {
    throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "additional command arguments are disabled");
  }
}

export async function runSafeCli(main: () => void | Promise<void>, externalCallCount: () => number = () => 0): Promise<void> {
  try {
    await main();
  } catch (error) {
    const failure = redactLogEvent({
      event: "cli_failure",
      status: "rejected",
      reasonCode: safeReasonCode(error),
      externalCalls: externalCallCount()
    });
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}
