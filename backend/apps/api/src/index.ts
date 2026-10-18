import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import * as trpcExpress from "@trpc/server/adapters/express";
import { createContext, serverRouter } from "@stackfox/trpc/server";

import { checkDatabaseHealth, startIntegrationSyncWorker } from "@stackfox/services";

import { env } from "./env";
import { githubWebhookRouter } from "./routes/github-webhook";
import { googleAuthRouter } from "./routes/google-auth";
import { platformRouter } from "./routes/platform";
import { scenarioRouter } from "./routes/scenario";

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

app.use(scenarioRouter);
app.use(platformRouter);

app.get("/", (_req, res) => {
  res.json({
    name: "Stackfox API",
    trpc: "/trpc",
    health: "/health",
    scenario: "/scenario",
    events: "/events",
    auth: "/auth/google/callback",
  });
});

app.get("/health", async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const statusCode = dbHealth.status === "healthy" || dbHealth.status === "degraded" ? 200 : 503;
  res.status(statusCode).json({
    status: dbHealth.status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbHealth,
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
  startIntegrationSyncWorker();
  console.log("PostgreSQL-backed integration sync worker started");
});
