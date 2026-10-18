import {
  getApiPublicUrl,
  claimGithubWebhookDelivery,
  finishGithubWebhookDelivery,
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

  let secret: string;
  try {
    secret = await getGithubWebhookSecretForWorkspace(workspaceId);
  } catch {
    return res.status(503).json({ error: "Webhook configuration is temporarily unavailable" });
  }
  if (!verifyGithubSignature(req, res, secret)) return;

  const event = req.headers["x-github-event"];
  if (event !== "push") {
    return res.status(200).json({ ok: true, ignored: true, event });
  }

  const parsed = githubPushPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push payload" });
  }

  const deliveryId = req.headers["x-github-delivery"];
  if (typeof deliveryId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(deliveryId)) {
    return res.status(400).json({ error: "Valid X-GitHub-Delivery header required" });
  }

  let claim: Awaited<ReturnType<typeof claimGithubWebhookDelivery>>;
  try {
    claim = await claimGithubWebhookDelivery(workspaceId, deliveryId);
  } catch {
    // Returning 503 lets GitHub retry once the delivery store is available.
    return res.status(503).json({ error: "Webhook delivery store is temporarily unavailable" });
  }
  if (!claim.claimed) {
    return res.status(202).json({ ok: true, duplicate: true, deliveryStatus: claim.status });
  }

  try {
    const result = await handleGithubPush(workspaceId, parsed.data);
    await finishGithubWebhookDelivery(workspaceId, deliveryId, true);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[github-webhook]", error);
    await finishGithubWebhookDelivery(workspaceId, deliveryId, false).catch(() => undefined);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});
