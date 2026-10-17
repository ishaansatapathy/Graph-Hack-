import { Router } from "express";
import type { Request, Response } from "express";

export const scenarioRouter = Router();

const snapshot = {
  sessionId: "S-0917",
  graphName: "stackfox:checkout-service",
  repo: "acme/checkout-service",
  agents: [
    {
      id: "agent-a",
      name: "Agent A",
      slot: "a",
      branch: "agent-a/rename-user-email",
      model: "coding-agent",
      task: "Rename User.email to primaryEmail across the API",
      status: "idle",
    },
    {
      id: "agent-b",
      name: "Agent B",
      slot: "b",
      branch: "agent-b/receipt-emails",
      model: "coding-agent",
      task: "Email a receipt after checkout",
      status: "idle",
    },
    {
      id: "agent-c",
      name: "Agent C",
      slot: "c",
      branch: "agent-c/notify-prefs",
      model: "coding-agent",
      task: "Respect notification channel preference",
      status: "idle",
    },
  ],
  changes: [
    {
      id: "PC-A1",
      agentId: "agent-a",
      title: "Rename User.email → primaryEmail",
      file: "schemas/user.ts",
      status: "pending",
      risk: 0.91,
      touches: ["f:user.email", "fn:serializeUser"],
    },
    {
      id: "PC-B1",
      agentId: "agent-b",
      title: "sendReceipt(): read user.email",
      file: "billing/receipts.ts",
      status: "pending",
      risk: 0.64,
      touches: ["fn:sendReceipt", "fn:fetchUser", "f:user.email"],
    },
    {
      id: "PC-C1",
      agentId: "agent-c",
      title: "notifyUser(): check channel preference",
      file: "notifications/notify.ts",
      status: "pending",
      risk: 0.22,
      touches: ["fn:notifyUser", "f:notif.channel"],
    },
  ],
  nodes: [
    { id: "ep:get-user", kind: "endpoint", label: "GET /api/users/:id", path: "api/users/[id].ts", line: 8, centrality: 0.81 },
    { id: "ep:post-checkout", kind: "endpoint", label: "POST /api/checkout", path: "api/checkout.ts", line: 12, centrality: 0.58 },
    { id: "ep:get-orders", kind: "endpoint", label: "GET /api/orders", path: "api/orders.ts", line: 6, centrality: 0.34 },
    { id: "sc:user", kind: "schema", label: "UserSchema", path: "schemas/user.ts", line: 3, centrality: 0.74 },
    { id: "sc:order", kind: "schema", label: "OrderSchema", path: "schemas/order.ts", line: 3, centrality: 0.4 },
    { id: "sc:notif", kind: "schema", label: "NotificationPrefs", path: "schemas/notifications.ts", line: 3, centrality: 0.22 },
    { id: "f:user.email", kind: "field", label: "User.email", path: "schemas/user.ts", line: 6, centrality: 0.92 },
    { id: "f:user.id", kind: "field", label: "User.id", path: "schemas/user.ts", line: 4, centrality: 0.3 },
    { id: "f:order.total", kind: "field", label: "Order.total", path: "schemas/order.ts", line: 7, centrality: 0.36 },
    { id: "f:notif.channel", kind: "field", label: "NotificationPrefs.channel", path: "schemas/notifications.ts", line: 5, centrality: 0.18 },
    { id: "fn:serializeUser", kind: "function", label: "serializeUser()", path: "api/users/serialize.ts", line: 4, centrality: 0.52 },
    { id: "fn:fetchUser", kind: "function", label: "fetchUser()", path: "lib/client/users.ts", line: 9, centrality: 0.66 },
    { id: "fn:sendReceipt", kind: "function", label: "sendReceipt()", path: "billing/receipts.ts", line: 6, centrality: 0.61, agentId: "agent-b" },
    { id: "fn:createCheckout", kind: "function", label: "createCheckout()", path: "billing/checkout.ts", line: 14, centrality: 0.55 },
    { id: "fn:computeTotal", kind: "function", label: "computeTotal()", path: "billing/total.ts", line: 3, centrality: 0.28 },
    { id: "fn:notifyUser", kind: "function", label: "notifyUser()", path: "notifications/notify.ts", line: 5, centrality: 0.33 },
    { id: "t:user-serialize", kind: "test", label: "users.serialize.test.ts", path: "tests/users.serialize.test.ts", line: 1, centrality: 0.12 },
    { id: "t:receipt-contract", kind: "test", label: "receipts.contract.test.ts", path: "tests/receipts.contract.test.ts", line: 1, centrality: 0.14 },
    { id: "t:receipts-unit", kind: "test", label: "receipts.unit.test.ts", path: "tests/receipts.unit.test.ts", line: 1, centrality: 0.08 },
    { id: "t:checkout-e2e", kind: "test", label: "checkout.e2e.test.ts", path: "tests/checkout.e2e.test.ts", line: 1, centrality: 0.16 },
    { id: "t:notify", kind: "test", label: "notify.test.ts", path: "tests/notify.test.ts", line: 1, centrality: 0.07 },
    { id: "pc:a", kind: "change", label: "PC-A1", centrality: 0.7, agentId: "agent-a" },
    { id: "pc:b", kind: "change", label: "PC-B1", centrality: 0.5, agentId: "agent-b" },
    { id: "pc:c", kind: "change", label: "PC-C1", centrality: 0.3, agentId: "agent-c" },
    { id: "inc:0412", kind: "incident", label: "INC-0412", centrality: 0.2 },
  ],
  edges: [
    { id: "sc:user|DECLARES|f:user.email", source: "sc:user", target: "f:user.email", kind: "DECLARES" },
    { id: "sc:user|DECLARES|f:user.id", source: "sc:user", target: "f:user.id", kind: "DECLARES" },
    { id: "sc:order|DECLARES|f:order.total", source: "sc:order", target: "f:order.total", kind: "DECLARES" },
    { id: "sc:notif|DECLARES|f:notif.channel", source: "sc:notif", target: "f:notif.channel", kind: "DECLARES" },
    { id: "ep:get-user|RETURNS|sc:user", source: "ep:get-user", target: "sc:user", kind: "RETURNS" },
    { id: "ep:get-orders|RETURNS|sc:order", source: "ep:get-orders", target: "sc:order", kind: "RETURNS" },
    { id: "ep:get-user|CALLS|fn:serializeUser", source: "ep:get-user", target: "fn:serializeUser", kind: "CALLS" },
    { id: "fn:serializeUser|READS|f:user.email", source: "fn:serializeUser", target: "f:user.email", kind: "READS" },
    { id: "fn:serializeUser|READS|f:user.id", source: "fn:serializeUser", target: "f:user.id", kind: "READS" },
    { id: "fn:fetchUser|CALLS|ep:get-user", source: "fn:fetchUser", target: "ep:get-user", kind: "CALLS" },
    { id: "ep:post-checkout|CALLS|fn:createCheckout", source: "ep:post-checkout", target: "fn:createCheckout", kind: "CALLS" },
    { id: "fn:createCheckout|CALLS|fn:computeTotal", source: "fn:createCheckout", target: "fn:computeTotal", kind: "CALLS" },
    { id: "fn:createCheckout|CALLS|fn:sendReceipt", source: "fn:createCheckout", target: "fn:sendReceipt", kind: "CALLS" },
    { id: "fn:computeTotal|READS|f:order.total", source: "fn:computeTotal", target: "f:order.total", kind: "READS" },
    { id: "fn:sendReceipt|CALLS|fn:fetchUser", source: "fn:sendReceipt", target: "fn:fetchUser", kind: "CALLS" },
    { id: "fn:notifyUser|CALLS|fn:fetchUser", source: "fn:notifyUser", target: "fn:fetchUser", kind: "CALLS" },
    { id: "fn:notifyUser|READS|f:notif.channel", source: "fn:notifyUser", target: "f:notif.channel", kind: "READS" },
    { id: "t:user-serialize|TESTS|fn:serializeUser", source: "t:user-serialize", target: "fn:serializeUser", kind: "TESTS" },
    { id: "t:receipt-contract|TESTS|fn:sendReceipt", source: "t:receipt-contract", target: "fn:sendReceipt", kind: "TESTS" },
    { id: "t:receipts-unit|TESTS|fn:sendReceipt", source: "t:receipts-unit", target: "fn:sendReceipt", kind: "TESTS" },
    { id: "t:checkout-e2e|TESTS|ep:post-checkout", source: "t:checkout-e2e", target: "ep:post-checkout", kind: "TESTS" },
    { id: "t:notify|TESTS|fn:notifyUser", source: "t:notify", target: "fn:notifyUser", kind: "TESTS" },
    { id: "pc:a|MODIFIES|f:user.email", source: "pc:a", target: "f:user.email", kind: "MODIFIES" },
    { id: "pc:a|MODIFIES|fn:serializeUser", source: "pc:a", target: "fn:serializeUser", kind: "MODIFIES" },
    { id: "pc:b|INTRODUCES|fn:sendReceipt", source: "pc:b", target: "fn:sendReceipt", kind: "INTRODUCES" },
    { id: "pc:c|MODIFIES|fn:notifyUser", source: "pc:c", target: "fn:notifyUser", kind: "MODIFIES" },
    { id: "inc:0412|INVOLVED|sc:order", source: "inc:0412", target: "sc:order", kind: "INVOLVED" },
    { id: "inc:0412|INVOLVED|ep:get-orders", source: "inc:0412", target: "ep:get-orders", kind: "INVOLVED" },
  ],
  incidents: [],
  files: [
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
        { nodeId: "sc:user", line: 3, label: "UserSchema" },
        { nodeId: "f:user.email", line: 6, label: "email / primaryEmail" },
      ],
    },
    {
      path: "billing/receipts.ts",
      agentId: "agent-b",
      changeId: "PC-B1",
      language: "typescript",
      original: `// new file on agent-b branch
`,
      modified: `import { fetchUser } from "@/lib/client/users";
import { mailer } from "@/lib/mailer";

export async function sendReceipt(userId: string, orderId: string, amount: number) {
  const user = await fetchUser(userId);
  return mailer.send({
    to: user.email.toLowerCase(),
    subject: \`Your receipt for order \${orderId}\`,
    body: \`Charged $\${(amount / 100).toFixed(2)}\`,
  });
}
`,
      anchors: [
        { nodeId: "fn:sendReceipt", line: 4, label: "sendReceipt()" },
      ],
    },
  ],
  mcpTools: [
    { name: "impact_of_change", description: "Downstream blast radius of a pending patch" },
    { name: "pending_changes_by_others", description: "Other agents currently editing reachable files" },
    { name: "rank_change_risk", description: "Spectral centrality of changes against historical incidents" },
    { name: "find_consumers", description: "Graph traversal from a field or function to all call sites" },
    { name: "evidence_path", description: "Shortest explanation path between two conflicting changes" },
    { name: "tests_for_path", description: "Minimal targeted test suite covering an evidence path" },
    { name: "blast_radius", description: "All endpoints, functions and tests reachable from a node" },
  ],
  durationMs: 54000,
};

