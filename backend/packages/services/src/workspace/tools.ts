import crypto from "node:crypto";

import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db, schema } from "../db/client";
import { withDbErrorHandling } from "../db/errors";
import { UserError } from "../errors";
import * as graphEngine from "../graph/engine";
import { childLogger } from "../logger";
import { recordAudit } from "./audit";
import { getMemberRole } from "./db";

const log = childLogger("tools");

export type ToolKind = "query_graph" | "find_callers" | "graph_stats";
export type ToolVisibility = "private" | "workspace";

type ToolRow = typeof schema.workspaceTools.$inferSelect;

export const TOOL_CATALOG: Record<ToolKind, { label: string; description: string; inputHint: string }> = {
  query_graph: {
    label: "query_graph",
    description: "Run a read-only Cypher query on the FalkorDB engineering graph.",
    inputHint: '{"cypher": "MATCH (c:Commit)-[:REFERENCES]->(i:Issue) RETURN c.sha, i.key LIMIT 10"}',
  },
  find_callers: {
    label: "find_callers",
    description: "Find functions that call a given symbol (graph traversal).",
    inputHint: '{"symbol": "verifyToken"}',
  },
  graph_stats: {
    label: "graph_stats",
    description: "Node and relationship counts of the workspace graph.",
    inputHint: "{}",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTool(workspaceId: string, toolId: string): Promise<ToolRow> {
  const [row] = await db.select()
    .from(schema.workspaceTools)
    .where(and(eq(schema.workspaceTools.id, toolId), eq(schema.workspaceTools.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new Error("Tool not found");
  return row;
}

async function memberRole(workspaceId: string, userId: string): Promise<string> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role;
}

async function assertCanManage(tool: ToolRow, userId: string): Promise<void> {
  const role = await memberRole(tool.workspaceId, userId);
  if (tool.ownerUserId === userId || role === "owner" || role === "admin") return;
  throw new Error("Only the tool owner or a workspace admin can change this tool");
}

async function assertCanUse(tool: ToolRow, userId: string): Promise<void> {
  await memberRole(tool.workspaceId, userId);
  if (tool.revokedAt) throw new Error("This tool was revoked");
  if (tool.visibility === "private" && tool.ownerUserId !== userId) {
    throw new Error("This tool is private");
  }
}

function toPublic(tool: ToolRow, userId: string) {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind as ToolKind,
    description: tool.description,
    visibility: tool.visibility as ToolVisibility,
    version: tool.version,
    revoked: Boolean(tool.revokedAt),
    ownedByMe: tool.ownerUserId === userId,
    ownerUserId: tool.ownerUserId,
    updatedAt: tool.updatedAt.toISOString(),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function listTools(workspaceId: string, userId: string) {
  await memberRole(workspaceId, userId);
  const rows = await db.select()
    .from(schema.workspaceTools)
    .where(and(
      eq(schema.workspaceTools.workspaceId, workspaceId),
      or(
        eq(schema.workspaceTools.ownerUserId, userId),
        and(eq(schema.workspaceTools.visibility, "workspace"), isNull(schema.workspaceTools.revokedAt)),
      ),
    ))
    .orderBy(desc(schema.workspaceTools.updatedAt));
  return rows.map((r) => toPublic(r, userId));
}

export async function createTool(
  workspaceId: string,
  userId: string,
  input: { name: string; kind: ToolKind; description?: string },
) {
  await memberRole(workspaceId, userId);
  if (!TOOL_CATALOG[input.kind]) throw new UserError("Unknown tool kind");

  const trimmedName = input.name.trim();
  if (!trimmedName) throw new UserError("Tool name cannot be empty");

  return await withDbErrorHandling(async () => {
    return await db.transaction(async (tx) => {
      const id = crypto.randomUUID();
      const [row] = await tx.insert(schema.workspaceTools).values({
        id,
        workspaceId,
        ownerUserId: userId,
        name: trimmedName,
        kind: input.kind,
        description: input.description?.trim() || TOOL_CATALOG[input.kind].description,
        visibility: "private",
      }).returning();

      await tx.insert(schema.auditEvents).values({
        id: crypto.randomUUID(),
        workspaceId,
        actorUserId: userId,
        action: "tool.created",
        toolId: id,
        detail: trimmedName,
      });

      return toPublic(row!, userId);
    });
  });
}

export async function setToolVisibility(
  workspaceId: string,
  userId: string,
  toolId: string,
  visibility: ToolVisibility,
) {
  const tool = await getTool(workspaceId, toolId);
  await assertCanManage(tool, userId);
  if (tool.revokedAt) throw new Error("Revoked tools cannot be shared");

  const [updated] = await db.update(schema.workspaceTools)
    .set({ visibility, version: tool.version + 1, updatedAt: new Date() })
    .where(eq(schema.workspaceTools.id, toolId))
    .returning();

  recordAudit(workspaceId, userId, visibility === "workspace" ? "tool.shared" : "tool.unshared", toolId, tool.name);
  return toPublic(updated!, userId);
}

export async function revokeTool(workspaceId: string, userId: string, toolId: string) {
  const tool = await getTool(workspaceId, toolId);
  await assertCanManage(tool, userId);

  await db.update(schema.workspaceTools)
    .set({ revokedAt: new Date(), visibility: "private", updatedAt: new Date() })
    .where(eq(schema.workspaceTools.id, toolId));

  recordAudit(workspaceId, userId, "tool.revoked", toolId, tool.name);
  return { ok: true };
}

export async function listAudit(workspaceId: string, userId: string) {
  await memberRole(workspaceId, userId);
  const rows = await db.select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.workspaceId, workspaceId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    action: r.action,
    toolId: r.toolId,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function callTool(workspaceId: string, userId: string, toolId: string, args: Record<string, unknown>) {
  const tool = await getTool(workspaceId, toolId);
  await assertCanUse(tool, userId);

  try {
    let cypher: string;
    let rows: unknown[];

    if (tool.kind === "query_graph") {
      const requested = String(args.cypher ?? "").trim();
      if (!requested) throw new Error("`cypher` is required");
      const result = await graphEngine.runReadOnlyCypher(workspaceId, requested);
      cypher = result.cypher;
      rows = result.rows;
    } else if (tool.kind === "find_callers") {
      const symbol = String(args.symbol ?? "").trim();
      if (!symbol) throw new Error("`symbol` is required");
      const result = await graphEngine.findCallers(workspaceId, symbol);
      cypher = result.cypher;
      rows = result.rows;
    } else {
      cypher = "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count";
      rows = [await graphEngine.getGraphStats(workspaceId)];
    }

    recordAudit(workspaceId, userId, "tool.called", toolId, `${tool.name} v${tool.version}`);
    return { cypher, rows, toolVersion: tool.version };
  } catch (error) {
    recordAudit(workspaceId, userId, "tool.call_failed", toolId, error instanceof Error ? error.message : "error");
    throw error;
  }
}
