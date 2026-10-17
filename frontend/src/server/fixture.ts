import "server-only";
import type {
  CodeFile,
  GraphEdge,
  GraphNode,
  ScenarioSnapshot,
  StatePatch,
  StreamEvent,
  ToolCallEvent,
} from "@/lib/types";

/* ------------------------------------------------------------------
   Demo scenario fixture.
   Stands in for the Stackfox backend (FalkorDB + MCP server) when
   STACKFOX_BACKEND_URL is not configured. Shape matches what the backend
   is expected to emit on GET /scenario and GET /events, so UI code is
   identical in both modes.
   ------------------------------------------------------------------ */

const nodes: GraphNode[] = [
  // endpoints
  { id: "ep:get-user", kind: "endpoint", label: "GET /api/users/:id", path: "api/users/[id].ts", line: 8, centrality: 0.81 },
  { id: "ep:post-checkout", kind: "endpoint", label: "POST /api/checkout", path: "api/checkout.ts", line: 12, centrality: 0.58 },
  { id: "ep:get-orders", kind: "endpoint", label: "GET /api/orders", path: "api/orders.ts", line: 6, centrality: 0.34 },
  // schemas
  { id: "sc:user", kind: "schema", label: "UserSchema", path: "schemas/user.ts", line: 3, centrality: 0.74 },
  { id: "sc:order", kind: "schema", label: "OrderSchema", path: "schemas/order.ts", line: 3, centrality: 0.4 },
  { id: "sc:notif", kind: "schema", label: "NotificationPrefs", path: "schemas/notifications.ts", line: 3, centrality: 0.22 },
  // fields
  { id: "f:user.email", kind: "field", label: "User.email", path: "schemas/user.ts", line: 6, centrality: 0.92 },
  { id: "f:user.id", kind: "field", label: "User.id", path: "schemas/user.ts", line: 4, centrality: 0.3 },
  { id: "f:order.total", kind: "field", label: "Order.total", path: "schemas/order.ts", line: 7, centrality: 0.36 },
  { id: "f:notif.channel", kind: "field", label: "NotificationPrefs.channel", path: "schemas/notifications.ts", line: 5, centrality: 0.18 },
  // functions
  { id: "fn:serializeUser", kind: "function", label: "serializeUser()", path: "api/users/serialize.ts", line: 4, centrality: 0.52 },
  { id: "fn:fetchUser", kind: "function", label: "fetchUser()", path: "lib/client/users.ts", line: 9, centrality: 0.66 },
  { id: "fn:sendReceipt", kind: "function", label: "sendReceipt()", path: "billing/receipts.ts", line: 6, centrality: 0.61, agentId: "agent-b" },
  { id: "fn:createCheckout", kind: "function", label: "createCheckout()", path: "billing/checkout.ts", line: 14, centrality: 0.55 },
  { id: "fn:computeTotal", kind: "function", label: "computeTotal()", path: "billing/total.ts", line: 3, centrality: 0.28 },
  { id: "fn:notifyUser", kind: "function", label: "notifyUser()", path: "notifications/notify.ts", line: 5, centrality: 0.33 },
  // tests
  { id: "t:user-serialize", kind: "test", label: "users.serialize.test.ts", path: "tests/users.serialize.test.ts", line: 1, centrality: 0.12 },
  { id: "t:receipt-contract", kind: "test", label: "receipts.contract.test.ts", path: "tests/receipts.contract.test.ts", line: 1, centrality: 0.14 },
  { id: "t:receipts-unit", kind: "test", label: "receipts.unit.test.ts", path: "tests/receipts.unit.test.ts", line: 1, centrality: 0.08 },
  { id: "t:checkout-e2e", kind: "test", label: "checkout.e2e.test.ts", path: "tests/checkout.e2e.test.ts", line: 1, centrality: 0.16 },
  { id: "t:notify", kind: "test", label: "notify.test.ts", path: "tests/notify.test.ts", line: 1, centrality: 0.07 },
  // proposed changes
  { id: "pc:a", kind: "change", label: "PC-A1", centrality: 0.7, agentId: "agent-a" },
  { id: "pc:b", kind: "change", label: "PC-B1", centrality: 0.5, agentId: "agent-b" },
  { id: "pc:c", kind: "change", label: "PC-C1", centrality: 0.3, agentId: "agent-c" },
  // memory
  { id: "inc:0412", kind: "incident", label: "INC-0412", centrality: 0.2 },
];

