import {
  getApiPublicUrl,
  getGithubWebhookSecretForWorkspace,
  githubPushPayloadSchema,
  handleGithubPush,
  verifyGithubSignature,
} from "@stackfox/services";
import express, { type Request } from "express";

export const githubWebhookRouter = express.Router();

githubWebhookRouter.use(
  express.json({
    limit: "512kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

githubWebhookRouter.get("/", (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  return res.json({
    ok: true,
    message: "Stackfox GitHub webhook",
    events: ["push"],
    webhookUrl: workspaceId
      ? `${getApiPublicUrl()}/webhooks/github?workspaceId=${encodeURIComponent(workspaceId)}`
      : `${getApiPublicUrl()}/webhooks/github?workspaceId=<workspace-id>`,
    signatureHeader: "X-Hub-Signature-256",
  });
});

githubWebhookRouter.post("/", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
  if (!workspaceId) {
    return res.status(400).json({ error: "workspaceId query param required" });
  }

  const secret = await getGithubWebhookSecretForWorkspace(workspaceId);
  if (!verifyGithubSignature(req, res, secret)) return;

  const event = req.headers["x-github-event"];
  if (event !== "push") {
    return res.status(200).json({ ok: true, ignored: true, event });
  }

  const parsed = githubPushPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push payload" });
  }

  try {
    const result = await handleGithubPush(workspaceId, parsed.data);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[github-webhook]", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});
