import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { env } from "../env";

export type DbUser = {
  id: string;
  full_name: string;
  display_name: string | null;
  email: string;
  email_verified: number;
  auth_provider: string;
  provider_id: string | null;
  profile_image_url: string | null;
  token_version: string;
  role: string;
};

const defaultPath = path.join(process.cwd(), "data", "graph-hack.sqlite");
const dbPath = env.DATABASE_PATH?.trim() || defaultPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    display_name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    auth_provider TEXT NOT NULL DEFAULT 'google',
    provider_id TEXT,
    profile_image_url TEXT,
    token_version TEXT NOT NULL DEFAULT '0',
    role TEXT NOT NULL DEFAULT 'user'
  );
`);

export function findUserByEmail(email: string): DbUser | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").get(email) as DbUser | undefined;
  return row ?? null;
}

export function findUserById(userId: string): DbUser | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId) as DbUser | undefined;
  return row ?? null;
}

export function insertUser(user: DbUser) {
  db.prepare(
    `INSERT INTO users (
      id, full_name, display_name, email, email_verified, auth_provider,
      provider_id, profile_image_url, token_version, role
    ) VALUES (
      @id, @full_name, @display_name, @email, @email_verified, @auth_provider,
      @provider_id, @profile_image_url, @token_version, @role
    )`,
  ).run(user);
}

export function updateUserProvider(userId: string, providerId: string, profileImageUrl: string | null, emailVerified: boolean) {
  db.prepare(
    `UPDATE users SET provider_id = ?, profile_image_url = COALESCE(profile_image_url, ?), email_verified = MAX(email_verified, ?) WHERE id = ?`,
  ).run(providerId, profileImageUrl, emailVerified ? 1 : 0, userId);
}

export function bumpTokenVersion(userId: string) {
  const user = findUserById(userId);
  const current = Number.parseInt(user?.token_version ?? "0", 10);
  const next = String(Number.isFinite(current) ? current + 1 : 1);
  db.prepare("UPDATE users SET token_version = ? WHERE id = ?").run(next, userId);
}