const e = (source: string, kind: GraphEdge["kind"], target: string): GraphEdge => ({
  id: `${source}|${kind}|${target}`,
  source,
  target,
  kind,
});

const edges: GraphEdge[] = [
  e("sc:user", "DECLARES", "f:user.email"),
  e("sc:user", "DECLARES", "f:user.id"),
  e("sc:order", "DECLARES", "f:order.total"),
  e("sc:notif", "DECLARES", "f:notif.channel"),
  e("ep:get-user", "RETURNS", "sc:user"),
  e("ep:get-orders", "RETURNS", "sc:order"),
  e("ep:get-user", "CALLS", "fn:serializeUser"),
  e("fn:serializeUser", "READS", "f:user.email"),
  e("fn:serializeUser", "READS", "f:user.id"),
  e("fn:fetchUser", "CALLS", "ep:get-user"),
  e("ep:post-checkout", "CALLS", "fn:createCheckout"),
  e("fn:createCheckout", "CALLS", "fn:computeTotal"),
  e("fn:createCheckout", "CALLS", "fn:sendReceipt"),
  e("fn:computeTotal", "READS", "f:order.total"),
  e("fn:sendReceipt", "CALLS", "fn:fetchUser"),
  e("fn:notifyUser", "CALLS", "fn:fetchUser"),
  e("fn:notifyUser", "READS", "f:notif.channel"),
  e("t:user-serialize", "TESTS", "fn:serializeUser"),
  e("t:receipt-contract", "TESTS", "fn:sendReceipt"),
  e("t:receipts-unit", "TESTS", "fn:sendReceipt"),
  e("t:checkout-e2e", "TESTS", "ep:post-checkout"),
  e("t:notify", "TESTS", "fn:notifyUser"),
  e("pc:a", "MODIFIES", "f:user.email"),
  e("pc:a", "MODIFIES", "fn:serializeUser"),
  e("pc:b", "INTRODUCES", "fn:sendReceipt"),
  e("pc:c", "MODIFIES", "fn:notifyUser"),
  e("inc:0412", "INVOLVED", "sc:order"),
  e("inc:0412", "INVOLVED", "ep:get-orders"),
];

