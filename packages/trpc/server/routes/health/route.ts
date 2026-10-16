import { z, zodUndefinedModel } from "../../schema";
import { publicProcedure, router } from "../../trpc";
import { pingFalkorDb } from "../../services";

export const healthRouter = router({
  getHealth: publicProcedure
    .meta({ openapi: { method: "GET", path: "/health" } })
    .input(zodUndefinedModel)
    .output(
      z.object({
        status: z.literal("healthy"),
        falkordb: z.boolean(),
      }),
    )
    .query(async () => {
      const falkordb = await pingFalkorDb();
      return {
        status: "healthy",
        falkordb,
      };
    }),
});
