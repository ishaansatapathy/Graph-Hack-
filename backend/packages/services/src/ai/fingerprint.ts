/**
 * Device-level rate limiting via browser fingerprint — Neon/PostgreSQL.
 *
 * Problem: users create multiple Google accounts to bypass per-user AI quotas.
 * Solution: track AI usage by device fingerprint in Postgres (persistent across restarts).
 *
 * The raw fingerprint is NEVER stored — only a salted HMAC-SHA256 hash.
 */

import crypto from "node:crypto";

import {
  cleanupOldDeviceQuotas,
  getDeviceWindowCount,
  incrementDeviceWindow,
} from "../db/index";

const DEVICE_RPM = 15;   // requests per minute per device
const DEVICE_RPD = 150;  // requests per day per device

function getFpSalt(): string {
  return process.env.FP_SALT ?? "stackfox-fp-v1";
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
export async function checkDeviceQuota(rawFp: string | null | undefined): Promise<FpRateResult> {
  if (!rawFp || rawFp.trim().length < 8) {
    return { ok: true, fpHash: "no-fp" };
  }

  const fpHash = hashFingerprint(rawFp);
  const now = Date.now();

  // Per-minute check
  const minKey = minuteWindow();
  const minCount = await getDeviceWindowCount(fpHash, minKey);
  if (minCount >= DEVICE_RPM) {
    return { ok: false, reason: "device_rpm", retryAfterMs: 60_000 - (now % 60_000) };
  }

  // Per-day check
  const dayKey = dayWindow();
  const dayCount = await getDeviceWindowCount(fpHash, dayKey);
  if (dayCount >= DEVICE_RPD) {
    return { ok: false, reason: "device_rpd", retryAfterMs: 86_400_000 - (now % 86_400_000) };
  }

  // Increment both windows
  await Promise.all([
    incrementDeviceWindow(fpHash, minKey),
    incrementDeviceWindow(fpHash, dayKey),
  ]);

  // 1% chance cleanup
  if (Math.random() < 0.01) {
    void cleanupOldDeviceQuotas();
  }

  return { ok: true, fpHash };
}

export async function getDeviceUsage(rawFp: string): Promise<{ minuteUsed: number; dayUsed: number }> {
  const fpHash = hashFingerprint(rawFp);
  const [minuteUsed, dayUsed] = await Promise.all([
    getDeviceWindowCount(fpHash, minuteWindow()),
    getDeviceWindowCount(fpHash, dayWindow()),
  ]);
  return { minuteUsed, dayUsed };
}
