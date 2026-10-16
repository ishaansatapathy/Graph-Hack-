import { graphEngine } from "@stackfox/services";

import { z } from "../../schema";
import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Graph"];
const getPath = generatePath("/graph");

const pathNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

function section(title: string, items: string[]) {
  return items.length ? `${title}:\n${items.map((i) => `  - ${i}`).join("\n")}` : "";
}

export const graphRouter = router({
  /** GraphRAG: find symbols/issues in the question, retrieve their multi-hop context from FalkorDB. */
  ask: protectedProcedure
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
        const stats = await graphEngine.getGraphStats();
        if (stats.nodeCount === 0) {
          return {
            answer: "Graph is empty — click “Load demo graph” (or push commits) to populate FalkorDB, then ask again.",
            cypher: [],
            path: [],
            sources: [],
          };
        }

        const q = input.question.toLowerCase();
        const names = await graphEngine.listFunctionNames();
        const matched = names.filter((n) => q.includes(n.toLowerCase()));

        if (matched.length === 0) {
          return {
            answer: `FalkorDB holds ${stats.nodeCount} nodes and ${stats.relCount} relationships (${stats.labels
              .map((l) => `${l.count} ${l.label}`)
              .join(", ")}). Mention a function (e.g. ${names.slice(0, 3).join(", ")}) to retrieve its graph context.`,
            cypher: [],
            path: [],
            sources: [],
          };
        }

        const cypher: string[] = [];
        const path: { id: string; label: string; properties?: Record<string, unknown> }[] = [];
        const sources: string[] = [];
        const blocks: string[] = [];

        for (const name of matched) {
          const ctx = await graphEngine.getSymbolContext(name);
          if (!ctx) continue;
          cypher.push(ctx.cypher);
          path.push({ id: name, label: "Function", properties: { file: ctx.file } });
          sources.push(...ctx.issues.map((i) => i.split(":")[0] ?? i), ...ctx.commits.map((c) => c.split(" ")[0] ?? c));
          blocks.push(
            [
              `${name}${ctx.file ? ` (${ctx.file})` : ""}`,
              section("Called by", ctx.callers),
              section("Calls", ctx.callees),
              section("Covered by tests", ctx.tests),
              section("Changed in commits", ctx.commits),
              section("Linked Jira issues", ctx.issues),
              section("Slack discussion", ctx.discussions),
              section("Decisions constraining it", ctx.decisions),
              section("Open conflicts", ctx.conflicts),
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }

        return {
          answer: blocks.join("\n\n"),
          cypher,
          path,
          sources: [...new Set(sources)],
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  stats: protectedProcedure.query(async () => {
    try {
      return await graphEngine.getGraphStats();
    } catch (error) {
      mapServiceError(error);
    }
  }),

  seedDemo: protectedProcedure.mutation(async () => {
    try {
      return await graphEngine.seedDemoGraph();
    } catch (error) {
      mapServiceError(error);
    }
  }),

  subgraph: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(200) })).query(async ({ input }) => {
    try {
      return await graphEngine.getSubgraph(input.limit);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  query: protectedProcedure.input(z.object({ cypher: z.string().min(1).max(4000) })).mutation(async ({ input }) => {
    try {
      return await graphEngine.runReadOnlyCypher(input.cypher);
    } catch (error) {
      mapServiceError(error);
    }
  }),
});
