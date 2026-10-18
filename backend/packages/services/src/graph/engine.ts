import { type CypherParams, graphRead, graphWrite, type Row } from "./falkordb";

const MAX_CYPHER_LENGTH = 8_000;
const MAX_CYPHER_ROWS = 100;
const MAX_CYPHER_RESPONSE_BYTES = 512 * 1024;

export function assertReadOnlyCypher(cypher: string) {
  const query = cypher.trim();
  if (!query || query.length > MAX_CYPHER_LENGTH) {
    throw new Error(`Cypher query must be between 1 and ${MAX_CYPHER_LENGTH} characters`);
  }
  if (query.includes(";") || /\/\*|\/\/|--/.test(query)) {
    throw new Error("Multiple statements and Cypher comments are not allowed");
  }
  if (!/^MATCH\b/i.test(query) || !/\bRETURN\b/i.test(query)) {
    throw new Error("Only bounded MATCH … RETURN queries are allowed");
  }
  if (/\b(UNWIND|WITH|OPTIONAL|UNION|FOREACH|LOAD|CALL|CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP)\b/i.test(query)) {
    throw new Error("Only read-only MATCH … RETURN queries are allowed");
  }

  const returnIndex = query.search(/\bRETURN\b/i);
  const matchClause = query.slice(5, returnIndex);
  if (/\[[^\]]*\*/.test(matchClause) || /\bMATCH\b/i.test(matchClause) || /,\s*\(/.test(matchClause)) {
    throw new Error("Variable-length paths, repeated MATCH clauses, and cartesian products are not allowed");
  }
  const limit = /\bLIMIT\s+(\d+)\s*$/i.exec(query);
  if (query.match(/\bLIMIT\b/gi)?.length && !limit) {
    throw new Error("LIMIT must be a final non-negative integer");
  }
  if (limit && Number(limit[1]) > MAX_CYPHER_ROWS) {
    throw new Error(`Cypher LIMIT cannot exceed ${MAX_CYPHER_ROWS}`);
  }
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
  const trimmed = cypher.trim();
  const query = /\bLIMIT\b/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${MAX_CYPHER_ROWS}`;
  const rows = await graphRead(workspaceId, query);
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > MAX_CYPHER_RESPONSE_BYTES) {
    throw new Error("Cypher query result exceeds the 512 KB response limit");
  }
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