const files: CodeFile[] = [
  {
    path: "schemas/user.ts",
    agentId: "agent-a",
    changeId: "PC-A1",
    language: "typescript",
    original: `import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;
`,
    modified: `import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  primaryEmail: z.string().email(),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;
`,
    anchors: [
      { nodeId: "sc:user", line: 3 },
      { nodeId: "f:user.email", line: 6 },
      { nodeId: "f:user.id", line: 4 },
      { nodeId: "pc:a", line: 6 },
    ],
  },
  {
    path: "api/users/serialize.ts",
    agentId: "agent-a",
    changeId: "PC-A1",
    language: "typescript",
    original: `import type { User } from "@/schemas/user";

export function serializeUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    createdAt: row.created_at.toISOString(),
  };
}
`,
    modified: `import type { User } from "@/schemas/user";

export function serializeUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.display_name,
    primaryEmail: row.email,
    createdAt: row.created_at.toISOString(),
  };
}
`,
    anchors: [
      { nodeId: "fn:serializeUser", line: 3 },
      { nodeId: "ep:get-user", line: 3 },
    ],
  },
  {
    path: "billing/receipts.ts",
    agentId: "agent-b",
    changeId: "PC-B1",
    language: "typescript",
    original: `import { mailer } from "@/lib/mailer";
`,
    modified: `import { mailer } from "@/lib/mailer";
import { fetchUser } from "@/lib/client/users";
import type { Order } from "@/schemas/order";

export async function sendReceipt(order: Order) {
  const user = await fetchUser(order.userId);
  const to = user.email.toLowerCase();

  await mailer.send({
    to,
    template: "receipt",
    data: { orderId: order.id, total: order.total },
  });
}
`,
    anchors: [
      { nodeId: "fn:sendReceipt", line: 5 },
      { nodeId: "pc:b", line: 7 },
      { nodeId: "fn:fetchUser", line: 6 },
      { nodeId: "t:receipt-contract", line: 7 },
      { nodeId: "t:receipts-unit", line: 7 },
    ],
  },
  {
    path: "notifications/notify.ts",
    agentId: "agent-c",
    changeId: "PC-C1",
    language: "typescript",
    original: `import { fetchUser } from "@/lib/client/users";
import { push } from "@/lib/push";

export async function notifyUser(userId: string, msg: string) {
  const user = await fetchUser(userId);
  return push.send(user.id, msg);
}
`,
    modified: `import { fetchUser } from "@/lib/client/users";
import { push } from "@/lib/push";
import { mailer } from "@/lib/mailer";

export async function notifyUser(userId: string, msg: string) {
  const user = await fetchUser(userId);
  if (user.prefs.channel === "email") {
    // adapted to PC-A1 (agent-a): User.email -> User.primaryEmail
    return mailer.send({ to: user.primaryEmail, text: msg });
  }
  return push.send(user.id, msg);
}
`,
    anchors: [
      { nodeId: "fn:notifyUser", line: 5 },
      { nodeId: "pc:c", line: 9 },
      { nodeId: "f:notif.channel", line: 7 },
      { nodeId: "t:notify", line: 5 },
    ],
  },
];

export const snapshot: ScenarioSnapshot = {
  sessionId: "S-0917",
  graphName: "stackfox:checkout-service",
  repo: "acme/checkout-service",
  agents: [
    { id: "agent-a", name: "Agent A", slot: "a", branch: "agent-a/rename-user-email", model: "coding-agent", task: "Rename User.email to primaryEmail across the API", status: "idle" },
    { id: "agent-b", name: "Agent B", slot: "b", branch: "agent-b/receipt-emails", model: "coding-agent", task: "Email a receipt after checkout", status: "idle" },
    { id: "agent-c", name: "Agent C", slot: "c", branch: "agent-c/notify-prefs", model: "coding-agent", task: "Respect notification channel preference", status: "idle" },
  ],
  changes: [
    { id: "PC-A1", agentId: "agent-a", title: "Rename User.email → primaryEmail", files: ["schemas/user.ts", "api/users/serialize.ts"], nodeId: "pc:a", touches: ["f:user.email", "fn:serializeUser"], status: "pending", risk: null },
    { id: "PC-B1", agentId: "agent-b", title: "Add sendReceipt() after checkout", files: ["billing/receipts.ts"], nodeId: "pc:b", touches: ["fn:sendReceipt"], status: "pending", risk: null },
    { id: "PC-C1", agentId: "agent-c", title: "Route notifications by channel", files: ["notifications/notify.ts"], nodeId: "pc:c", touches: ["fn:notifyUser"], status: "pending", risk: null },
  ],
  nodes,
  edges,
  incidents: [
    {
      id: "INC-0412",
      title: "Field rename on Order broke iOS client",
      summary: "Order.total_cents renamed to Order.total; mobile client still read total_cents. Caught in prod after 41 min.",
      occurredAt: "2026-08-12T14:20:00Z",
      sessionId: "S-0812",
      nodeId: "inc:0412",
      recalled: false,
    },
  ],
  files,
  mcpTools: [
    { name: "find_consumers", description: "Every function, endpoint and test that reads a node, transitively." },
    { name: "impact_of_change", description: "Subgraph touched by a ProposedChange." },
    { name: "tests_for_path", description: "Only the tests that cover a set of nodes." },
    { name: "pending_changes_by_others", description: "Other agents' unmerged changes overlapping a path." },
    { name: "evidence_path", description: "Shortest path explaining why two changes conflict." },
    { name: "rank_change_risk", description: "Risk score from centrality + incident memory." },
    { name: "blast_radius", description: "Counts of endpoints, functions and tests downstream." },
  ],
  durationMs: 53000,
};

