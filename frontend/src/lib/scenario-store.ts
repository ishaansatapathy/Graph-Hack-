"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { api, ApiRequestError } from "./api";
import type {
  Agent,
  CodeFile,
  EvidencePath,
  FixProposal,
  GraphEdge,
  GraphNode,
  Incident,
  Phase,
  ProposedChange,
  ScenarioSnapshot,
  StreamEvent,
  TestRun,
  ToolCallEvent,
} from "./types";

export type StreamState = "idle" | "connecting" | "live" | "ended" | "error";

export interface DashboardState {
  load: "loading" | "ready" | "error";
  loadError?: string;
  /** HTTP status of the failed load, e.g. 401 when signed out */
  loadStatus?: number;
  snapshot: ScenarioSnapshot | null;
  agents: Agent[];
  changes: ProposedChange[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  incidents: Incident[];
  files: CodeFile[];
  phase: Phase;
  log: ToolCallEvent[];
  evidence: EvidencePath | null;
  tests: TestRun[];
  fix: FixProposal | null;
  /** nodeId -> performance.now() when pulse started */
  pulses: Record<string, number>;
  focus: { nodeIds: string[]; at: number } | null;
  stream: StreamState;
  streamError?: string;
  /** last event `at` (ms since the stream connected) */
  clock: number;
  runId: number;
  importing: boolean;
  importError?: string;
}

type Action =
  | { type: "loaded"; snapshot: ScenarioSnapshot }
  | { type: "loadFailed"; error: string; status?: number }
  | { type: "reload" }
  | { type: "reset" }
  | { type: "import"; state: "start" | "done" | "failed"; error?: string }
  | { type: "stream"; state: StreamState; error?: string }
  | { type: "event"; ev: StreamEvent };

const initial: DashboardState = {
  load: "loading",
  snapshot: null,
  agents: [],
  changes: [],
  nodes: [],
  edges: [],
  incidents: [],
  files: [],
  phase: "idle",
  log: [],
  evidence: null,
  tests: [],
  fix: null,
  pulses: {},
  focus: null,
  stream: "idle",
  clock: 0,
  runId: 0,
  importing: false,
};

function initialPhase(s: ScenarioSnapshot): Phase {
  if (s.evidence.length) return "evidence";
  if (s.changes.length) return "working";
  return "idle";
}

/** Replaces graph state with the backend's view; the live log and stream survive. */
function fromSnapshot(s: ScenarioSnapshot, prev: DashboardState): DashboardState {
  return {
    ...prev,
    load: "ready",
    loadError: undefined,
    loadStatus: undefined,
    snapshot: s,
    agents: s.agents,
    changes: s.changes,
    nodes: s.nodes,
    edges: s.edges,
    incidents: s.incidents,
    files: s.files,
    evidence: s.evidence[s.evidence.length - 1] ?? null,
    phase: initialPhase(s),
  };
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function apply(state: DashboardState, ev: StreamEvent): DashboardState {
  const s: DashboardState = { ...state, clock: ev.at, log: [...state.log, ev.log] };
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  for (const p of ev.patches) {
    switch (p.op) {
      case "phase":
        s.phase = p.phase;
        break;
      case "agent":
        s.agents = s.agents.map((a) => (a.id === p.id ? { ...a, status: p.status } : a));
        break;
      case "agentUpsert":
        s.agents = upsert(s.agents, p.agent);
        break;
      case "change":
        s.changes = s.changes.map((c) => (c.id === p.id ? { ...c, status: p.status } : c));
        break;
      case "changeUpsert":
        s.changes = upsert(s.changes, p.change);
        break;
      case "file": {
        const i = s.files.findIndex((f) => f.path === p.file.path && f.changeId === p.file.changeId);
        s.files = i === -1 ? [...s.files, p.file] : s.files.map((f, j) => (j === i ? p.file : f));
        break;
      }
      case "risk":
        s.changes = s.changes.map((c) => {
          const r = p.ranks.find((x) => x.changeId === c.id);
          return r ? { ...c, risk: r.risk } : c;
        });
        break;
      case "evidence":
        s.evidence = p.path;
        s.focus = { nodeIds: p.path.hops.map((h) => h.nodeId), at: now };
        break;
      case "test":
        s.tests = upsert(s.tests, p.run);
        break;
      case "fix":
        s.fix = p.fix;
        break;
      case "incident":
        s.incidents = upsert(s.incidents, p.incident);
        break;
      case "node":
        if (!s.nodes.some((n) => n.id === p.node.id)) s.nodes = [...s.nodes, p.node];
        break;
      case "edge":
        if (!s.edges.some((e) => e.id === p.edge.id)) s.edges = [...s.edges, p.edge];
        break;
      case "pulse":
        s.pulses = { ...s.pulses, ...Object.fromEntries(p.nodeIds.map((id) => [id, now])) };
        break;
      case "focus":
        s.focus = { nodeIds: p.nodeIds, at: now };
        break;
    }
  }
  return s;
}

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "loaded":
      return fromSnapshot(action.snapshot, state);
    case "loadFailed":
      return { ...state, load: "error", loadError: action.error, loadStatus: action.status };
    case "reload":
      return { ...state, load: "loading", loadError: undefined };
    case "reset":
      return { ...state, log: [], clock: 0, pulses: {}, focus: null, runId: state.runId + 1, stream: "connecting", streamError: undefined };
    case "import":
      return { ...state, importing: action.state === "start", importError: action.state === "failed" ? action.error : undefined };
    case "stream":
      return { ...state, stream: action.state, streamError: action.error };
    case "event":
      return apply(state, action.ev);
  }
}

export function useScenario() {
  const [state, dispatch] = useReducer(reducer, initial);
  const unsub = useRef<(() => void) | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return api
      .scenario(signal)
      .then((snapshot) => dispatch({ type: "loaded", snapshot }))
      .catch((err: Error) => {
        if (!signal?.aborted) dispatch({ type: "loadFailed", error: err.message, status: err instanceof ApiRequestError ? err.status : undefined });
      });
  }, []);

  const connect = useCallback(() => {
    unsub.current?.();
    dispatch({ type: "reset" });
    unsub.current = api.events({
      onOpen: () => dispatch({ type: "stream", state: "live" }),
      onEvent: (ev) => dispatch({ type: "event", ev }),
      onEnd: () => dispatch({ type: "stream", state: "ended" }),
      onError: (error) => dispatch({ type: "stream", state: "error", error }),
    });
  }, []);

  // Load the workspace graph, then follow it live.
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal).then(() => {
      if (!ctrl.signal.aborted) connect();
    });
    return () => {
      ctrl.abort();
      unsub.current?.();
      unsub.current = null;
    };
  }, [load, connect]);

  const retry = useCallback(() => {
    dispatch({ type: "reload" });
    load().then(connect);
  }, [load, connect]);

  /** Re-syncs with the backend and reopens the stream. */
  const reconnect = useCallback(() => {
    load().then(connect);
  }, [load, connect]);

  const stop = useCallback(() => {
    unsub.current?.();
    unsub.current = null;
    dispatch({ type: "stream", state: "ended" });
  }, []);

  const importRepo = useCallback(
    async (repo: string) => {
      dispatch({ type: "import", state: "start" });
      try {
        await api.importRepo(repo);
        dispatch({ type: "import", state: "done" });
      } catch (err) {
        dispatch({ type: "import", state: "failed", error: (err as Error).message });
      }
      // Reconcile with what the graph actually holds now.
      await load();
    },
    [load],
  );

  return { state, reconnect, stop, retry, importRepo };
}
