import { z, zodUndefinedModel } from "../../schema";
import { publicProcedure, router } from "../../trpc";
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

  runHousekeeping: publicProcedure
    .meta({ openapi: { method: "POST", path: "/health/housekeeping" } })
    .input(zodUndefinedModel)
    .output(
      z.object({
        timestamp: z.string(),
        durationMs: z.number(),
        prunedDeviceQuotas: z.number(),
        prunedExpiredInvites: z.number(),
        reapedStaleSyncRuns: z.number(),
        success: z.boolean(),
        error: z.string().optional(),
      }),
    )
    .mutation(async () => {
      return await runDatabaseHousekeeping();
    }),
});
