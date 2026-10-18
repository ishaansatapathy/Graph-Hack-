import * as workspaceDb from "../workspace/db";
import { decryptJson } from "../workspace/secrets";
import { detectConflicts, type ConflictRecord } from "./detect";

const API = "https://api.github.com";
type FileDiff = { filename: string; patch?: string };

function ranges(patch: string) {
  return [...patch.matchAll(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g)].map((m) => {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    return { start, end: start + Math.max(count, 1) - 1 };
  });
}

function redact(patch: string) {
  return patch
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(token|secret|password|api[_-]?key)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .slice(0, 4000);
}

async function compare(token: string, repository: string, base: string, head: string) {
  const response = await fetch(`${API}/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`GitHub compare failed (${response.status})`);
  const result = await response.json() as { files?: FileDiff[] };
  return result.files ?? [];
}

/** Enrich graph candidates with bounded patches from each branch's merge-base diff. */
export async function scanGithubConflicts(workspaceId: string): Promise<ConflictRecord[]> {
  const candidates = await detectConflicts(workspaceId);
  const integration = await workspaceDb.getIntegration(workspaceId, "github");
  if (!integration) return candidates.map((c) => ({ ...c, evidence: "diff_unavailable" }));
  const config = decryptJson(integration.config_encrypted) as { personalAccessToken?: string; repositoryFullName?: string };
  const token = config.personalAccessToken?.trim();
  const repository = config.repositoryFullName?.trim();
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return candidates.map((c) => ({ ...c, evidence: "diff_unavailable" }));
  }

  const pairs = new Map<string, ConflictRecord[]>();
  for (const c of candidates) {
    const key = `${c.branchA}\0${c.branchB}`;
    pairs.set(key, [...(pairs.get(key) ?? []), c]);
  }
  const enriched = new Map<string, ConflictRecord>(candidates.map((c) => [c.id, { ...c, evidence: "diff_unavailable" }]));
  for (const [pair, records] of [...pairs.entries()].slice(0, 10)) {
    const [branchA, branchB] = pair.split("\0");
    try {
      const [a, b] = await Promise.all([
        compare(token, repository, branchB, branchA),
        compare(token, repository, branchA, branchB),
      ]);
      const byA = new Map(a.map((f) => [f.filename, f.patch ?? ""]));
      const byB = new Map(b.map((f) => [f.filename, f.patch ?? ""]));
      for (const c of records) {
        const patchA = byA.get(c.file);
        const patchB = byB.get(c.file);
        if (patchA === undefined || patchB === undefined || !patchA || !patchB) {
          enriched.set(c.id, { ...c, evidence: "diff_unavailable" });
          continue;
        }
        const overlaps = ranges(patchA).flatMap((ra) => ranges(patchB)
          .filter((rb) => ra.start <= rb.end && rb.start <= ra.end)
          .map((rb) => `base lines ${Math.max(ra.start, rb.start)}–${Math.min(ra.end, rb.end)}`));
        if (overlaps.length) enriched.set(c.id, {
          ...c, evidence: "overlapping_hunks", overlappingLines: [...new Set(overlaps)].slice(0, 10),
          patchA: redact(patchA), patchB: redact(patchB),
        });
        else enriched.delete(c.id);
      }
    } catch {
      for (const c of records) enriched.set(c.id, { ...c, evidence: "diff_unavailable" });
    }
  }
  return candidates.flatMap((c) => enriched.has(c.id) ? [enriched.get(c.id)!] : []);
}
