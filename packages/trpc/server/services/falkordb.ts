import { FalkorDB } from "falkordb";

const host = process.env.FALKORDB_HOST ?? "localhost";
const port = Number(process.env.FALKORDB_PORT ?? "6379");
const password = process.env.FALKORDB_PASSWORD;
const defaultGraph = process.env.FALKORDB_GRAPH ?? "stackfox";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

export async function getFalkorClient() {
  if (!client) {
    client = await FalkorDB.connect({
      host,
      port,
      ...(password ? { password } : {}),
    });
  }
  return client;
}

export async function getGraph(graphName = defaultGraph) {
  const db = await getFalkorClient();
  return db.selectGraph(graphName);
}

export async function pingFalkorDb(): Promise<boolean> {
  try {
    const graph = await getGraph();
    await graph.roQuery("RETURN 1 AS ok");
    return true;
  } catch {
    return false;
  }
}