/* ---------------------------- event script ---------------------------- */

type Step = Omit<ToolCallEvent, "id"> & { patches?: StatePatch[] };

const evidence = {
  id: "EV-1",
  from: "pc:a",
  to: "pc:b",
  summary: "PC-A1 removes User.email from the response contract that PC-B1's sendReceipt() reads through fetchUser().",
  cypher:
    "MATCH p = shortestPath((a:ProposedChange {id:'PC-A1'})-[*..8]-(b:ProposedChange {id:'PC-B1'})) RETURN p",
  hops: [
    { nodeId: "pc:a", why: "Agent A's pending change on agent-a/rename-user-email." },
    { nodeId: "f:user.email", edgeId: "pc:a|MODIFIES|f:user.email", relation: "MODIFIES", why: "Renames the field to primaryEmail. The old name stops existing." },
    { nodeId: "sc:user", edgeId: "sc:user|DECLARES|f:user.email", relation: "DECLARED BY", why: "The field is part of the public UserSchema." },
    { nodeId: "ep:get-user", edgeId: "ep:get-user|RETURNS|sc:user", relation: "RETURNED BY", why: "UserSchema is the response contract of this endpoint." },
    { nodeId: "fn:fetchUser", edgeId: "fn:fetchUser|CALLS|ep:get-user", relation: "CALLED BY", why: "The client SDK deserializes that response unchanged." },
    { nodeId: "fn:sendReceipt", edgeId: "fn:sendReceipt|CALLS|fn:fetchUser", relation: "CALLED BY", why: "Reads user.email from fetchUser() — which will be undefined after PC-A1." },
    { nodeId: "pc:b", edgeId: "pc:b|INTRODUCES|fn:sendReceipt", relation: "INTRODUCED BY", why: "Agent B's branch mocks fetchUser(), so its own tests pass." },
  ],
};

const fix = {
  id: "FX-1",
  title: "Read primaryEmail in sendReceipt()",
  agentId: "agent-b",
  file: "billing/receipts.ts",
  language: "typescript",
  original: files[2].modified,
  modified: files[2].modified.replace("user.email.toLowerCase()", "user.primaryEmail.toLowerCase()"),
  rationale:
    "PC-A1 is the higher-centrality change and already adapted by PC-C1, so the consumer adapts rather than reverting the rename.",
};

const run = (id: string, testNodeId: string, name: string, phase: "detect" | "reverify", status: "queued" | "running" | "pass" | "fail", extra: { durationMs?: number; message?: string } = {}): StatePatch => ({
  op: "test",
  run: { id: `${phase}:${id}`, testNodeId, name, path: `tests/${name}`, phase, status, ...extra },
});

