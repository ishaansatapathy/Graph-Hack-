import crypto from "node:crypto";

import { env } from "../env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function deriveKey() {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

export function encryptJson(value: Record<string, string>): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const plaintext = JSON.stringify(value);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptJson(blob: string): Record<string, string> {
  const buf = Buffer.from(blob, "base64url");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, string>;
}

export function maskSecret(value: string | undefined, visible = 4) {
  if (!value) return null;
  if (value.length <= visible) return "••••";
  return `${"•".repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`;
}
