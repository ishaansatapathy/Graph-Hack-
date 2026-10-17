import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export function verifyGithubSignature(req: Request, res: Response, secret: string): boolean {
  const trimmed = secret.trim();
  if (!trimmed) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Webhook secret not configured" });
      return false;
    }
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    res.status(401).json({ error: "Missing X-Hub-Signature-256" });
    return false;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body required" });
    return false;
  }

  const expected = createHmac("sha256", trimmed).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);

  try {
    const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    if (!ok) {
      res.status(401).json({ error: "Invalid GitHub signature" });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Invalid GitHub signature" });
    return false;
  }
}
