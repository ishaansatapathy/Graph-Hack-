import {
  agentMemory,
  assertWorkspaceMember,
  checkDeviceQuota,
  completeWithGraphContext,
  detectConflicts,
  graphChunks,
  graphEngine,
  graphRagAnswer,
  resolveConflict,
  syncDb,
  triggerSync,
  type Message,
} from "@stackfox/services";
import { TRPCError } from "@trpc/server";
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

  // ── GraphRAG + AI ask (with device fingerprint rate limiting) ───────────
  ask: protectedProcedure
    .input(
      ws.extend({
        question: z.string().min(1).max(1000),
        /** Browser fingerprint — sent client-side for device-level quota */
        fp: z.string().max(512).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);

        // 1. Device fingerprint quota check (multi-account abuse prevention)
        const fpResult = checkDeviceQuota(input.fp ?? null);
        if (!fpResult.ok) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              fpResult.reason === "device_rpd"
                ? "Daily AI quota reached for this device. Try again tomorrow."
                : "Too many requests. Please wait a moment.",
          });
        }

        // 2. Persist user turn to memory
        agentMemory.appendMessage(input.workspaceId, ctx.user.id, "user", input.question);

        // 3. Graph traversal context (keyword-based, no vector store)
        const ragResult = await graphRagAnswer(input.workspaceId, input.question);

        // 4. Chunk search context (FalkorDB chunk nodes)
        const keywords = input.question
          .toLowerCase()
          .split(/[\s,.:;?!()\[\]{}'"`]+/)
          .filter((w) => w.length > 2)
          .slice(0, 6);
        const chunkHits = await graphChunks.searchChunks(input.workspaceId, keywords, 6);
        const chunkContext = graphChunks.formatChunkContext(chunkHits);

        const fullGraphContext = [
          ragResult.answer,
          chunkContext ? `\n\n### Additional chunk context:\n${chunkContext}` : "",
        ]
          .filter(Boolean)
          .join("");

        // 5. Get conversation memory for this user
        const thread = agentMemory.getThread(input.workspaceId, ctx.user.id);
        const memoryMessages: Message[] = thread
          .slice(-8)
          .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

        // 6. AI completion with graph context + memory
        const aiResult = await completeWithGraphContext({
          workspaceId: input.workspaceId,
          question: input.question,
          graphContext: fullGraphContext,
          memoryThread: memoryMessages,
        });

        // 7. Persist assistant answer to memory
        agentMemory.appendMessage(input.workspaceId, ctx.user.id, "assistant", aiResult.content);

        return {
          answer: aiResult.content,
          model: aiResult.model,
          complexity: aiResult.complexity,
          rateLimited: aiResult.rateLimited,
          cypher: ragResult.cypher,
          evidenceCount: ragResult.evidenceCount + chunkHits.length,
          chunkCount: chunkHits.length,
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  // ── Agent memory ──────────────────────────────────────────────────────────
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

  // ── Integration → Graph sync ──────────────────────────────────────────────
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

  // ── Conflict detection + resolution ──────────────────────────────────────
  conflicts: router({
    list: protectedProcedure.input(ws).query(async ({ ctx, input }) => {
      try {
        assertWorkspaceMember(input.workspaceId, ctx.user.id);
        return await detectConflicts(input.workspaceId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

    resolve: protectedProcedure
      .input(
        ws.extend({
          conflictId: z.string().min(1),
          authorA: z.string(),
          commitShaA: z.string(),
          messageA: z.string(),
          branchA: z.string(),
          authorB: z.string(),
          commitShaB: z.string(),
          messageB: z.string(),
          branchB: z.string(),
          file: z.string(),
          fp: z.string().max(512).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);

          // Device-level rate limit for conflict resolution (it's AI-heavy)
          const fpResult = checkDeviceQuota(input.fp ?? null);
          if (!fpResult.ok) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Device AI quota reached. Please wait before resolving more conflicts.",
            });
          }

          // Get memory thread for context
          const thread = agentMemory.getThread(input.workspaceId, ctx.user.id);
          const memoryMessages: Message[] = thread
            .slice(-6)
            .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

          const result = await resolveConflict(
            input.workspaceId,
            {
              id: input.conflictId,
              file: input.file,
              authorA: input.authorA,
              commitShaA: input.commitShaA,
              messageA: input.messageA,
              branchA: input.branchA,
              authorB: input.authorB,
              commitShaB: input.commitShaB,
              messageB: input.messageB,
              branchB: input.branchB,
              status: "open",
            },
            memoryMessages,
          );

          // Store resolution in memory
          agentMemory.appendMessage(
            input.workspaceId,
            ctx.user.id,
            "assistant",
            `Conflict in ${input.file} resolved: ${result.suggestion.slice(0, 200)}`,
          );

          return result;
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),
});
