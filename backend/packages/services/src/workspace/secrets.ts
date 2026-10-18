import crypto from "node:crypto";

import { env } from "../env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function deriveKey(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptionSecret() {
  return env.ENCRYPTION_KEY?.trim() || env.JWT_SECRET;
}

export function encryptJson(value: Record<string, string>): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(encryptionSecret()), iv);
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
  const secrets = [...new Set([encryptionSecret(), env.JWT_SECRET])];
  for (const secret of secrets) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, deriveKey(secret), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      return JSON.parse(plain) as Record<string, string>;
    } catch {
      // Existing integration rows may still use the legacy JWT-derived key.
    }
  }
  throw new Error("Could not decrypt integration credentials. Check ENCRYPTION_KEY configuration.");
}

export function maskSecret(value: string | undefined, visible = 4) {
  if (!value) return null;
  if (value.length <= visible) return "••••";
  return `${"•".repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`;
}
