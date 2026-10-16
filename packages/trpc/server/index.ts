import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { graphRouter } from "./routes/graph/route";

export const serverRouter = router({
  health: healthRouter,
  graph: graphRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
