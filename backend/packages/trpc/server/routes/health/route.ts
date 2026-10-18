import { z, zodUndefinedModel } from "../../schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../../trpc";
import { checkDatabaseHealth, pingFalkorDb, runDatabaseHousekeeping } from "../../services";

export const healthRouter = router({
  getHealth: publicProcedure
    .meta({ openapi: { method: "GET", path: "/health" } })
    .input(zodUndefinedModel)
    .output(
      z.object({
        status: z.enum(["healthy", "degraded", "unhealthy"]),
        falkordb: z.boolean(),
        database: z.object({
          status: z.enum(["healthy", "degraded", "unhealthy"]),
          latencyMs: z.number(),
          serverTime: z.string().optional(),
          database: z.string().optional(),
          error: z.string().optional(),
          timestamp: z.string(),
        }),
      }),
    )
    .query(async () => {
      const [falkordb, dbHealth] = await Promise.all([
        pingFalkorDb().catch(() => false),
        checkDatabaseHealth(),
      ]);

      const overallStatus =
        dbHealth.status === "healthy" && falkordb
          ? "healthy"
          : dbHealth.status === "unhealthy"
            ? "unhealthy"
            : "degraded";

      return {
        status: overallStatus,
        falkordb,
        database: dbHealth,
      };
    }),

  runHousekeeping: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/health/housekeeping", protect: true } })
    .input(zodUndefinedModel)
    .output(
      z.object({
        timestamp: z.string(),
        durationMs: z.number(),
        prunedDeviceQuotas: z.number(),
        prunedExpiredInvites: z.number(),
        reapedStaleSyncRuns: z.number(),
        prunedGithubWebhookDeliveries: z.number(),
        success: z.boolean(),
        error: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Platform administrator access required" });
      }
      return await runDatabaseHousekeeping();
    }),
});
