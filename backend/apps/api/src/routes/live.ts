import { Router } from "express";
import type { Request, Response } from "express";
import { AuthService, getOrCreateWorkspaceForUser, isGraphEngineActive, live } from "@stackfox/services";
import { z } from "zod";

/** Live dashboard API: a snapshot of the workspace graph, an SSE stream of
    changes to it, and a GitHub import that populates it. */
export const liveRouter = Router();

const authService = new AuthService();

async function workspaceFor(req: Request, res: Response) {
  const user = await authService.resolveSession(req, res);
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  const workspace = await getOrCreateWorkspaceForUser(user.id, user.fullName, user.email);
  return workspace;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

liveRouter.get("/scenario", async (req, res) => {
  try {
    const ws = await workspaceFor(req, res);
    if (!ws) return;
    const snapshot = await live.buildSnapshot(ws.id);
    res.json({ ...snapshot, workspace: { id: ws.id, name: ws.name } });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

liveRouter.get("/events", async (req, res) => {
  let ws;
  try {
    ws = await workspaceFor(req, res);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
    return;
  }
  if (!ws) return;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const start = Date.now();
  let seq = 0;
  const send = (event: live.LiveEvent) => {
    seq += 1;
    const at = Math.max(0, event.ts - start);
    res.write(`data: ${JSON.stringify({ seq, at, log: { id: `${start}-${seq}`, at, ...event.log }, patches: event.patches })}\n\n`);
  };

  res.write("retry: 3000\n\n");
  const unsubscribe = live.subscribe(ws.id, send);
  send({
    ts: Date.now(),
    log: { actor: "stackfox", kind: "system", message: `Connected to ${ws.name} · graph engine ${isGraphEngineActive().engine}` },
    patches: [],
  });
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

const importInput = z.object({ repo: z.string().trim().min(3).max(200) });

liveRouter.post("/import", async (req, res) => {
  try {
    const ws = await workspaceFor(req, res);
    if (!ws) return;
    const parsed = importInput.safeParse(req.body);
    const repo = parsed.success
      ? parsed.data.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "")
      : "";
    if (!live.isValidRepoName(repo)) {
      res.status(400).json({ error: "Use the owner/name form, e.g. vercel/next.js" });
      return;
    }
    // Progress streams over /live/events; the request returns once the import settles.
    await live.importGithubRepo(ws.id, repo);
    res.json({ ok: true, repo });
  } catch (error) {
    const status = error instanceof live.ImportError ? error.status : 500;
    res.status(status).json({ error: errorMessage(error) });
  }
});