const steps: Step[] = [
  { at: 0, actor: "stackfox", kind: "system", message: "Session S-0917 opened · graph stackfox:checkout-service · 25 nodes · 28 edges", patches: [{ op: "phase", phase: "working" }] },
  { at: 900, actor: "agent-a", kind: "action", message: "Started on agent-a/rename-user-email", patches: [{ op: "agent", id: "agent-a", status: "working" }] },
  { at: 1300, actor: "agent-b", kind: "action", message: "Started on agent-b/receipt-emails", patches: [{ op: "agent", id: "agent-b", status: "working" }] },
  { at: 1700, actor: "agent-c", kind: "action", message: "Started on agent-c/notify-prefs", patches: [{ op: "agent", id: "agent-c", status: "working" }] },

  { at: 3000, actor: "agent-a", kind: "tool_call", tool: "impact_of_change", args: { change: "PC-A1" }, message: "impact_of_change", patches: [{ op: "focus", nodeIds: ["pc:a", "f:user.email", "fn:serializeUser"] }] },
  { at: 3400, actor: "agent-a", kind: "tool_result", tool: "impact_of_change", durationMs: 11, result: { touched: ["User.email", "serializeUser()"], endpoints: ["GET /api/users/:id"] }, message: "2 nodes · 1 endpoint" },
  { at: 4600, actor: "agent-b", kind: "tool_call", tool: "tests_for_path", args: { path: "billing/receipts.ts" }, message: "tests_for_path" },
  { at: 4950, actor: "agent-b", kind: "tool_result", tool: "tests_for_path", durationMs: 8, result: ["receipts.unit.test.ts"], message: "1 test" },
  { at: 6000, actor: "agent-a", kind: "test", message: "users.serialize.test.ts passed on branch (4/4)" },
  { at: 7200, actor: "agent-b", kind: "test", message: "receipts.unit.test.ts passed on branch (6/6) · fetchUser() mocked" },

  // prevention
  { at: 8600, actor: "agent-c", kind: "tool_call", tool: "pending_changes_by_others", args: { paths: ["notifications/notify.ts", "schemas/user.ts"] }, message: "pending_changes_by_others", patches: [{ op: "focus", nodeIds: ["pc:c", "fn:notifyUser", "fn:fetchUser"] }] },
  { at: 9100, actor: "agent-c", kind: "tool_result", tool: "pending_changes_by_others", durationMs: 14, result: [{ change: "PC-A1", agent: "agent-a", effect: "User.email → User.primaryEmail" }], message: "1 overlapping change", patches: [{ op: "agent", id: "agent-c", status: "blocked" }, { op: "pulse", nodeIds: ["pc:a"] }] },
  { at: 10400, actor: "agent-c", kind: "prevented", message: "PC-C1 would read User.email, renamed by PC-A1 — adapting to primaryEmail before writing", patches: [{ op: "change", id: "PC-C1", status: "adapted" }, { op: "agent", id: "agent-c", status: "adapted" }] },
  { at: 12000, actor: "agent-c", kind: "test", message: "notify.test.ts passed on branch (3/3) against PC-A1's schema" },

  // merge
  { at: 14000, actor: "git", kind: "merge", message: "git merge agent-a agent-b agent-c → main · 3 branches · 0 textual conflicts", patches: [{ op: "phase", phase: "merged" }] },
  { at: 15000, actor: "ci", kind: "test", message: "CI · 3/3 branch suites green · ready to deploy" },

  // detection
  { at: 16600, actor: "stackfox", kind: "tool_call", tool: "rank_change_risk", args: { changes: ["PC-A1", "PC-B1", "PC-C1"] }, message: "rank_change_risk" },
  { at: 17200, actor: "stackfox", kind: "tool_result", tool: "rank_change_risk", durationMs: 23, result: [{ PC_A1: 0.91 }, { PC_B1: 0.64 }, { PC_C1: 0.22 }], message: "PC-A1 0.91 · PC-B1 0.64 · PC-C1 0.22", patches: [{ op: "risk", ranks: [{ changeId: "PC-A1", risk: 0.91 }, { changeId: "PC-B1", risk: 0.64 }, { changeId: "PC-C1", risk: 0.22 }] }] },
  {
    at: 18200, actor: "stackfox", kind: "recall", message: "Recalled: INC-0412 — field rename on a serialized schema broke the iOS client (session S-0812)",
    patches: [
      { op: "incident", incident: { id: "INC-0412", title: "Field rename on Order broke iOS client", summary: "Order.total_cents renamed to Order.total; mobile client still read total_cents. Caught in prod after 41 min.", occurredAt: "2026-08-12T14:20:00Z", sessionId: "S-0812", nodeId: "inc:0412", recalled: true } },
      { op: "edge", edge: { id: "inc:0412|SIMILAR_TO|pc:a", source: "inc:0412", target: "pc:a", kind: "SIMILAR_TO" } },
      { op: "pulse", nodeIds: ["inc:0412", "pc:a"] },
    ],
  },
  { at: 19800, actor: "stackfox", kind: "tool_call", tool: "find_consumers", args: { node: "User.email", depth: 4, include_pending: true }, message: "find_consumers", patches: [{ op: "focus", nodeIds: ["f:user.email", "sc:user", "ep:get-user", "fn:fetchUser", "fn:sendReceipt"] }] },
  { at: 20400, actor: "stackfox", kind: "tool_result", tool: "find_consumers", durationMs: 17, result: ["serializeUser()", "fetchUser()", "notifyUser() [PC-C1 adapted]", "sendReceipt() [PC-B1 pending]"], message: "4 consumers · 1 unadapted" },
  {
    at: 21800, actor: "stackfox", kind: "conflict", message: "Contract drift · PC-B1 reads User.email, which PC-A1 removes",
    patches: [
      { op: "phase", phase: "conflict" },
      { op: "change", id: "PC-A1", status: "conflict" },
      { op: "change", id: "PC-B1", status: "conflict" },
      { op: "agent", id: "agent-b", status: "blocked" },
      { op: "pulse", nodeIds: ["pc:a", "pc:b"] },
    ],
  },

  // evidence
  { at: 23400, actor: "stackfox", kind: "tool_call", tool: "evidence_path", args: { from: "PC-A1", to: "PC-B1" }, message: "evidence_path" },
  { at: 24000, actor: "stackfox", kind: "tool_result", tool: "evidence_path", durationMs: 9, result: { hops: 6, path: "PC-A1 → User.email → UserSchema → GET /api/users/:id → fetchUser() → sendReceipt() → PC-B1" }, message: "6 hops", patches: [{ op: "phase", phase: "evidence" }, { op: "evidence", path: evidence }] },

  // targeted tests
  { at: 30500, actor: "stackfox", kind: "tool_call", tool: "tests_for_path", args: { nodes: ["sc:user", "ep:get-user", "fn:fetchUser", "fn:sendReceipt"] }, message: "tests_for_path" },
  {
    at: 31000, actor: "stackfox", kind: "tool_result", tool: "tests_for_path", durationMs: 12, result: ["users.serialize.test.ts", "receipts.contract.test.ts", "checkout.e2e.test.ts"], message: "3 of 412 tests selected",
    patches: [
      { op: "phase", phase: "tests" },
      run("serialize", "t:user-serialize", "users.serialize.test.ts", "detect", "queued"),
      run("contract", "t:receipt-contract", "receipts.contract.test.ts", "detect", "queued"),
      run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "detect", "queued"),
    ],
  },
  { at: 32000, actor: "stackfox", kind: "action", message: "Running 3 targeted tests on merged main", patches: [run("serialize", "t:user-serialize", "users.serialize.test.ts", "detect", "running"), run("contract", "t:receipt-contract", "receipts.contract.test.ts", "detect", "running"), run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "detect", "running")] },
  { at: 33300, actor: "ci", kind: "test", message: "✓ users.serialize.test.ts · 312ms", patches: [run("serialize", "t:user-serialize", "users.serialize.test.ts", "detect", "pass", { durationMs: 312 })] },
  { at: 34700, actor: "ci", kind: "test", message: "✗ receipts.contract.test.ts · TypeError: Cannot read properties of undefined (reading 'toLowerCase')", patches: [run("contract", "t:receipt-contract", "receipts.contract.test.ts", "detect", "fail", { durationMs: 488, message: "TypeError: Cannot read properties of undefined (reading 'toLowerCase')\n  at sendReceipt (billing/receipts.ts:7:24)\n  response keys: id, name, primaryEmail, createdAt" }), { op: "pulse", nodeIds: ["t:receipt-contract"] }] },
  { at: 36000, actor: "ci", kind: "test", message: "✗ checkout.e2e.test.ts · receipt not sent: recipient undefined", patches: [run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "detect", "fail", { durationMs: 1904, message: "AssertionError: expected mailer.send to be called with { to: 'ada@acme.dev' }\n  received: { to: undefined }" }), { op: "pulse", nodeIds: ["t:checkout-e2e"] }] },
  { at: 37400, actor: "stackfox", kind: "tool_call", tool: "blast_radius", args: { node: "User.email" }, message: "blast_radius" },
  { at: 37800, actor: "stackfox", kind: "tool_result", tool: "blast_radius", durationMs: 10, result: { endpoints: 2, functions: 4, tests: 4 }, message: "2 endpoints · 4 functions · 4 tests" },

  // fix
  { at: 39500, actor: "stackfox", kind: "fix", message: "Proposed FX-1 for agent-b/receipt-emails: read user.primaryEmail", patches: [{ op: "phase", phase: "fix" }, { op: "fix", fix: { ...fix, status: "proposed" } }, { op: "focus", nodeIds: ["fn:sendReceipt", "pc:b"] }] },
  { at: 42500, actor: "agent-b", kind: "action", message: "Applied FX-1 to agent-b/receipt-emails", patches: [{ op: "fix", fix: { ...fix, status: "applied" } }, { op: "agent", id: "agent-b", status: "working" }] },
  {
    at: 44000, actor: "stackfox", kind: "action", message: "Re-verifying the same 3 targeted tests",
    patches: [
      { op: "fix", fix: { ...fix, status: "verifying" } },
      run("serialize", "t:user-serialize", "users.serialize.test.ts", "reverify", "running"),
      run("contract", "t:receipt-contract", "receipts.contract.test.ts", "reverify", "running"),
      run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "reverify", "running"),
    ],
  },
  { at: 45300, actor: "ci", kind: "test", message: "✓ users.serialize.test.ts · 298ms", patches: [run("serialize", "t:user-serialize", "users.serialize.test.ts", "reverify", "pass", { durationMs: 298 })] },
  { at: 46500, actor: "ci", kind: "test", message: "✓ receipts.contract.test.ts · 451ms", patches: [run("contract", "t:receipt-contract", "receipts.contract.test.ts", "reverify", "pass", { durationMs: 451 }), { op: "pulse", nodeIds: ["t:receipt-contract"] }] },
  { at: 48000, actor: "ci", kind: "test", message: "✓ checkout.e2e.test.ts · 1.71s", patches: [run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "reverify", "pass", { durationMs: 1712 }), { op: "pulse", nodeIds: ["t:checkout-e2e"] }] },
  {
    at: 49500, actor: "stackfox", kind: "verified", message: "Verified · 3/3 targeted tests pass on merged main · merge unblocked",
    patches: [
      { op: "phase", phase: "verified" },
      { op: "fix", fix: { ...fix, status: "verified" } },
      { op: "change", id: "PC-A1", status: "verified" },
      { op: "change", id: "PC-B1", status: "verified" },
      { op: "change", id: "PC-C1", status: "verified" },
      { op: "agent", id: "agent-a", status: "verified" },
      { op: "agent", id: "agent-b", status: "verified" },
      { op: "agent", id: "agent-c", status: "verified" },
    ],
  },
  {
    at: 51500, actor: "stackfox", kind: "recall", message: "Stored INC-0917 · contract drift on User.email (PC-A1 × PC-B1) for future sessions",
    patches: [
      { op: "node", node: { id: "inc:0917", kind: "incident", label: "INC-0917", centrality: 0.2 } },
      { op: "edge", edge: { id: "inc:0917|INVOLVED|f:user.email", source: "inc:0917", target: "f:user.email", kind: "INVOLVED" } },
      { op: "incident", incident: { id: "INC-0917", title: "Contract drift on User.email", summary: "PC-A1 renamed User.email; PC-B1 consumed it via fetchUser(). Caught pre-merge, fixed by FX-1.", occurredAt: "2026-10-17T00:00:00Z", sessionId: "S-0917", nodeId: "inc:0917", recalled: false, isNew: true } },
      { op: "pulse", nodeIds: ["inc:0917"] },
    ],
  },
  { at: 53000, actor: "stackfox", kind: "system", message: "Session complete · 1 conflict caught · 1 prevented · 1 incident recalled · 1 stored" },
];

export const script: StreamEvent[] = steps.map(({ patches = [], ...log }, i) => ({
  seq: i,
  at: log.at,
  log: { id: `ev-${i}`, ...log },
  patches,
}));
