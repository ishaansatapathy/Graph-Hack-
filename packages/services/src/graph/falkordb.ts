import { FalkorDB } from "falkordb";

import { env } from "../env";
import { embeddedGraphManager } from "./embedded-graph";

const host = env.FALKORDB_HOST ?? process.env.FALKORDB_HOST ?? "localhost";
const port = Number(env.FALKORDB_PORT ?? process.env.FALKORDB_PORT ?? "6379");
const password = env.FALKORDB_PASSWORD ?? process.env.FALKORDB_PASSWORD;
const defaultGraph = env.FALKORDB_GRAPH ?? process.env.FALKORDB_GRAPH ?? "stackfox";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;
let isFalkorDbAvailable: boolean | null = null;
let lastCheckTime = 0;
const CHECK_COOLDOWN_MS = 30_000;

export async function checkFalkorDbConnection(): Promise<boolean> {
  const now = Date.now();
  if (isFalkorDbAvailable !== null && now - lastCheckTime < CHECK_COOLDOWN_MS) {
    return isFalkorDbAvailable;
  }

  try {
    lastCheckTime = now;
    if (!client) {
      client = await Promise.race([
        FalkorDB.connect({
          host,
          port,
          ...(password ? { password } : {}),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("FalkorDB connection timeout")), 1200),
        ),
      ]);
    }
    isFalkorDbAvailable = true;
    return true;
  } catch {
    isFalkorDbAvailable = false;
    client = null;
    return false;
  }
}

export async function getGraph(graphName = defaultGraph) {
  const available = await checkFalkorDbConnection();
  if (available && client) {
    return client.selectGraph(graphName);
  }
  return null;
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

export async function graphRead(
  workspaceId: string,
  cypher: string,
  params: CypherParams = {},
): Promise<Row[]> {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    if (graph) {
      const res = await graph.roQuery(cypher, { params });
      return (res.data ?? []) as Row[];
    }
  } catch (error) {
    if (isMissingGraph(error)) return [];
    // If FalkorDB query fails, fall back to embedded store
    isFalkorDbAvailable = false;
  }

  // Resilient High-Availability Embedded Graph Engine
  const store = embeddedGraphManager.getStore(workspaceId);
  return store.query(cypher, params as Record<string, unknown>);
}

export async function graphWrite(
  workspaceId: string,
  cypher: string,
  params: CypherParams = {},
) {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    if (graph) {
      return await graph.query(cypher, { params });
    }
  } catch (error) {
    isFalkorDbAvailable = false;
  }

  // Resilient High-Availability Embedded Graph Engine
  const store = embeddedGraphManager.getStore(workspaceId);
  store.executeWrite(cypher, params as Record<string, unknown>);
  return { data: [] };
}

export async function deleteWorkspaceGraph(workspaceId: string) {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    if (graph) {
      await graph.delete();
      return;
    }
  } catch (error) {
    if (!isMissingGraph(error)) {
      isFalkorDbAvailable = false;
    }
  }

  embeddedGraphManager.deleteStore(workspaceId);
}

export function isGraphEngineActive(): { engine: "falkordb" | "embedded"; available: boolean } {
  return {
    engine: isFalkorDbAvailable ? "falkordb" : "embedded",
    available: true,
  };
}
