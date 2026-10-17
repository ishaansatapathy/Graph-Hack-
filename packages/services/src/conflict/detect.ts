/**
 * Conflict detection via FalkorDB graph queries.
 *
 * A "conflict" exists when:
 *   - Two or more different authors have MODIFIED the same File
 *     via different Commits on different branches.
 *   - OR a Conflict node is explicitly stored (from a git push event).
 *
 * We query the graph and return structured conflict records.
 */

import { graphRead, graphWrite } from "../graph/falkordb";

export type ConflictRecord = {
  id: string;            // synthetic or stored
  file: string;          // file path
  authorA: string;
  commitShaA: string;
  messageA: string;
  branchA: string;
  authorB: string;
  commitShaB: string;
  messageB: string;
  branchB: string;
  status: "open" | "resolved";
};

// ── Detect conflicts from the graph ─────────────────────────────────────────

export async function detectConflicts(workspaceId: string): Promise<ConflictRecord[]> {
  const results: ConflictRecord[] = [];

  // 1. Check for explicit Conflict nodes (from git push handler)
  const explicit = await graphRead(
    workspaceId,
    `MATCH (c:Conflict)-[:AFFECTS]->(f:Function)<-[:MODIFIED]-(cm:Commit)
     OPTIONAL MATCH (c)-[:BETWEEN]->(cm2:Commit)
     RETURN c.id AS id, c.file AS file, c.baseBranch AS branchA, c.incomingBranch AS branchB,
            cm.sha AS shaA, cm.author AS authorA, cm.message AS msgA,
            cm2.sha AS shaB, cm2.author AS authorB, cm2.message AS msgB,
            c.status AS status
     LIMIT 50`,
  );

  for (const r of explicit) {
    results.push({
      id: String(r.id ?? `conflict-${results.length}`),
      file: String(r.file ?? r["c.file"] ?? "unknown"),
      authorA: String(r.authorA ?? ""),
      commitShaA: String(r.shaA ?? "").slice(0, 8),
      messageA: String(r.msgA ?? ""),
      branchA: String(r.branchA ?? "main"),
      authorB: String(r.authorB ?? ""),
      commitShaB: String(r.shaB ?? "").slice(0, 8),
      messageB: String(r.msgB ?? ""),
      branchB: String(r.branchB ?? ""),
      status: (r.status as "open" | "resolved") ?? "open",
    });
  }

  // 2. Detect implicit conflicts: same File modified by 2+ authors on different branches
  const implicit = await graphRead(
    workspaceId,
    `MATCH (f:File)<-[:MODIFIED]-(cA:Commit), (f)<-[:MODIFIED]-(cB:Commit)
     WHERE cA.branch <> cB.branch AND cA.author <> cB.author AND cA.sha < cB.sha
     RETURN f.path AS file,
            cA.sha AS shaA, cA.author AS authorA, cA.message AS msgA, cA.branch AS branchA,
            cB.sha AS shaB, cB.author AS authorB, cB.message AS msgB, cB.branch AS branchB
     LIMIT 20`,
  );

  const existingFiles = new Set(results.map((r) => r.file));
  for (const r of implicit) {
    const file = String(r.file ?? "");
    if (existingFiles.has(file)) continue; // already from explicit node
    existingFiles.add(file);
    results.push({
      id: `auto-${String(r.shaA).slice(0, 6)}-${String(r.shaB).slice(0, 6)}`,
      file,
      authorA: String(r.authorA ?? ""),
      commitShaA: String(r.shaA ?? "").slice(0, 8),
      messageA: String(r.msgA ?? ""),
      branchA: String(r.branchA ?? ""),
      authorB: String(r.authorB ?? ""),
      commitShaB: String(r.shaB ?? "").slice(0, 8),
      messageB: String(r.msgB ?? ""),
      branchB: String(r.branchB ?? ""),
      status: "open",
    });
  }

  return results;
}

// ── Mark a conflict as resolved in the graph ─────────────────────────────────

export async function markConflictResolved(
  workspaceId: string,
  conflictId: string,
  resolution: string,
): Promise<void> {
  // Update existing Conflict node if it has an id
  await graphWrite(
    workspaceId,
    `MATCH (c:Conflict {id: $id})
     SET c.status = 'resolved', c.resolution = $resolution, c.resolvedAt = $at`,
    { id: conflictId, resolution: resolution.slice(0, 500), at: new Date().toISOString() },
  );
}
