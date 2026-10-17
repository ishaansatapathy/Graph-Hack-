/**
 * Browser fingerprint hook.
 *
 * Computes a lightweight device fingerprint from:
 *   - Screen dimensions + color depth
 *   - Timezone + language
 *   - Canvas rendering signature
 *   - Platform + user agent snippet
 *   - Hardware concurrency + device memory
 *
 * This is NOT a tracking tool — it's used solely for per-device AI quota
 * enforcement to prevent multiple Google account abuse.
 *
 * The fingerprint is hashed server-side (HMAC-SHA256) before storage.
 * Raw fingerprint is never logged or stored by the server.
 */

"use client";

import { useEffect, useState } from "react";

function canvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 200, 40);
    ctx.fillStyle = "#069";
    ctx.font = "14px Arial";
    ctx.fillText("Stackfox FP 🎨", 10, 25);
    return canvas.toDataURL().slice(-64); // last 64 chars of data URL
  } catch {
    return "canvas-err";
  }
}

function computeFingerprint(): string {
  const parts = [
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.platform ?? "unknown",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as unknown as any).hardwareConcurrency ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as unknown as any).deviceMemory ?? 0,
    navigator.userAgent.slice(0, 80),
    canvasFingerprint(),
  ];
  return parts.join("|");
}

/**
 * Returns a stable device fingerprint string, or null during SSR.
 * The value is computed once and cached in sessionStorage.
 */
export function useFingerprint(): string | null {
  const [fp, setFp] = useState<string | null>(null);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem("sfx-fp");
      if (cached) {
        setFp(cached);
        return;
      }
      const raw = computeFingerprint();
      sessionStorage.setItem("sfx-fp", raw);
      setFp(raw);
    } catch {
      // sessionStorage unavailable (private mode, etc.) — generate ephemeral
      setFp(computeFingerprint());
    }
  }, []);

  return fp;
}
