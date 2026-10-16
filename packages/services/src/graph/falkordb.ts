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
