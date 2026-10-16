import { router } from "./trpc";

import { authRouter } from "./routes/auth/route";
import { healthRouter } from "./routes/health/route";
import { graphRouter } from "./routes/graph/route";
import { workspaceRouter } from "./routes/workspace/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  graph: graphRouter,
  workspace: workspaceRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
