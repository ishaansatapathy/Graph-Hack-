import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

import { closeDbPool, getPool } from "./client";

const migrationDirectory = path.join(__dirname, "migrations");
config({ path: path.resolve(process.cwd(), ".env"), override: false, quiet: true });
const lockKey = 726;
const lockNamespace = 2_140_000_001;

function migrationStatements(source: string, tag: string) {
  const statements = source.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
  if (statements.length === 0) throw new Error(`Migration ${tag} is empty`);
  for (const statement of statements) {
    const semicolons = statement.match(/;/g) ?? [];
    const isDollarBlock = /^DO\s+\$\$[\s\S]*\$\$\s*;$/i.test(statement);
    if (!statement.endsWith(";") || (!isDollarBlock && semicolons.length !== 1)) {
      throw new Error(`Migration ${tag} must separate SQL statements with --> statement-breakpoint`);
    }
  }
  return statements;
}

async function main() {
  const entries = (await fs.readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  if (entries.length === 0) throw new Error(`No SQL migrations found in ${migrationDirectory}`);
  for (const [index, filename] of entries.entries()) {
    const number = Number(filename.slice(0, 4));
    if (number !== index) throw new Error(`Migration sequence has a gap before ${filename}`);
    migrationStatements(await fs.readFile(path.join(migrationDirectory, filename), "utf8"), filename);
  }
  if (process.argv.includes("--check")) {
    console.log(`Validated ${entries.length} ordered SQL migrations`);
    return;
  }

  const client = await getPool().connect();
  let lockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [lockNamespace, lockKey]);
    lockHeld = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.stackfox_migrations (
        tag text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const filename of entries) {
      const tag = filename.slice(0, -4);
      const source = await fs.readFile(path.join(migrationDirectory, filename), "utf8");
      const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
      // Git may check files out with LF or CRLF; a migration applied on one OS must still verify on another.
      const lf = source.replace(/\r\n/g, "\n");
      const accepted = new Set([sha(source), sha(lf), sha(lf.replace(/\n/g, "\r\n"))]);
      const checksum = sha(lf);
      const [applied] = (await client.query<{ checksum: string }>(
        "SELECT checksum FROM public.stackfox_migrations WHERE tag = $1",
        [tag],
      )).rows;
      if (applied) {
        if (!accepted.has(applied.checksum)) throw new Error(`Applied migration ${tag} has changed; create a new migration instead`);
        continue;
      }

      await client.query("BEGIN");
      try {
        for (const statement of migrationStatements(source, tag)) await client.query(statement);
        await client.query("INSERT INTO public.stackfox_migrations (tag, checksum) VALUES ($1, $2)", [tag, checksum]);
        await client.query("COMMIT");
        console.log(`Applied ${tag}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Migration ${tag} failed; transaction rolled back`, { cause: error });
      }
    }
    console.log("Database migrations are up to date");
  } finally {
    if (lockHeld) await client.query("SELECT pg_advisory_unlock($1, $2)", [lockNamespace, lockKey]).catch(() => undefined);
    client.release();
    await closeDbPool();
  }
}

main().catch((error) => {
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  console.error(`${error instanceof Error ? error.message : "Database migration failed"}${cause}`);
  void closeDbPool().finally(() => { process.exitCode = 1; });
});
