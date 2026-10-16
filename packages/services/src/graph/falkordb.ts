import { FalkorDB } from "falkordb";

import { env } from "../env";

const host = env.FALKORDB_HOST ?? process.env.FALKORDB_HOST ?? "localhost";
const port = Number(env.FALKORDB_PORT ?? process.env.FALKORDB_PORT ?? "6379");
const password = env.FALKORDB_PASSWORD ?? process.env.FALKORDB_PASSWORD;
const defaultGraph = env.FALKORDB_GRAPH ?? process.env.FALKORDB_GRAPH ?? "stackfox";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

export async function getGraph(graphName = defaultGraph) {
  if (!client) {
    client = await FalkorDB.connect({
      host,
      port,
      ...(password ? { password } : {}),
    });
  }
  return client.selectGraph(graphName);
}

export type CypherParam = string | number | boolean | null | CypherParam[];
export type CypherParams = Record<string, CypherParam>;
export type Row = Record<string, unknown>;

/** Every workspace owns an isolated graph — tenant separation happens at the database level. */
export function workspaceGraphName(workspaceId: string) {
  return `ws_${workspaceId.replace(/-/g, "")}`;
}

function isMissingGraph(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /empty key|invalid graph operation|graph.*not.*exist/i.test(message);
}

export async function graphRead(workspaceId: string, cypher: string, params: CypherParams = {}): Promise<Row[]> {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    const res = await graph.roQuery(cypher, { params });
    return (res.data ?? []) as Row[];
  } catch (error) {
    // A workspace graph does not exist until the first write — treat as empty.
    if (isMissingGraph(error)) return [];
    throw error;
  }
}

export async function graphWrite(workspaceId: string, cypher: string, params: CypherParams = {}) {
  const graph = await getGraph(workspaceGraphName(workspaceId));
  return graph.query(cypher, { params });
}

export async function deleteWorkspaceGraph(workspaceId: string) {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    await graph.delete();
  } catch (error) {
    if (!isMissingGraph(error)) throw error;
  }
}
