/**
 * Production-grade database error handling and translation.
 *
 * Translates low-level PostgreSQL SQLSTATE codes into structured, typed,
 * user-friendly domain errors so sensitive DB internals, table schemas,
 * and connection strings are never leaked to clients.
 */

import { UserError } from "../errors";

export interface ClassifiedDbError {
  isDbError: boolean;
  isTransient: boolean;
  isUniqueViolation: boolean;
  isForeignKeyViolation: boolean;
  isDeadlock: boolean;
  isTimeout: boolean;
  sqlState?: string;
  detail?: string;
  userMessage: string;
}

/**
 * Standard PostgreSQL SQLSTATE error codes:
 * Class 08 — Connection Exception
 * Class 23 — Integrity Constraint Violation
 * Class 40 — Transaction Rollback (Deadlock / Serialization)
 * Class 57 — Operator Intervention (Query Canceled / Statement Timeout)
 */
export const PG_ERROR_CODES = {
  CONNECTION_EXCEPTION: "08000",
  CONNECTION_DOES_NOT_EXIST: "08003",
  CONNECTION_FAILURE: "08006",
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  TRANSACTION_ROLLBACK: "40000",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
  QUERY_CANCELED: "57014",
} as const;

export function classifyDbError(err: unknown): ClassifiedDbError {
  if (!err || typeof err !== "object") {
    return {
      isDbError: false,
      isTransient: false,
      isUniqueViolation: false,
      isForeignKeyViolation: false,
      isDeadlock: false,
      isTimeout: false,
      userMessage: "An unexpected error occurred",
    };
  }

  const errorObj = err as Record<string, unknown>;
  const code = typeof errorObj.code === "string" ? errorObj.code : undefined;
  const message = typeof errorObj.message === "string" ? errorObj.message : "";
  const detail = typeof errorObj.detail === "string" ? errorObj.detail : undefined;

  const isTransientNetwork =
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("Connection terminated unexpectedly") ||
    code === PG_ERROR_CODES.CONNECTION_FAILURE ||
    code === PG_ERROR_CODES.CONNECTION_DOES_NOT_EXIST;

  const isUniqueViolation = code === PG_ERROR_CODES.UNIQUE_VIOLATION;
  const isForeignKeyViolation = code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION;
  const isDeadlock = code === PG_ERROR_CODES.DEADLOCK_DETECTED || code === PG_ERROR_CODES.SERIALIZATION_FAILURE;
  const isTimeout = code === PG_ERROR_CODES.QUERY_CANCELED || message.includes("statement timeout");

  let userMessage = "A database operation failed";

  if (isUniqueViolation) {
    if (detail?.includes("slug")) {
      userMessage = "A workspace with this URL slug already exists. Please choose another.";
    } else if (detail?.includes("email")) {
      userMessage = "This email is already in use.";
    } else if (detail?.includes("uq_tools_workspace_name") || message.includes("uq_tools_workspace_name")) {
      userMessage = "A tool with this name already exists in this workspace.";
    } else if (detail?.includes("uq_invite_workspace_email") || message.includes("uq_invite_workspace_email")) {
      userMessage = "An invitation is already active for this email in this workspace.";
    } else {
      userMessage = "A record with this information already exists.";
    }
  } else if (isForeignKeyViolation) {
    userMessage = "The requested resource or dependency does not exist or has been removed.";
  } else if (isDeadlock) {
    userMessage = "A concurrent modification conflict occurred. Please try again.";
  } else if (isTimeout) {
    userMessage = "The request took too long to complete. Please try again.";
  } else if (isTransientNetwork) {
    userMessage = "Database connection momentarily interrupted. Retrying may succeed.";
  }

  return {
    isDbError: Boolean(code || message.includes("postgres") || message.includes("neon")),
    isTransient: isTransientNetwork || isDeadlock,
    isUniqueViolation,
    isForeignKeyViolation,
    isDeadlock,
    isTimeout,
    sqlState: code,
    detail,
    userMessage,
  };
}

/**
 * Executes a database operation and maps low-level PG constraint errors
 * to clean UserErrors for immediate client presentation.
 */
export async function withDbErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) throw err;
    const classified = classifyDbError(err);
    if (classified.isUniqueViolation || classified.isForeignKeyViolation || classified.isDeadlock) {
      throw new UserError(classified.userMessage);
    }
    throw err;
  }
}
