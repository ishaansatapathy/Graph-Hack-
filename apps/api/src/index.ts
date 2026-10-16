import cors from "cors";
import express from "express";
import * as trpcExpress from "@trpc/server/adapters/express";
import { createContext, serverRouter } from "@stackfox/trpc/server";

const PORT = Number(process.env.PORT ?? 8000);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Graph Hack API",
    trpc: "/trpc",
    health: "trpc.health.getHealth",
  });
});

app.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`tRPC endpoint http://localhost:${PORT}/trpc`);
});
