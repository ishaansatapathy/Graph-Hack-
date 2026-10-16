import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import * as trpcExpress from "@trpc/server/adapters/express";
import { createContext, serverRouter } from "@stackfox/trpc/server";

import { env } from "./env";
import { githubWebhookRouter } from "./routes/github-webhook";
import { googleAuthRouter } from "./routes/google-auth";

const PORT = Number(process.env.PORT ?? 8000);

const app = express();
app.use(
  cors({
    origin: [env.CLIENT_URL, "http://localhost:3000"],
    credentials: true,
  }),
);
app.use(cookieParser());
app.use("/webhooks/github", githubWebhookRouter);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Graph Hack API",
    trpc: "/trpc",
    auth: "/auth/google/callback",
  });
});

app.use("/auth", googleAuthRouter);

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
