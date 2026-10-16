import { getGraph } from "./falkordb";

const WRITE_PATTERN = /\b(create|merge|delete|detach|set|remove|drop|load|foreach|call)\b/i;

export function assertReadOnlyCypher(cypher: string) {
  if (WRITE_PATTERN.test(cypher)) {
    throw new Error("Only read-only Cypher is allowed (no CREATE/MERGE/DELETE/SET/REMOVE/CALL)");
  }
}

type Row = Record<string, unknown>;

async function ro(cypher: string, params: Record<string, string | number> = {}) {
  const graph = await getGraph();
  const res = await graph.roQuery(cypher, { params });
  return (res.data ?? []) as Row[];
}

/** Demo scenario: JWT refresh-token refactor vs 15-minute expiry security hotfix. */
const SEED_STATEMENTS: string[] = [
  "MATCH (n) DETACH DELETE n",
  `CREATE (:Repository {name:'stackfox/payments-api', defaultBranch:'main'})`,
  `MATCH (r:Repository)
   CREATE (r)-[:CONTAINS]->(:File {path:'src/auth/token-service.ts', language:'ts'}),
          (r)-[:CONTAINS]->(:File {path:'src/routes/auth.ts', language:'ts'}),
          (r)-[:CONTAINS]->(:File {path:'src/routes/checkout.ts', language:'ts'}),
          (r)-[:CONTAINS]->(:File {path:'tests/token.test.ts', language:'ts'})`,
  `MATCH (f1:File {path:'src/auth/token-service.ts'}), (f2:File {path:'src/routes/auth.ts'}), (f3:File {path:'src/routes/checkout.ts'})
   CREATE (f1)-[:DECLARES]->(:Function {name:'verifyToken', file:'src/auth/token-service.ts', signature:'verifyToken(token: string): Claims'}),
          (f1)-[:DECLARES]->(:Function {name:'issueRefreshToken', file:'src/auth/token-service.ts', signature:'issueRefreshToken(userId: string): string'}),
          (f1)-[:DECLARES]->(:Function {name:'refreshSession', file:'src/auth/token-service.ts', signature:'refreshSession(refresh: string): Session'}),
          (f2)-[:DECLARES]->(:Function {name:'loginHandler', file:'src/routes/auth.ts', signature:'loginHandler(req, res)'}),
          (f3)-[:DECLARES]->(:Function {name:'checkoutHandler', file:'src/routes/checkout.ts', signature:'checkoutHandler(req, res)'})`,
  `MATCH (a:Function {name:'loginHandler'}), (b:Function {name:'issueRefreshToken'}), (c:Function {name:'checkoutHandler'}),
         (v:Function {name:'verifyToken'}), (s:Function {name:'refreshSession'})
   CREATE (a)-[:CALLS]->(b), (c)-[:CALLS]->(v), (s)-[:CALLS]->(v), (s)-[:CALLS]->(b)`,
  `MATCH (f:File {path:'tests/token.test.ts'}), (v:Function {name:'verifyToken'}), (s:Function {name:'refreshSession'})
   CREATE (f)-[:DECLARES]->(t1:Test {name:'test_token_expiry', status:'passing'}),
          (f)-[:DECLARES]->(t2:Test {name:'test_refresh_rotation', status:'passing'}),
          (t1)-[:TESTS]->(v), (t2)-[:TESTS]->(s)`,
  `MATCH (v:Function {name:'verifyToken'}), (i:Function {name:'issueRefreshToken'}), (s:Function {name:'refreshSession'})
   CREATE (h:Commit {sha:'a1b2c3d', message:'fix(auth): enforce 15m access-token expiry AUTH-151', author:'priya', branch:'main'}),
          (p:Commit {sha:'d4e5f6a', message:'feat(auth): refresh token flow AUTH-142', author:'ishaan', branch:'feature/jwt-refresh'}),
          (h)-[:MODIFIED]->(v),
          (p)-[:MODIFIED]->(v), (p)-[:MODIFIED]->(i), (p)-[:MODIFIED]->(s),
          (h)-[:REFERENCES]->(:Issue {key:'AUTH-151', title:'Security: access tokens must expire in 15 minutes', status:'In Review'}),
          (p)-[:REFERENCES]->(:Issue {key:'AUTH-142', title:'Zero-downtime refresh token migration', status:'In Progress'})`,
  `MATCH (v:Function {name:'verifyToken'}), (i:Issue {key:'AUTH-151'})
   CREATE (d:Discussion {channel:'#dev-security', author:'priya', text:'Do NOT drop the 15m expiry check when adding refresh tokens. Audit requirement.'}),
          (d)-[:MENTIONS]->(i), (d)-[:CONCERNS]->(v),
          (dec:Decision {title:'Access tokens expire in 15 minutes', rationale:'Security audit SEC-77', status:'active'}),
          (dec)-[:CONSTRAINS]->(v), (dec)-[:DECIDED_IN]->(d)`,
  `MATCH (v:Function {name:'verifyToken'}), (h:Commit {sha:'a1b2c3d'}), (p:Commit {sha:'d4e5f6a'})
   CREATE (c:Conflict {id:'conflict-1', file:'src/auth/token-service.ts', baseBranch:'main', incomingBranch:'feature/jwt-refresh'}),
          (c)-[:AFFECTS]->(v), (c)-[:BETWEEN]->(h), (c)-[:BETWEEN]->(p)`,
];

