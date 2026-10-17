/**
 * Structured logger using Pino.
 *
 * - Production: JSON output (parse with pino-pretty or forward to Datadog/Logtail)
 * - Development: pretty-printed with colors
 *
 * Usage:
 *   import { logger } from "../logger";
 *   logger.info({ workspaceId, event: "sync.start" }, "Jira sync started");
 *   logger.error({ err }, "Sync failed");
 */

import pino from "pino";

const isDev = (process.env.NODE_ENV ?? "development") === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        // Production: structured JSON — forward to your log aggregator
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

/** Create a child logger scoped to a module */
export function childLogger(module: string, extra?: Record<string, unknown>) {
  return logger.child({ module, ...extra });
}

/** Log an error with stack trace — safe to call with unknown errors */
export function logError(log: pino.Logger, msg: string, err: unknown, extra?: Record<string, unknown>) {
  log.error(
    {
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      ...extra,
    },
    msg,
  );
}
