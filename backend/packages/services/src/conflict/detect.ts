import { graphRead } from "../graph/falkordb";

/** Shared files are only candidates; this graph does not contain merge-base hunks. */
export type ConflictRecord = {
  id: string;
  file: string;
  authorA: string;
  commitShaA: string;
  messageA: string;
  branchA: string;
  authorB: string;
  commitShaB: string;
  messageB: string;
  branchB: string;
  status: "open";
  evidence?: "overlapping_hunks" | "diff_unavailable";
  overlappingLines?: string[];
  patchA?: string;
  patchB?: string;
};

/** Return possible same-file branch overlaps without claiming a Git conflict was confirmed. */
export async function detectConflicts(workspaceId: string): Promise<ConflictRecord[]> {
  const rows = await graphRead(
    workspaceId,
    `MATCH (f:File)<-[:MODIFIED]-(a:Commit), (f)<-[:MODIFIED]-(b:Commit)
     WHERE a.branch <> b.branch AND a.sha < b.sha
     RETURN f.path AS file,
            a.sha AS shaA, a.author AS authorA, a.message AS messageA, a.branch AS branchA,
            b.sha AS shaB, b.author AS authorB, b.message AS messageB, b.branch AS branchB
     ORDER BY file, shaA, shaB
     LIMIT 50`,
  );

  const unique = new Map<string, ConflictRecord>();
  for (const row of rows) {
    const file = String(row.file ?? "");
    const shaA = String(row.shaA ?? "");
    const shaB = String(row.shaB ?? "");
    if (!file || !shaA || !shaB) continue;
    const id = `${shaA}:${shaB}:${file}`;
    if (unique.has(id)) continue;
    unique.set(id, {
      id,
      file,
      authorA: String(row.authorA ?? "unknown"),
      commitShaA: shaA,
      messageA: String(row.messageA ?? "(commit message unavailable)"),
      branchA: String(row.branchA ?? "unknown"),
      authorB: String(row.authorB ?? "unknown"),
      commitShaB: shaB,
      messageB: String(row.messageB ?? "(commit message unavailable)"),
      branchB: String(row.branchB ?? "unknown"),
      status: "open",
    });
  }
  return [...unique.values()];
}
