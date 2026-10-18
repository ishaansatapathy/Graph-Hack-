import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client";
import { UserError } from "../errors";
import { getMemberRole } from "./db";

const MAX_DRAFT_BYTES = 1_000_000;

function validatePath(path: string) {
  if (
    !path || path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new UserError("Invalid repository file path");
}

async function assertMember(workspaceId: string, userId: string) {
  if (!(await getMemberRole(workspaceId, userId))) throw new UserError("Workspace not found or access denied", "NOT_FOUND");
}

export async function getWorkspaceFileDraft(input: {
  workspaceId: string;
  userId: string;
  path: string;
  baseContent: string;
}) {
  await assertMember(input.workspaceId, input.userId);
  validatePath(input.path);
  const [draft] = await db.select().from(schema.workspaceFileDrafts).where(and(
    eq(schema.workspaceFileDrafts.workspaceId, input.workspaceId),
    eq(schema.workspaceFileDrafts.path, input.path),
  )).limit(1);
  return draft
    ? { content: draft.content, version: draft.version, updatedAt: draft.updatedAt.toISOString(), updatedByUserId: draft.updatedByUserId }
    : { content: input.baseContent, version: 0, updatedAt: null, updatedByUserId: null };
}

export async function saveWorkspaceFileDraft(input: {
  workspaceId: string;
  userId: string;
  path: string;
  content: string;
  expectedVersion: number;
}) {
  await assertMember(input.workspaceId, input.userId);
  validatePath(input.path);
  if (Buffer.byteLength(input.content, "utf8") > MAX_DRAFT_BYTES) throw new UserError("Draft exceeds the 1 MB editor limit");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new UserError("Invalid draft version");

  const values = {
    version: schema.workspaceFileDrafts.version,
    updatedAt: schema.workspaceFileDrafts.updatedAt,
    updatedByUserId: schema.workspaceFileDrafts.updatedByUserId,
  };
  const draft = input.expectedVersion === 0
    ? (await db.insert(schema.workspaceFileDrafts).values({
        workspaceId: input.workspaceId,
        path: input.path,
        content: input.content,
        version: 1,
        updatedByUserId: input.userId,
        updatedAt: new Date(),
      }).onConflictDoNothing().returning(values))[0]
    : (await db.update(schema.workspaceFileDrafts).set({
        content: input.content,
        version: sql`${schema.workspaceFileDrafts.version} + 1`,
        updatedByUserId: input.userId,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.workspaceFileDrafts.workspaceId, input.workspaceId),
        eq(schema.workspaceFileDrafts.path, input.path),
        eq(schema.workspaceFileDrafts.version, input.expectedVersion),
      )).returning(values))[0];

  if (!draft) throw new UserError("A teammate saved a newer draft. Load the latest shared version before saving again.", "CONFLICT");
  return { version: draft.version, updatedAt: draft.updatedAt.toISOString(), updatedByUserId: draft.updatedByUserId };
}
