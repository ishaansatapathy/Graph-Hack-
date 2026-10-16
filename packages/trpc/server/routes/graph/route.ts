import { z } from "../../schema";
import { mapServiceError, publicProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { getGraph } from "../../services";

const TAGS = ["Graph"];
const getPath = generatePath("/graph");

const pathNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const graphRouter = router({
  /** GraphRAG entry — wire ingestion + completion here next */
  ask: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/ask"), tags: TAGS } })
    .input(
      z.object({
        question: z.string().min(1).max(8000),
        sessionId: z.string().optional(),
        maxHops: z.number().int().min(1).max(8).default(3),
      }),
    )
    .output(
      z.object({
        answer: z.string(),
        cypher: z.array(z.string()),
        path: z.array(pathNodeSchema),
        sources: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const graph = await getGraph();
        const stats = await graph.roQuery(
          "CALL db.meta.stats() YIELD nodeCount, relCount RETURN nodeCount, relCount",
        );

        const first = stats.data?.[0] as { nodeCount?: number; relCount?: number } | undefined;
        const nodeCount = Number(first?.nodeCount ?? 0);
        const relCount = Number(first?.relCount ?? 0);

        if (nodeCount === 0) {
          return {
            answer:
              "Graph is empty — ingest documents into FalkorDB first, then ask again.",
            cypher: [],
            path: [],
            sources: [],
          };
        }

        return {
          answer: `GraphRAG stub: graph has ${nodeCount} nodes and ${relCount} relationships. Question: "${input.question}"`,
          cypher: ["CALL db.meta.stats() YIELD nodeCount, relCount RETURN nodeCount, relCount"],
          path: [],
          sources: [],
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
