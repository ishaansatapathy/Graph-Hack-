import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "../db/client";
import { UserError } from "../errors";
import { encryptJson, decryptJson } from "./secrets";
import { getMemberRole } from "./db";
import { recordAudit } from "./audit";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ServiceMethod = (typeof METHODS)[number];

function isPublicIp(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    if (a === undefined || b === undefined) return false;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return (value.startsWith("2") || value.startsWith("3")) && !value.startsWith("2001:db8:");
  }
  return false;
}

import http from "node:http";

const allowLocal = process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_SERVICES === "true";

async function resolvePublicAddress(hostname: string) {
  const normalizedHost = hostname.replace(/^\[|\]$/g, "");
  if (allowLocal && (normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "host.docker.internal")) {
    return { address: "127.0.0.1", family: 4 };
  }
  if (!allowLocal && (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost") || normalizedHost.endsWith(".local") || normalizedHost.endsWith(".internal"))) {
    throw new UserError("Service URL must resolve to a public internet address");
  }
  if (isIP(normalizedHost)) {
    if (!allowLocal && !isPublicIp(normalizedHost)) throw new UserError("Service URL must resolve to a public internet address");
    return { address: normalizedHost, family: isIP(normalizedHost) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(normalizedHost, { all: true, verbatim: true });
  } catch {
    throw new UserError("Could not resolve the service host");
  }
  const address = addresses.find((item) => allowLocal || isPublicIp(item.address));
  if (!address) throw new UserError("Service URL must resolve to a public internet address");
  return address;
}

async function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserError("Enter a valid HTTP/HTTPS service URL");
  }
  const isAllowedProto = url.protocol === "https:" || (allowLocal && url.protocol === "http:");
  if (
    !isAllowedProto || url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new UserError("Service URL must be an HTTP/HTTPS origin without credentials, path, query, or fragment");
  }
  await resolvePublicAddress(url.hostname);
  return url.origin;
}


function assertAdmin(role: string | null) {
  if (!role) throw new UserError("Workspace not found or access denied", "NOT_FOUND");
  if (role === "member") throw new UserError("Only workspace owners and admins can manage shared services", "FORBIDDEN");
}

