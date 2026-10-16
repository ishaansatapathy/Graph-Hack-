import { type CypherParams, graphRead, graphWrite, type Row } from "./falkordb";

const WRITE_PATTERN = /\b(create|merge|delete|detach|set|remove|drop|load|foreach|call)\b/i;

export function assertReadOnlyCypher(cypher: string) {
  if (WRITE_PATTERN.test(cypher)) {
    throw new Error("Only read-only Cypher is allowed (no CREATE/MERGE/DELETE/SET/REMOVE/CALL)");
  }
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

export async function seedDemoGraph(workspaceId: string) {
  for (const statement of SEED_STATEMENTS) {
    await graphWrite(workspaceId, statement);
  }
  return getGraphStats(workspaceId);
}

export async function clearGraph(workspaceId: string) {
  await graphWrite(workspaceId, "MATCH (n) DETACH DELETE n");
  return getGraphStats(workspaceId);
}

export async function getGraphStats(workspaceId: string) {
  const nodes = await graphRead(workspaceId, "MATCH (n) RETURN count(n) AS c");
  const rels = await graphRead(workspaceId, "MATCH ()-[r]->() RETURN count(r) AS c");
  const labels = await graphRead(workspaceId, "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY c DESC");
  return {
    nodeCount: Number(nodes[0]?.c ?? 0),
    relCount: Number(rels[0]?.c ?? 0),
    labels: labels.map((r) => ({ label: String(r.label), count: Number(r.c) })),
  };
}

export type GraphNode = { id: string; label: string; title: string; properties: Record<string, unknown> };
export type GraphEdge = { source: string; target: string; type: string };

export function nodeTitle(label: string, props: Record<string, unknown>) {
  return String(props.name ?? props.key ?? props.path ?? props.sha ?? props.title ?? props.id ?? props.channel ?? label);
}

export async function getSubgraph(workspaceId: string, limit = 200) {
  const nodeRows = await graphRead(
    workspaceId,
    "MATCH (n) RETURN id(n) AS id, labels(n)[0] AS label, properties(n) AS props LIMIT $limit",
    { limit },
  );
  const nodes: GraphNode[] = nodeRows.map((r) => {
    const props = (r.props ?? {}) as Record<string, unknown>;
    const label = String(r.label);
    return { id: String(r.id), label, title: nodeTitle(label, props), properties: props };
  });
  const edgeRows = await graphRead(
    workspaceId,
    "MATCH (a)-[r]->(b) RETURN id(a) AS s, id(b) AS t, type(r) AS type LIMIT $limit",
    { limit: limit * 3 },
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = edgeRows
    .map((r) => ({ source: String(r.s), target: String(r.t), type: String(r.type) }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

export async function runReadOnlyCypher(workspaceId: string, cypher: string) {
  assertReadOnlyCypher(cypher);
  const query = /\blimit\b/i.test(cypher) ? cypher : `${cypher} LIMIT 100`;
  const rows = await graphRead(workspaceId, query);
  return { cypher: query, rows };
}

export async function listFunctionNames(workspaceId: string): Promise<string[]> {
  const rows = await graphRead(workspaceId, "MATCH (f:Function) RETURN f.name AS name");
  return rows.map((r) => String(r.name));
}

export async function findCallers(workspaceId: string, symbol: string) {
  const cypher =
    "MATCH (c:Function)-[:CALLS]->(f:Function {name: $symbol}) RETURN c.name AS caller, c.file AS file LIMIT 100";
  const rows = await graphRead(workspaceId, cypher, { symbol });
  return { cypher, rows };
}

export type { CypherParams, Row };
