/* Shared contract between the SYNK backend and the UI.
   The UI never constructs these values itself — they arrive from /api/*. */

export type AgentSlot = "a" | "b" | "c";
export type AgentStatus = "idle" | "working" | "blocked" | "adapted" | "verified";

export interface Agent {
  id: string;
  name: string;
  slot: AgentSlot;
  branch: string;
  model: string;
  task: string;
  status: AgentStatus;
}

export type ChangeStatus = "pending" | "conflict" | "adapted" | "verified";

export interface ProposedChange {
  id: string;
  agentId: string;
  title: string;
  files: string[];
  /** graph node representing this change */
  nodeId: string;
  /** nodes this change touches (MODIFIES / INTRODUCES) */
  touches: string[];
  status: ChangeStatus;
  /** 0..1 from rank_change_risk; null until ranked */
  risk: number | null;
}

export type NodeKind =
  | "endpoint"
  | "schema"
  | "field"
  | "function"
  | "test"
  | "change"
  | "incident";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  path?: string;
  line?: number;
  /** degree centrality from FalkorDB, normalised 0..1 */
  centrality: number;
  agentId?: string;
}

export type EdgeKind =
  | "DECLARES"
  | "RETURNS"
  | "CALLS"
  | "READS"
  | "TESTS"
  | "MODIFIES"
  | "INTRODUCES"
  | "INVOLVED"
  | "SIMILAR_TO";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface EvidenceHop {
  nodeId: string;
  /** edge traversed to reach this node from the previous hop */
  edgeId?: string;
  relation?: string;
  why: string;
}

export interface EvidencePath {
  id: string;
  from: string;
  to: string;
  summary: string;
  cypher: string;
  hops: EvidenceHop[];
}

export type TestStatus = "queued" | "running" | "pass" | "fail";

export interface TestRun {
  id: string;
  testNodeId: string;
  name: string;
  path: string;
  phase: "detect" | "reverify";
  status: TestStatus;
  durationMs?: number;
  message?: string;
}

export interface FixProposal {
  id: string;
  title: string;
  agentId: string;
  file: string;
  language: string;
  original: string;
  modified: string;
  rationale: string;
  status: "proposed" | "applied" | "verifying" | "verified" | "failed";
}

export interface Incident {
  id: string;
  title: string;
  summary: string;
  occurredAt: string;
  sessionId: string;
  nodeId: string;
  recalled: boolean;
  /** true when created in the current session */
  isNew?: boolean;
}

export interface CodeAnchor {
  nodeId: string;
  line: number;
}

export interface CodeFile {
  path: string;
  agentId: string;
  changeId: string;
  language: string;
  original: string;
  modified: string;
  anchors: CodeAnchor[];
}

export type Actor = string; // agent id | "synk" | "git" | "ci"

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

/** One line in the live event log. Tool calls carry args + result. */
export interface ToolCallEvent {
  id: string;
  at: number; // ms since run start
  actor: Actor;
  kind: LogKind;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
  message: string;
}

export type Phase =
  | "idle"
  | "working"
  | "merged"
  | "conflict"
  | "evidence"
  | "tests"
  | "fix"
  | "verified";

export type StatePatch =
  | { op: "phase"; phase: Phase }
  | { op: "agent"; id: string; status: AgentStatus }
  | { op: "change"; id: string; status: ChangeStatus }
  | { op: "risk"; ranks: { changeId: string; risk: number }[] }
  | { op: "evidence"; path: EvidencePath }
  | { op: "test"; run: TestRun }
  | { op: "fix"; fix: FixProposal }
  | { op: "incident"; incident: Incident }
  | { op: "node"; node: GraphNode }
  | { op: "edge"; edge: GraphEdge }
  | { op: "pulse"; nodeIds: string[] }
  | { op: "focus"; nodeIds: string[] };

export interface StreamEvent {
  seq: number;
  at: number;
  log: ToolCallEvent;
  patches: StatePatch[];
}

export interface ScenarioSnapshot {
  sessionId: string;
  graphName: string;
  repo: string;
  agents: Agent[];
  changes: ProposedChange[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  incidents: Incident[];
  files: CodeFile[];
  mcpTools: { name: string; description: string }[];
  /** expected length of a full run, for the progress bar */
  durationMs: number;
}

export interface ApiError {
  error: string;
}
