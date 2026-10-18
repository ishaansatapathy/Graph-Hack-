/**
 * Device and account rate limiting via Neon/PostgreSQL.
 *
 * Problem: users create multiple Google accounts to bypass per-user AI quotas.
 * Browser fingerprints are client-controlled, so each request also reserves a
 * server-derived authenticated-account quota in Postgres.
 *
 * The raw fingerprint is NEVER stored — only a salted HMAC-SHA256 hash.
 */

import crypto from "node:crypto";

import {
  cleanupOldDeviceQuotas,
  getDeviceWindowCount,
  reserveDeviceQuota,
} from "../db/index";

const DEVICE_RPM = 15;   // requests per minute per device
const DEVICE_RPD = 150;  // requests per day per device

function getFpSalt(): string {
  return process.env.FP_SALT?.trim() || "stackfox-fp-v1";
}

function hashFingerprint(rawFp: string): string {
  return crypto.createHmac("sha256", getFpSalt()).update(rawFp.trim()).digest("hex").slice(0, 32);
}

function minuteWindow(): string {
  return new Date().toISOString().slice(0, 16); // "2026-10-17T11:03"
}

function dayWindow(): string {
  return new Date().toISOString().slice(0, 10); // "2026-10-17"
}

// ── Public API ────────────────────────────────────────────────────────────────

export type FpRateResult =
  | { ok: true; fpHash: string }
  | { ok: false; reason: "device_rpm" | "device_rpd" | "invalid_fp"; retryAfterMs?: number };

/**
 * Check + increment device quota (async, Neon-backed).
 * Call before every AI request.
 */
export async function checkDeviceQuota(
  rawFp: string | null | undefined,
  authenticatedUserId: string,
): Promise<FpRateResult> {
  const accountHash = hashFingerprint(`account:${authenticatedUserId}`);
  const normalizedFingerprint = rawFp?.trim();
  const deviceHash = normalizedFingerprint && normalizedFingerprint.length >= 8
    ? hashFingerprint(`device:${normalizedFingerprint}`)
    : accountHash;
  const now = Date.now();

  const minKey = minuteWindow();
  const dayKey = dayWindow();
  for (const fpHash of new Set([deviceHash, accountHash])) {
    const reservation = await reserveDeviceQuota(fpHash, minKey, dayKey, DEVICE_RPM, DEVICE_RPD);
    if (reservation === "device_rpm") {
      return { ok: false, reason: "device_rpm", retryAfterMs: 60_000 - (now % 60_000) };
    }
    if (reservation === "device_rpd") {
      return { ok: false, reason: "device_rpd", retryAfterMs: 86_400_000 - (now % 86_400_000) };
    }
  }

  // 1% chance cleanup
  if (Math.random() < 0.01) {
    void cleanupOldDeviceQuotas();
  }

  return { ok: true, fpHash: deviceHash };
}

export async function getDeviceUsage(rawFp: string): Promise<{ minuteUsed: number; dayUsed: number }> {
  const fpHash = hashFingerprint(`device:${rawFp.trim()}`);
  const [minuteUsed, dayUsed] = await Promise.all([
    getDeviceWindowCount(fpHash, minuteWindow()),
    getDeviceWindowCount(fpHash, dayWindow()),
  ]);
  return { minuteUsed, dayUsed };
}
