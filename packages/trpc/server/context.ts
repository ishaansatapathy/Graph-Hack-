import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import crypto from "node:crypto";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const headerId = req.headers["x-request-id"];
  const requestId =
    (typeof headerId === "string" && headerId.trim()) || crypto.randomUUID().slice(0, 12);
  res.setHeader("x-request-id", requestId);

  return { req, res, requestId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