export async function listWorkspaceServices(workspaceId: string, userId: string) {
  if (!(await getMemberRole(workspaceId, userId))) throw new UserError("Workspace not found or access denied", "NOT_FOUND");
  const rows = await db.select({
    id: schema.workspaceServices.id,
    name: schema.workspaceServices.name,
    baseUrl: schema.workspaceServices.baseUrl,
    hasAccessToken: schema.workspaceServices.accessTokenEncrypted,
    createdAt: schema.workspaceServices.createdAt,
  }).from(schema.workspaceServices)
    .where(eq(schema.workspaceServices.workspaceId, workspaceId))
    .orderBy(desc(schema.workspaceServices.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    requiresAuth: Boolean(row.hasAccessToken),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createWorkspaceService(input: {
  workspaceId: string;
  userId: string;
  name: string;
  baseUrl: string;
  accessToken?: string;
}) {
  const role = await getMemberRole(input.workspaceId, input.userId);
  assertAdmin(role);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new UserError("Service name must be 1–80 characters");
  if (input.accessToken && /[\x00-\x1f\x7f]/.test(input.accessToken)) throw new UserError("Bearer token contains invalid characters");
  const baseUrl = await normalizeBaseUrl(input.baseUrl);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.workspaceServices).values({
    id,
    workspaceId: input.workspaceId,
    createdByUserId: input.userId,
    name,
    baseUrl,
    accessTokenEncrypted: input.accessToken?.trim() ? encryptJson({ accessToken: input.accessToken.trim() }) : null,
    createdAt: now,
    updatedAt: now,
  });
  recordAudit(input.workspaceId, input.userId, "service.created", null, name);
  return { id, name, baseUrl, requiresAuth: Boolean(input.accessToken?.trim()), createdAt: now.toISOString() };
}

export async function removeWorkspaceService(workspaceId: string, userId: string, serviceId: string) {
  const role = await getMemberRole(workspaceId, userId);
  assertAdmin(role);
  await db.delete(schema.workspaceServices).where(and(
    eq(schema.workspaceServices.workspaceId, workspaceId),
    eq(schema.workspaceServices.id, serviceId),
  ));
  recordAudit(workspaceId, userId, "service.removed", null, serviceId);
  return { ok: true };
}

function buildServiceUrl(baseUrl: string, path: string) {
    if (!path.startsWith("/") || path.startsWith("//") || path.length > 2_000 || path.includes("#") || /[\x00-\x1f]/.test(path)) {
    throw new UserError("Request path must be a relative API path beginning with one slash");
  }
  const base = new URL(baseUrl);
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new UserError("Requests must stay on the registered service origin");
  return url;
}

function requestHttps(
  url: URL,
  method: ServiceMethod,
  accessToken: string | null,
  body?: string,
) {
  if (body && Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new UserError("Request body must be 64 KB or smaller");
  }
  if (body) {
    try {
      JSON.parse(body);
    } catch {
      throw new UserError("Request body must contain valid JSON");
    }
  }
  return new Promise<{ status: number; contentType: string; body: string }>(async (resolve, reject) => {
    try {
      const address = await resolvePublicAddress(url.hostname);
      const normalizedHost = url.hostname.replace(/^\[|\]$/g, "");
      const lookupPinned = ((hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        if (hostname !== normalizedHost) {
          callback(new Error("Unexpected DNS lookup host") as NodeJS.ErrnoException, "", 0);
          return;
        }
        callback(null, address.address, address.family);
      }) as NonNullable<https.RequestOptions["lookup"]>;

      const client = url.protocol === "http:" ? http : https;
      const request = client.request(url, {
        method,
        lookup: lookupPinned,
        headers: {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body, "utf8") } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        timeout: 10_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new UserError("Service response exceeded the 256 KB limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({
          status: response.statusCode ?? 502,
          contentType: String(response.headers["content-type"] ?? "application/octet-stream").slice(0, 120),
          body: Buffer.concat(chunks).toString("utf8"),
        }));
        response.on("error", reject);
      });
      const deadline = setTimeout(() => request.destroy(new Error("Service request timed out")), 12_000);
      request.on("close", () => clearTimeout(deadline));
      request.on("timeout", () => request.destroy(new Error("Service request timed out")));
      request.on("error", reject);
      if (body) request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function callWorkspaceService(input: {
  workspaceId: string;
  userId: string;
  serviceId: string;
  method: ServiceMethod;
  path: string;
  body?: string;
}) {
  if (!(await getMemberRole(input.workspaceId, input.userId))) throw new UserError("Workspace not found or access denied", "NOT_FOUND");
  const [service] = await db.select().from(schema.workspaceServices).where(and(
    eq(schema.workspaceServices.workspaceId, input.workspaceId),
    eq(schema.workspaceServices.id, input.serviceId),
  )).limit(1);
  if (!service) throw new UserError("Shared service not found", "NOT_FOUND");
  if (!METHODS.includes(input.method)) throw new UserError("Unsupported HTTP method");
  let accessToken: string | null = null;
  if (service.accessTokenEncrypted) {
    accessToken = decryptJson(service.accessTokenEncrypted).accessToken ?? null;
  }
  const url = buildServiceUrl(service.baseUrl, input.path);
  try {
    const response = await requestHttps(url, input.method, accessToken, input.body);
    recordAudit(
      input.workspaceId,
      input.userId,
      "service.called",
      null,
      `${service.id}:${input.method}:HTTP ${response.status}`,
    );
    return response;
  } catch (error) {
    // Never store request paths, bodies, credentials, or remote error text in the audit log.
    recordAudit(input.workspaceId, input.userId, "service.call_failed", null, `${service.id}:${input.method}`);
    throw error;
  }
}
