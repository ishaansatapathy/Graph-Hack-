"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "./api";
import type {
  Agent,
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
  snapshot: ScenarioSnapshot | null;
  agents: Agent[];
  changes: ProposedChange[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  incidents: Incident[];
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
  /** last event `at` (ms since run start) */
  clock: number;
  runId: number;
}

type Action =
  | { type: "loaded"; snapshot: ScenarioSnapshot }
  | { type: "loadFailed"; error: string }
  | { type: "reload" }
  | { type: "reset" }
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
};

function fromSnapshot(s: ScenarioSnapshot, prev: DashboardState): DashboardState {
  return {
    ...initial,
    load: "ready",
    snapshot: s,
    agents: s.agents,
    changes: s.changes,
    nodes: s.nodes,
    edges: s.edges,
    incidents: s.incidents,
    runId: prev.runId,
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
      case "change":
        s.changes = s.changes.map((c) => (c.id === p.id ? { ...c, status: p.status } : c));
        break;
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
      return { ...state, load: "error", loadError: action.error };
    case "reload":
      return { ...state, load: "loading", loadError: undefined };
    case "reset":
      return state.snapshot
        ? { ...fromSnapshot(state.snapshot, state), runId: state.runId + 1, stream: "connecting" }
        : state;
    case "stream":
      return { ...state, stream: action.state, streamError: action.error };
    case "event":
      return apply(state, action.ev);
  }
}

export function useScenario({ speed = 1 }: { speed?: number } = {}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const unsub = useRef<(() => void) | null>(null);
  const [loadKey, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .scenario(ctrl.signal)
      .then((snapshot) => dispatch({ type: "loaded", snapshot }))
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) dispatch({ type: "loadFailed", error: err.message });
      });
    return () => ctrl.abort();
  }, [loadKey]);

  const retry = useCallback(() => {
    dispatch({ type: "reload" });
    bump();
  }, []);

  const run = useCallback(() => {
    unsub.current?.();
    dispatch({ type: "reset" });
    unsub.current = api.events({
      speed,
      onOpen: () => dispatch({ type: "stream", state: "live" }),
      onEvent: (ev) => dispatch({ type: "event", ev }),
      onEnd: () => dispatch({ type: "stream", state: "ended" }),
      onError: (error) => dispatch({ type: "stream", state: "error", error }),
    });
  }, [speed]);

  const stop = useCallback(() => {
    unsub.current?.();
    unsub.current = null;
    dispatch({ type: "stream", state: "ended" });
  }, []);

  useEffect(() => () => unsub.current?.(), []);

  return { state, run, stop, retry };
}