const evidence = {
  summary: "Agent A renames User.email to primaryEmail. Agent B concurrently adds sendReceipt(), which reads user.email. In isolation both branches compile and their tests pass; combined, sendReceipt() dereferences undefined in production.",
  hops: [
    { nodeId: "pc:a", label: "PC-A1 · agent-a", annotation: "removes field 'email' from UserSchema" },
    { nodeId: "f:user.email", label: "User.email", annotation: "schema field declared in schemas/user.ts" },
    { nodeId: "sc:user", label: "UserSchema", annotation: "exported zod schema for the user record" },
    { nodeId: "ep:get-user", label: "GET /api/users/:id", annotation: "returns UserSchema to callers" },
    { nodeId: "fn:fetchUser", label: "fetchUser()", annotation: "typed HTTP client wrapper" },
    { nodeId: "fn:sendReceipt", label: "sendReceipt()", annotation: "reads user.email — introduced by PC-B1" },
    { nodeId: "pc:b", label: "PC-B1 · agent-b", annotation: "calls sendReceipt() on checkout success" },
  ],
  cypher: `MATCH p = (ca:Change {id: 'PC-A1'})-[:MODIFIES]->(f:Field {name: 'email'})
          <-[:DECLARES]-(s:Schema)<-[:RETURNS]-(ep:Endpoint)
          <-[:CALLS]-(cli:Function)<-[:CALLS]-(fn:Function)
          <-[:INTRODUCES]-(cb:Change {id: 'PC-B1'})
RETURN p;`,
};

