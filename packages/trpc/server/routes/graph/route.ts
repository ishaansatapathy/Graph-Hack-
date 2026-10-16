import { agentMemory, assertWorkspaceMember, graphEngine, graphRagAnswer, syncDb, triggerSync } from "@stackfox/services";
import { z } from "zod";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const ws = z.object({ workspaceId: z.string().uuid() });

/** Graph endpoints — every call is scoped to the caller's workspace graph in FalkorDB. */
export const graphRouter = router({
  stats: protectedProcedure.input(ws).query(async ({ ctx, input }) => {
    try {
      assertWorkspaceMember(input.workspaceId, ctx.user.id);
      return await graphEngine.getGraphStats(input.workspaceId);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  seedDemo: protectedProcedure.input(ws).mutation(async ({ ctx, input }) => {
    try {
      const role = assertWorkspaceMember(input.workspaceId, ctx.user.id);
      if (role === "member") throw new Error("Only owners and admins can reset the graph");
      return await graphEngine.seedDemoGraph(input.workspaceId);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  clear: protectedProcedure.input(ws).mutation(async ({ ctx, input }) => {
    try {
      const role = assertWorkspaceMember(input.workspaceId, ctx.user.id);
      if (role === "member") throw new Error("Only owners and admins can clear the graph");
      return await graphEngine.clearGraph(input.workspaceId);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  subgraph: protectedProcedure
    .input(ws.extend({ limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);
        return await graphEngine.getSubgraph(input.workspaceId, input.limit);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  query: protectedProcedure
    .input(ws.extend({ cypher: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);
        return await graphEngine.runReadOnlyCypher(input.workspaceId, input.cypher);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  // ── GraphRAG + Agent memory ─────────────────────────────────────────────
  ask: protectedProcedure
    .input(ws.extend({ question: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);

        // Persist user turn
        agentMemory.appendMessage(input.workspaceId, ctx.user.id, "user", input.question);

        // Graph retrieval
        const result = await graphRagAnswer(input.workspaceId, input.question);

        // Persist assistant turn (store the answer text)
        agentMemory.appendMessage(input.workspaceId, ctx.user.id, "assistant", result.answer);

        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  memory: router({
    list: protectedProcedure.input(ws).query(({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);
        return agentMemory.getThread(input.workspaceId, ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

    clear: protectedProcedure.input(ws).mutation(({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);
        const deleted = agentMemory.clearThread(input.workspaceId, ctx.user.id);
        return { deleted };
      } catch (error) {
        mapServiceError(error);
      }
    }),
  }),

  // ── Integration → Graph sync ────────────────────────────────────────────
  sync: router({
    trigger: protectedProcedure
      .input(ws.extend({ provider: z.enum(["jira", "slack"]) }))
      .mutation(async ({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          const runId = await triggerSync(input.workspaceId, input.provider);
          return { runId, message: `${input.provider} sync started` };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    runs: protectedProcedure
      .input(ws.extend({ limit: z.number().int().min(1).max(50).default(15) }))
      .query(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return syncDb.listRuns(input.workspaceId, input.limit);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),
});
