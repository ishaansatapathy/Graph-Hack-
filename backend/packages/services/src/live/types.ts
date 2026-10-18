/* Wire contract for the live dashboard. Mirrors frontend/src/lib/types.ts. */

export type AgentSlot = "a" | "b" | "c";
export type AgentStatus = "idle" | "working" | "blocked" | "adapted" | "verified";
export type ChangeStatus = "pending" | "conflict" | "adapted" | "verified";
export type NodeKind = "endpoint" | "schema" | "field" | "function" | "test" | "change" | "incident" | "file" | "issue";
export type Phase = "idle" | "working" | "merged" | "conflict" | "evidence" | "tests" | "fix" | "verified";

export interface LiveAgent {
  id: string;
  name: string;
  slot: AgentSlot;
  branch: string;
  model: string;
  task: string;
  status: AgentStatus;
}

export interface LiveChange {
  id: string;
  agentId: string;
  title: string;
  files: string[];
  nodeId: string;
  touches: string[];
  status: ChangeStatus;
  risk: number | null;
}

export interface LiveNode {
  id: string;
  kind: NodeKind;
  label: string;
  path?: string;
  line?: number;
  centrality: number;
  agentId?: string;
}

export interface LiveEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface LiveIncident {
  id: string;
  title: string;
  summary: string;
  occurredAt: string;
  sessionId: string;
  nodeId: string;
  recalled: boolean;
  isNew?: boolean;
}

export interface LiveCodeFile {
  path: string;
  agentId: string;
  changeId: string;
  language: string;
  original: string;
  modified: string;
  anchors: { nodeId: string; line: number }[];
}

export interface LiveEvidence {
  id: string;
  from: string;
  to: string;
  summary: string;
  cypher: string;
  hops: { nodeId: string; edgeId?: string; relation?: string; why: string }[];
}

export type LogKind =
  | "system"
  | "action"
  | "tool_call"
  | "tool_result"
  | "test"
  | "merge"
  | "conflict"
  | "prevented"
  | "recall"
  | "fix"
  | "verified";

export interface LiveLog {
  actor: string;
  kind: LogKind;
  message: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
}

export type LivePatch =
  | { op: "phase"; phase: Phase }
  | { op: "agent"; id: string; status: AgentStatus }
  | { op: "agentUpsert"; agent: LiveAgent }
  | { op: "change"; id: string; status: ChangeStatus }
  | { op: "changeUpsert"; change: LiveChange }
  | { op: "evidence"; path: LiveEvidence }
  | { op: "incident"; incident: LiveIncident }
  | { op: "file"; file: LiveCodeFile }
  | { op: "node"; node: LiveNode }
  | { op: "edge"; edge: LiveEdge }
  | { op: "pulse"; nodeIds: string[] }
  | { op: "focus"; nodeIds: string[] };

/** What the bus carries; the SSE route turns `ts` into a per-connection clock. */
export interface LiveEvent {
  ts: number;
  log: LiveLog;
  patches: LivePatch[];
}

export interface LiveSnapshot {
  sessionId: string;
  graphName: string;
  engine: "falkordb" | "embedded";
  repo: string | null;
  agents: LiveAgent[];
  changes: LiveChange[];
  nodes: LiveNode[];
  edges: LiveEdge[];
  incidents: LiveIncident[];
  files: LiveCodeFile[];
  evidence: LiveEvidence[];
  mcpTools: { name: string; description: string }[];
  durationMs: number;
}