export async function seedDemoGraph() {
  const graph = await getGraph();
  for (const statement of SEED_STATEMENTS) {
    await graph.query(statement);
  }
  return getGraphStats();
}

export async function getGraphStats() {
  const nodes = await ro("MATCH (n) RETURN count(n) AS c");
  const rels = await ro("MATCH ()-[r]->() RETURN count(r) AS c");
  const labels = await ro("MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY c DESC");
  return {
    nodeCount: Number(nodes[0]?.c ?? 0),
    relCount: Number(rels[0]?.c ?? 0),
    labels: labels.map((r) => ({ label: String(r.label), count: Number(r.c) })),
  };
}

export type GraphNode = { id: string; label: string; title: string; properties: Record<string, unknown> };
export type GraphEdge = { source: string; target: string; type: string };

function nodeTitle(label: string, props: Record<string, unknown>) {
  return String(props.name ?? props.key ?? props.path ?? props.sha ?? props.title ?? props.id ?? props.channel ?? label);
}

export async function getSubgraph(limit = 200) {
  const nodeRows = await ro(
    "MATCH (n) RETURN id(n) AS id, labels(n)[0] AS label, properties(n) AS props LIMIT $limit",
    { limit },
  );
  const nodes: GraphNode[] = nodeRows.map((r) => {
    const props = (r.props ?? {}) as Record<string, unknown>;
    const label = String(r.label);
    return { id: String(r.id), label, title: nodeTitle(label, props), properties: props };
  });
  const edgeRows = await ro(
    "MATCH (a)-[r]->(b) RETURN id(a) AS s, id(b) AS t, type(r) AS type LIMIT $limit",
    { limit: limit * 3 },
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = edgeRows
    .map((r) => ({ source: String(r.s), target: String(r.t), type: String(r.type) }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

export async function runReadOnlyCypher(cypher: string) {
  assertReadOnlyCypher(cypher);
  const query = /\blimit\b/i.test(cypher) ? cypher : `${cypher} LIMIT 100`;
  const rows = await ro(query);
  return { cypher: query, rows };
}

export type SymbolContext = {
  symbol: string;
  file: string | null;
  callers: string[];
  callees: string[];
  tests: string[];
  commits: string[];
  issues: string[];
  discussions: string[];
  decisions: string[];
  conflicts: string[];
  cypher: string;
};

const CONTEXT_CYPHER = `MATCH (f:Function {name: $symbol})
OPTIONAL MATCH (caller:Function)-[:CALLS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee:Function)
OPTIONAL MATCH (t:Test)-[:TESTS]->(f)
OPTIONAL MATCH (c:Commit)-[:MODIFIED]->(f)
OPTIONAL MATCH (c)-[:REFERENCES]->(i:Issue)
OPTIONAL MATCH (m:Discussion)-[:CONCERNS]->(f)
OPTIONAL MATCH (d:Decision)-[:CONSTRAINS]->(f)
OPTIONAL MATCH (x:Conflict)-[:AFFECTS]->(f)
RETURN f.file AS file,
  collect(DISTINCT caller.name) AS callers, collect(DISTINCT callee.name) AS callees,
  collect(DISTINCT t.name) AS tests,
  collect(DISTINCT c.sha + ' ' + c.message + ' [' + c.branch + ']') AS commits,
  collect(DISTINCT i.key + ': ' + i.title) AS issues,
  collect(DISTINCT m.channel + ' @' + m.author + ': ' + m.text) AS discussions,
  collect(DISTINCT d.title + ' (' + d.rationale + ')') AS decisions,
  collect(DISTINCT x.id) AS conflicts`;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => x != null).map(String) : [];
}

/** Multi-hop engineering context around a function — the GraphRAG retrieval step. */
export async function getSymbolContext(symbol: string): Promise<SymbolContext | null> {
  const rows = await ro(CONTEXT_CYPHER, { symbol });
  const r = rows[0];
  if (!r) return null;
  return {
    symbol,
    file: r.file == null ? null : String(r.file),
    callers: strings(r.callers),
    callees: strings(r.callees),
    tests: strings(r.tests),
    commits: strings(r.commits),
    issues: strings(r.issues),
    discussions: strings(r.discussions),
    decisions: strings(r.decisions),
    conflicts: strings(r.conflicts),
    cypher: CONTEXT_CYPHER.replace("$symbol", `'${symbol}'`),
  };
}

export async function listFunctionNames(): Promise<string[]> {
  const rows = await ro("MATCH (f:Function) RETURN f.name AS name");
  return rows.map((r) => String(r.name));
}
