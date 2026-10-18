/**
 * BACKWARD-COMPAT SHIM — workspace/db.ts
 *
 * Re-exports from the new production DAL (src/db/) so existing callers
 * that import from "../workspace/db" or "./db" continue to work.
 *
 * Gradually migrate callers to import directly from "../db".
 */

export * from "../db/index";
