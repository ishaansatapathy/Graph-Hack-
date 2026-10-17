"use client";

import { useSyncExternalStore } from "react";

/* Scroll choreography is built on the visitor's first scroll or input,
   not during hydration: nothing below the fold animates before then,
   and it keeps the initial main thread free. */

let armed = false;
const listeners = new Set<() => void>();
const EVENTS = ["scroll", "wheel", "touchstart", "keydown", "pointerdown"] as const;

function arm() {
  if (armed) return;
  armed = true;
  EVENTS.forEach((e) => window.removeEventListener(e, arm));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!armed) {
    EVENTS.forEach((e) => window.addEventListener(e, arm, { passive: true, once: true }));
    if (window.scrollY > 0) queueMicrotask(arm); // restored scroll position
  }
  return () => listeners.delete(cb);
}

export function useArmed() {
  return useSyncExternalStore(subscribe, () => armed, () => false);
}
