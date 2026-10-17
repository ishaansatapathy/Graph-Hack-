/**
 * Device-level rate limiting via browser fingerprint.
 *
 * Problem: users create multiple Google accounts to bypass per-user AI quotas.
 * Solution: track AI usage by device fingerprint (sent from browser) in addition
 *           to userId. The stricter of the two limits applies.
 *
 * Fingerprint is computed client-side (canvas, screen, timezone, fonts, etc.)
 * and sent as a header/body field. We hash it server-side and track usage in SQLite.
 *
 * This is abuse-deterrent, not abuse-proof — but sufficient for a hackathon
 * and real products alike. We never store the raw fingerprint, only a salted hash.
 */

import crypto from "node:crypto";

import { sqlite } from "../workspace/db";

// ── Schema ───────────────────────────────────────────────────────────────────

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS device_quota (
    fp_hash     TEXT NOT NULL,
    window_start TEXT NOT NULL,
    requests    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (fp_hash, window_start)
  );
`);

// ── Config ───────────────────────────────────────────────────────────────────

const DEVICE_RPM = 15;          // requests per minute per device (across all Google accounts)
const DEVICE_RPD = 150;         // requests per day per device
const FP_SALT = process.env.FP_SALT ?? "stackfox-fp-v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashFingerprint(rawFp: string): string {
  return crypto.createHmac("sha256", FP_SALT).update(rawFp.trim()).digest("hex").slice(0, 32);
}

function minuteWindow(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 16)}`; // "2026-10-17T11:03"
}

function dayWindow(): string {
  return new Date().toISOString().slice(0, 10); // "2026-10-17"
}

// ── Public API ───────────────────────────────────────────────────────────────

export type FpRateResult =
  | { ok: true; fpHash: string }
  | { ok: false; reason: "device_rpm" | "device_rpd" | "invalid_fp"; retryAfterMs?: number };

/**
 * Check + increment device quota.
 * Call this before every AI request.
 * If rawFp is empty/null, we skip fingerprint checking (fallback to user-level only).
 */
export function checkDeviceQuota(rawFp: string | null | undefined): FpRateResult {
  if (!rawFp || rawFp.trim().length < 8) {
    // No fingerprint provided — allow but can't enforce device limit
    return { ok: true, fpHash: "no-fp" };
  }

  const fpHash = hashFingerprint(rawFp);
  const now = Date.now();

  // ── Per-minute check ──
  const minKey = minuteWindow();
  const minRow = sqlite
    .prepare("SELECT requests FROM device_quota WHERE fp_hash = ? AND window_start = ?")
    .get(fpHash, minKey) as { requests: number } | undefined;

  const minCount = minRow?.requests ?? 0;
  if (minCount >= DEVICE_RPM) {
    return { ok: false, reason: "device_rpm", retryAfterMs: 60_000 - (now % 60_000) };
  }

  // ── Per-day check ──
  const dayKey = dayWindow();
  const dayRow = sqlite
    .prepare("SELECT requests FROM device_quota WHERE fp_hash = ? AND window_start = ?")
    .get(fpHash, dayKey) as { requests: number } | undefined;

  const dayCount = dayRow?.requests ?? 0;
  if (dayCount >= DEVICE_RPD) {
    return { ok: false, reason: "device_rpd", retryAfterMs: 86_400_000 - (now % 86_400_000) };
  }

  // ── Increment both windows ──
  sqlite
    .prepare(
      `INSERT INTO device_quota (fp_hash, window_start, requests) VALUES (?, ?, 1)
       ON CONFLICT (fp_hash, window_start) DO UPDATE SET requests = requests + 1`,
    )
    .run(fpHash, minKey);

  sqlite
    .prepare(
      `INSERT INTO device_quota (fp_hash, window_start, requests) VALUES (?, ?, 1)
       ON CONFLICT (fp_hash, window_start) DO UPDATE SET requests = requests + 1`,
    )
    .run(fpHash, dayKey);

  // Cleanup old entries periodically (1% chance per call)
  if (Math.random() < 0.01) {
    void cleanupOldQuotas();
  }

  return { ok: true, fpHash };
}

function cleanupOldQuotas() {
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  sqlite.prepare("DELETE FROM device_quota WHERE window_start < ?").run(cutoff);
}

/**
 * Get current device usage stats (for UI display).
 */
export function getDeviceUsage(rawFp: string): { minuteUsed: number; dayUsed: number } {
  const fpHash = hashFingerprint(rawFp);
  const minRow = sqlite
    .prepare("SELECT requests FROM device_quota WHERE fp_hash = ? AND window_start = ?")
    .get(fpHash, minuteWindow()) as { requests: number } | undefined;
  const dayRow = sqlite
    .prepare("SELECT requests FROM device_quota WHERE fp_hash = ? AND window_start = ?")
    .get(fpHash, dayWindow()) as { requests: number } | undefined;
  return {
    minuteUsed: minRow?.requests ?? 0,
    dayUsed: dayRow?.requests ?? 0,
  };
}