const fix = {
  id: "FX-1",
  agentId: "agent-b",
  file: "billing/receipts.ts",
  description: "Read user.primaryEmail instead of user.email, preserving backward-compatibility with fallback",
  original: `export async function sendReceipt(userId: string, orderId: string, amount: number) {
  const user = await fetchUser(userId);
  return mailer.send({
    to: user.email.toLowerCase(),
    subject: \`Your receipt for order \${orderId}\`,
    body: \`Charged $\${(amount / 100).toFixed(2)}\`,
  });
}`,
  modified: `export async function sendReceipt(userId: string, orderId: string, amount: number) {
  const user = await fetchUser(userId);
  const recipient = ("primaryEmail" in user ? user.primaryEmail : user.email) as string;
  return mailer.send({
    to: recipient.toLowerCase(),
    subject: \`Your receipt for order \${orderId}\`,
    body: \`Charged $\${(amount / 100).toFixed(2)}\`,
  });
}`,
  status: "proposed" as const,
};

const run = (id: string, testNodeId: string, name: string, phase: "detect" | "reverify", status: "queued" | "running" | "pass" | "fail", rest: Record<string, unknown> = {}) => ({
  op: "test_run" as const,
  run: { id, testNodeId, name, phase, status, ...rest },
});

const steps = [
  { at: 0, actor: "stackfox", kind: "system", message: "Session S-0917 opened · graph stackfox:checkout-service · 25 nodes · 28 edges", patches: [{ op: "phase", phase: "working" }] },
  { at: 900, actor: "agent-a", kind: "action", message: "Started on agent-a/rename-user-email", patches: [{ op: "agent", id: "agent-a", status: "working" }] },
  { at: 1300, actor: "agent-b", kind: "action", message: "Started on agent-b/receipt-emails", patches: [{ op: "agent", id: "agent-b", status: "working" }] },
  { at: 1700, actor: "agent-c", kind: "action", message: "Started on agent-c/notify-prefs", patches: [{ op: "agent", id: "agent-c", status: "working" }] },
  { at: 3100, actor: "agent-a", kind: "tool_call", tool: "impact_of_change", args: { file: "schemas/user.ts", symbol: "User.email" }, message: "impact_of_change" },
  { at: 3500, actor: "agent-a", kind: "tool_result", tool: "impact_of_change", durationMs: 14, result: { nodes: 2, endpoints: 1 }, message: "2 nodes · 1 endpoint", patches: [{ op: "focus", nodeIds: ["f:user.email", "fn:serializeUser"] }] },
  { at: 5200, actor: "agent-a", kind: "action", message: "Wrote PC-A1 · renamed User.email to primaryEmail", patches: [{ op: "node", node: { id: "pc:a", kind: "change", label: "PC-A1", centrality: 0.7, agentId: "agent-a" } }, { op: "edge", edge: { id: "pc:a|MODIFIES|f:user.email", source: "pc:a", target: "f:user.email", kind: "MODIFIES" } }] },
  { at: 7400, actor: "agent-b", kind: "action", message: "Wrote PC-B1 · added sendReceipt() consuming fetchUser()", patches: [{ op: "node", node: { id: "pc:b", kind: "change", label: "PC-B1", centrality: 0.5, agentId: "agent-b" } }, { op: "edge", edge: { id: "pc:b|INTRODUCES|fn:sendReceipt", source: "pc:b", target: "fn:sendReceipt", kind: "INTRODUCES" } }] },
  { at: 9200, actor: "agent-c", kind: "tool_call", tool: "pending_changes_by_others", args: { file: "notifications/notify.ts" }, message: "pending_changes_by_others" },
  { at: 9600, actor: "agent-c", kind: "tool_result", tool: "pending_changes_by_others", durationMs: 8, result: [], message: "0 overlapping changes" },
  { at: 11200, actor: "agent-c", kind: "action", message: "Wrote PC-C1 · notification preferences respected", patches: [{ op: "node", node: { id: "pc:c", kind: "change", label: "PC-C1", centrality: 0.3, agentId: "agent-c" } }, { op: "edge", edge: { id: "pc:c|MODIFIES|fn:notifyUser", source: "pc:c", target: "fn:notifyUser", kind: "MODIFIES" } }] },
  { at: 13000, actor: "git", kind: "action", message: "All 3 agents opened pull requests · git merge-tree clean (no text conflicts)" },
  { at: 15000, actor: "ci", kind: "test", message: "CI · 3/3 branch suites green · ready to deploy" },
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
    ],
  },
  { at: 23400, actor: "stackfox", kind: "tool_call", tool: "evidence_path", args: { from: "PC-A1", to: "PC-B1" }, message: "evidence_path" },
  { at: 24000, actor: "stackfox", kind: "tool_result", tool: "evidence_path", durationMs: 9, result: { hops: 6, path: "PC-A1 → User.email → UserSchema → GET /api/users/:id → fetchUser() → sendReceipt() → PC-B1" }, message: "6 hops", patches: [{ op: "phase", phase: "evidence" }, { op: "evidence", path: evidence }] },
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
  { at: 46500, actor: "ci", kind: "test", message: "✓ receipts.contract.test.ts · 451ms", patches: [run("contract", "t:receipt-contract", "receipts.contract.test.ts", "reverify", "pass", { durationMs: 451 }), { op: "pulse", nodeIds: ["t:receipt-contract"] }] },
  { at: 48000, actor: "ci", kind: "test", message: "✓ checkout.e2e.test.ts · 1.71s", patches: [run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "reverify", "pass", { durationMs: 1712 }), { op: "pulse", nodeIds: ["t:checkout-e2e"] }] },
  {
    at: 49500, actor: "stackfox", kind: "verified", message: "Verified · 3/3 targeted tests pass on merged main · merge unblocked",
    patches: [
      { op: "phase", phase: "verified" },
      { op: "fix", fix: { ...fix, status: "verified" } },
      run("serialize", "t:user-serialize", "users.serialize.test.ts", "reverify", "pass"),
      run("contract", "t:receipt-contract", "receipts.contract.test.ts", "reverify", "pass"),
      run("e2e", "t:checkout-e2e", "checkout.e2e.test.ts", "reverify", "pass"),
      { op: "change", id: "PC-A1", status: "verified" },
      { op: "change", id: "PC-B1", status: "verified" },
      { op: "agent", id: "agent-b", status: "verified" },
    ],
  },
  {
    at: 51500, actor: "stackfox", kind: "recall", message: "Stored INC-0917 · contract drift on User.email (PC-A1 × PC-B1) for future sessions",
    patches: [
      { op: "node", node: { id: "inc:0917", kind: "incident", label: "INC-0917", centrality: 0.2 } },
      { op: "edge", edge: { id: "inc:0917|INVOLVED|f:user.email", source: "inc:0917", target: "f:user.email", kind: "INVOLVED" } },
      { op: "pulse", nodeIds: ["inc:0917"] },
    ],
  },
  { at: 53000, actor: "stackfox", kind: "system", message: "Session complete · 1 conflict caught · 1 prevented · 1 incident recalled · 1 stored" },
];

const script = steps.map(({ patches = [], ...log }, i) => ({
  seq: i + 1,
  at: log.at,
  log,
  patches,
}));

scenarioRouter.get("/scenario", (_req: Request, res: Response) => {
  res.json(snapshot);
});

scenarioRouter.get("/events", async (req: Request, res: Response) => {
  const speed = Math.max(0.1, Math.min(10, Number(req.query.speed) || 1));
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  res.write("retry: 600000\n\n");

  let last = 0;
  for (const ev of script) {
    if (aborted) break;
    const delay = Math.max(0, (ev.at - last) / speed);
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    if (aborted) break;
    last = ev.at;
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  if (!aborted) {
    res.write("event: end\ndata: {}\n\n");
    res.end();
  }
});
