import crypto from "node:crypto";

import * as graphEngine from "../graph/engine";
import { recordAudit } from "./audit";
import * as workspaceDb from "./db";

const { sqlite } = workspaceDb;

export type ToolKind = "query_graph" | "find_callers" | "graph_stats";
export type ToolVisibility = "private" | "workspace";

type ToolRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  kind: ToolKind;
  description: string;
  visibility: ToolVisibility;
  version: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

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

function audit(workspaceId: string, actorUserId: string, action: string, toolId: string | null, detail = "") {
  recordAudit(workspaceId, actorUserId, action, toolId, detail);
}

function getTool(workspaceId: string, toolId: string): ToolRow {
  const row = sqlite
    .prepare("SELECT * FROM workspace_tools WHERE id = ? AND workspace_id = ?")
    .get(toolId, workspaceId) as ToolRow | undefined;
  if (!row) throw new Error("Tool not found");
  return row;
}

function memberRole(workspaceId: string, userId: string) {
  const role = workspaceDb.getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role;
}

/** Owner of the tool, or workspace owner/admin, may manage it. */
function assertCanManage(tool: ToolRow, userId: string) {
  const role = memberRole(tool.workspace_id, userId);
  if (tool.owner_user_id === userId || role === "owner" || role === "admin") return;
  throw new Error("Only the tool owner or a workspace admin can change this tool");
}

/** Private tools are usable only by their owner; shared tools by any workspace member. Checked on every call. */
function assertCanUse(tool: ToolRow, userId: string) {
  memberRole(tool.workspace_id, userId);
  if (tool.revoked_at) throw new Error("This tool was revoked");
  if (tool.visibility === "private" && tool.owner_user_id !== userId) {
    throw new Error("This tool is private");
  }
}

function toPublic(tool: ToolRow, userId: string) {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    visibility: tool.visibility,
    version: tool.version,
    revoked: Boolean(tool.revoked_at),
    ownedByMe: tool.owner_user_id === userId,
    ownerUserId: tool.owner_user_id,
    updatedAt: tool.updated_at,
  };
}

export function listTools(workspaceId: string, userId: string) {
  memberRole(workspaceId, userId);
  const rows = sqlite
    .prepare(
      `SELECT * FROM workspace_tools
       WHERE workspace_id = ? AND (owner_user_id = ? OR (visibility = 'workspace' AND revoked_at IS NULL))
       ORDER BY updated_at DESC`,
    )
    .all(workspaceId, userId) as ToolRow[];
  return rows.map((r) => toPublic(r, userId));
}

export function createTool(
  workspaceId: string,
  userId: string,
  input: { name: string; kind: ToolKind; description?: string },
) {
  memberRole(workspaceId, userId);
  if (!TOOL_CATALOG[input.kind]) throw new Error("Unknown tool kind");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO workspace_tools
        (id, workspace_id, owner_user_id, name, kind, description, visibility, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'private', 1, ?, ?)`,
    )
    .run(id, workspaceId, userId, input.name.trim(), input.kind, input.description?.trim() || TOOL_CATALOG[input.kind].description, now, now);
  audit(workspaceId, userId, "tool.created", id, input.name);
  return toPublic(getTool(workspaceId, id), userId);
}

export function setToolVisibility(workspaceId: string, userId: string, toolId: string, visibility: ToolVisibility) {
  const tool = getTool(workspaceId, toolId);
  assertCanManage(tool, userId);
  if (tool.revoked_at) throw new Error("Revoked tools cannot be shared");
  sqlite
    .prepare("UPDATE workspace_tools SET visibility = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .run(visibility, new Date().toISOString(), toolId);
  audit(workspaceId, userId, visibility === "workspace" ? "tool.shared" : "tool.unshared", toolId, tool.name);
  return toPublic(getTool(workspaceId, toolId), userId);
}

export function revokeTool(workspaceId: string, userId: string, toolId: string) {
  const tool = getTool(workspaceId, toolId);
  assertCanManage(tool, userId);
  sqlite
    .prepare("UPDATE workspace_tools SET revoked_at = ?, visibility = 'private', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), new Date().toISOString(), toolId);
  audit(workspaceId, userId, "tool.revoked", toolId, tool.name);
  return { ok: true };
}

export function listAudit(workspaceId: string, userId: string) {
  memberRole(workspaceId, userId);
  const rows = sqlite
    .prepare(
      `SELECT id, actor_user_id, action, tool_id, detail, created_at FROM audit_events
       WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(workspaceId) as {
    id: string;
    actor_user_id: string;
    action: string;
    tool_id: string | null;
    detail: string;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    action: r.action,
    toolId: r.tool_id,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

export async function callTool(workspaceId: string, userId: string, toolId: string, args: Record<string, unknown>) {
  const tool = getTool(workspaceId, toolId);
  assertCanUse(tool, userId);

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
      rows = await graphEngine.getGraphStats(workspaceId).then((s) => [s]);
    }

    audit(workspaceId, userId, "tool.called", toolId, `${tool.name} v${tool.version}`);
    return { cypher, rows, toolVersion: tool.version };
  } catch (error) {
    audit(workspaceId, userId, "tool.call_failed", toolId, error instanceof Error ? error.message : "error");
    throw error;
  }
}
