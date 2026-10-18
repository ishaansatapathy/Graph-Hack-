import { EventEmitter } from "node:events";

import type { LiveEvent } from "./types";

/** In-process pub/sub of live dashboard events, one channel per workspace. */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(workspaceId: string, event: Omit<LiveEvent, "ts">) {
  emitter.emit(workspaceId, { ...event, ts: Date.now() } satisfies LiveEvent);
}

export function subscribe(workspaceId: string, listener: (event: LiveEvent) => void): () => void {
  emitter.on(workspaceId, listener);
  return () => emitter.off(workspaceId, listener);
}
