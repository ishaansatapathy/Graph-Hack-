/**
 * FalkorDB-native retrieval: indexes, full-text search, multi-hop context,
 * connecting paths, impact radius and file ownership.
 *
 * Every query here is optional enrichment. It runs only against a live FalkorDB
 * graph and failures are contained per query, so a missing procedure or index
 * never marks the engine unavailable or breaks the basic retrieval path.
 */

import { type CypherParams, getGraph, type Row, workspaceGraphName } from "./falkordb";

async function tryFalkor(workspaceId: string, cypher: string, params: CypherParams = {}, write = false): Promise<Row[] | null> {
  try {
    const graph = await getGraph(workspaceGraphName(workspaceId));
    if (!graph) return null;
    const res = write ? await graph.query(cypher, { params }) : await graph.roQuery(cypher, { params });
    return (res.data ?? []) as Row[];
  } catch {
    return null;
  }
}

// ── Indexes ─────────────────────────────────────────────────────────────────

const RANGE_INDEXES: Array<[string, string]> = [
  ["Function", "name"], ["Function", "file"], ["File", "path"], ["Commit", "sha"],
  ["Commit", "branch"], ["Issue", "key"], ["Person", "email"], ["Decision", "title"],
];

const FULLTEXT_INDEXES: Record<string, string[]> = {
  Function: ["name", "signature"],
  Commit: ["message"],
  Issue: ["title"],
  Discussion: ["text"],
  Decision: ["title", "rationale"],
  SlackMessage: ["text"],
  Chunk: ["text"],
};

const indexedWorkspaces = new Set<string>();

/** Idempotent; creation errors for existing indexes are expected and ignored. */
export async function ensureGraphIndexes(workspaceId: string) {
  if (indexedWorkspaces.has(workspaceId)) return;
  const graph = await getGraph(workspaceGraphName(workspaceId)).catch(() => null);
  if (!graph) return;
  indexedWorkspaces.add(workspaceId);
  for (const [label, prop] of RANGE_INDEXES) {
    await tryFalkor(workspaceId, `CREATE INDEX FOR (n:${label}) ON (n.${prop})`, {}, true);
  }
  for (const [label, props] of Object.entries(FULLTEXT_INDEXES)) {
    const args = props.map((p) => `'${p}'`).join(", ");
    await tryFalkor(workspaceId, `CALL db.idx.fulltext.createNodeIndex('${label}', ${args})`, {}, true);
  }
}

// ── Full-text seeds ─────────────────────────────────────────────────────────

export type FullTextHit = { id: string; label: string; props: Record<string, unknown>; score: number };

export async function fullTextSeeds(
  workspaceId: string,
  keywords: string[],
  labels: string[] = Object.keys(FULLTEXT_INDEXES),
): Promise<FullTextHit[]> {
  if (keywords.length === 0) return [];
  // RediSearch syntax: escape punctuation, OR terms, prefix-match longer terms.
  const query = keywords
    .map((k) => k.replace(/[^a-z0-9_]/gi, " ").trim())
    .filter(Boolean)
    .map((k) => (k.length >= 4 ? `${k}*` : k))
    .join(" | ");
  if (!query) return [];

  const hits = await Promise.all(labels.filter((l) => l in FULLTEXT_INDEXES).map(async (label) => {
    const rows = await tryFalkor(
      workspaceId,
      `CALL db.idx.fulltext.queryNodes('${label}', $q) YIELD node, score
       RETURN id(node) AS id, labels(node)[0] AS label, properties(node) AS props, score
       ORDER BY score DESC LIMIT 5`,
      { q: query },
    );
    return (rows ?? []).map((r) => ({
      id: String(r.id),
      label: String(r.label),
      props: (r.props ?? {}) as Record<string, unknown>,
      score: Number(r.score ?? 0),
    }));
  }));
  return hits.flat().sort((a, b) => b.score - a.score).slice(0, 8);
}

// ── Multi-hop context ───────────────────────────────────────────────────────

const CONTEXT_LABELS = ["Issue", "Decision", "Discussion", "SlackMessage", "Person", "Test", "Commit"];

export type HopPath = { labels: string[]; rels: string[]; nodes: Record<string, unknown>[] };

function toPath(row: Row): HopPath {
  return {
    labels: (row.labels as string[]) ?? [],
    rels: (row.rels as string[]) ?? [],
    nodes: (row.nodes as Record<string, unknown>[]) ?? [],
  };
}

/** Reach context two or three hops away, e.g. Function ← Commit → Issue ← SlackMessage. */
export async function multiHopContext(workspaceId: string, seedId: string): Promise<HopPath[]> {
  const rows = await tryFalkor(
    workspaceId,
    `MATCH p = (s)-[*2..3]-(t)
     WHERE id(s) = $id AND labels(t)[0] IN $labels AND id(t) <> id(s) AND NONE(r IN relationships(p) WHERE type(r) = 'NEXT')
     RETURN [n IN nodes(p) | labels(n)[0]] AS labels,
            [r IN relationships(p) | type(r)] AS rels,
            [n IN nodes(p) | properties(n)] AS nodes
     LIMIT 8`,
    { id: Number(seedId), labels: CONTEXT_LABELS },
  );
  return (rows ?? []).map(toPath);
}

/** Shortest bounded path linking two retrieved nodes: explains how they relate. */
export async function connectingPath(workspaceId: string, fromId: string, toId: string): Promise<HopPath | null> {
  const rows = await tryFalkor(
    workspaceId,
    `MATCH (a), (b) WHERE id(a) = $a AND id(b) = $b
     WITH a, b MATCH p = (a)-[*1..4]-(b)
     RETURN [n IN nodes(p) | labels(n)[0]] AS labels,
            [r IN relationships(p) | type(r)] AS rels,
            [n IN nodes(p) | properties(n)] AS nodes
     ORDER BY length(p) ASC LIMIT 1`,
    { a: Number(fromId), b: Number(toId) },
  );
  return rows?.[0] ? toPath(rows[0]) : null;
}

// ── Impact radius and ownership ─────────────────────────────────────────────

export async function impactRadius(workspaceId: string, file: string) {
  const rows = await tryFalkor(
    workspaceId,
    `MATCH (f:Function) WHERE f.file = $file
     MATCH (c:Function)-[:CALLS*1..2]->(f) WHERE c.file <> $file
     RETURN DISTINCT c.name AS caller, c.file AS file LIMIT 15`,
    { file },
  );
  return (rows ?? []).map((r) => ({ caller: String(r.caller), file: String(r.file) }));
}

/**
 * Authors ranked by how many commits touched the file: the graph's notion of who owns it.
 * Counts pushed commits (Commit -MODIFIED-> File) and imported branches (Change -MODIFIES-> File,
 * whose `authors` is a comma-separated list, weighted by the branch's commit count).
 */
export async function fileOwners(workspaceId: string, file: string) {
  const [commitRows, changeRows] = await Promise.all([
    tryFalkor(
      workspaceId,
      `MATCH (c:Commit)-[:MODIFIED]->(f:File {path: $file})
       RETURN c.author AS author, count(c) AS commits ORDER BY commits DESC LIMIT 20`,
      { file },
    ),
    tryFalkor(
      workspaceId,
      `MATCH (c:Change)-[:MODIFIES]->(f:File {path: $file})
       RETURN c.authors AS authors, c.commitCount AS commits LIMIT 50`,
      { file },
    ),
  ]);
  const totals = new Map<string, number>();
  const add = (author: string, commits: number) => {
    const name = author.trim();
    if (name) totals.set(name, (totals.get(name) ?? 0) + Math.max(1, commits));
  };
  for (const r of commitRows ?? []) add(String(r.author ?? ""), Number(r.commits ?? 1));
  for (const r of changeRows ?? []) {
    for (const author of String(r.authors ?? "").split(",")) add(author, Number(r.commits ?? 1));
  }
  return [...totals.entries()]
    .map(([author, commits]) => ({ author, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 5);
}

/**
 * Conflict sides whose authors rarely touch the file compared with its primary owner.
 * A side may list several authors ("alice, bob"); it counts as inside if any of them does.
 */
export function authorsOutsideUsualArea(owners: { author: string; commits: number }[], sides: string[]) {
  const primary = owners[0];
  if (!primary) return [];
  return sides.filter((side) => {
    const names = side.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0 || names.includes(primary.author)) return false;
    const share = Math.max(0, ...names.map((n) => owners.find((o) => o.author === n)?.commits ?? 0));
    return share * 3 < primary.commits;
  });
}

/** Issues linked to a file through the commits or imported branches that changed it. */
export async function fileLinkedWork(workspaceId: string, file: string) {
  const [viaChanges, viaMentions] = await Promise.all([
    tryFalkor(
      workspaceId,
      `MATCH (f:File {path: $file})<-[:MODIFIED|MODIFIES]-(c)-[:REFERENCES]->(i:Issue)
       RETURN DISTINCT i.key AS key, i.title AS title, i.status AS status LIMIT 10`,
      { file },
    ),
    // Jira issues whose summary names the file or one of its functions.
    tryFalkor(
      workspaceId,
      `MATCH (i:Issue)-[:CONCERNS]->(t)
       WHERE (labels(t)[0] = 'File' AND t.path = $file) OR (labels(t)[0] = 'Function' AND t.file = $file)
       RETURN DISTINCT i.key AS key, i.title AS title, i.status AS status LIMIT 10`,
      { file },
    ),
  ]);
  const issues = new Map<string, { key: string; title: string; status: string }>();
  for (const r of [...(viaChanges ?? []), ...(viaMentions ?? [])]) {
    const key = String(r.key);
    if (!issues.has(key)) issues.set(key, { key, title: String(r.title ?? ""), status: String(r.status ?? "") });
  }
  return [...issues.values()].slice(0, 10);
}

/** Hover-card context for a file: owners, dependants and linked work items. */
export async function fileInsight(workspaceId: string, file: string) {
  await ensureGraphIndexes(workspaceId);
  const [owners, impact, issues] = await Promise.all([
    fileOwners(workspaceId, file),
    impactRadius(workspaceId, file),
    fileLinkedWork(workspaceId, file),
  ]);
  return { file, owners, impact, issues, primaryOwner: owners[0]?.author ?? null };
}

// ── Commit → issue suggestions ──────────────────────────────────────────────

const COMMIT_STOP_WORDS = new Set(["fix", "fixes", "add", "adds", "update", "updates", "the", "and", "for", "with", "from", "into", "wip", "merge", "branch"]);

export type IssueSuggestion = { key: string; title: string; status: string; reason: "text" | "file-history" };

/**
 * For a commit without an explicit issue key, rank likely issues by full-text
 * match on its message and by issues already linked to the files it changed.
 * Suggestions are recorded as LIKELY_RELATES edges; they never move tickets.
 */
export async function suggestIssuesForCommit(
  workspaceId: string,
  commit: { sha: string; message: string; files: string[] },
): Promise<IssueSuggestion[]> {
  await ensureGraphIndexes(workspaceId);
  const keywords = [...new Set((commit.message.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    .filter((w) => !COMMIT_STOP_WORDS.has(w)))].slice(0, 10);

  const suggestions = new Map<string, IssueSuggestion>();
  for (const hit of await fullTextSeeds(workspaceId, keywords, ["Issue"])) {
    const key = String(hit.props.key ?? "");
    if (key && hit.score >= 1) {
      suggestions.set(key, { key, title: String(hit.props.title ?? ""), status: String(hit.props.status ?? ""), reason: "text" });
    }
  }
  for (const file of commit.files.slice(0, 10)) {
    for (const issue of await fileLinkedWork(workspaceId, file)) {
      if (!suggestions.has(issue.key)) suggestions.set(issue.key, { ...issue, reason: "file-history" });
    }
  }

  const top = [...suggestions.values()].slice(0, 3);
  for (const s of top) {
    await tryFalkor(
      workspaceId,
      `MATCH (c:Commit {sha: $sha}), (i:Issue {key: $key})
       MERGE (c)-[r:LIKELY_RELATES]->(i) SET r.reason = $reason`,
      { sha: commit.sha, key: s.key, reason: s.reason },
      true,
    );
  }
  return top;
}

export function describePath(path: HopPath, format: (props: Record<string, unknown>) => string): string {
  const parts: string[] = [];
  path.labels.forEach((label, i) => {
    const props = path.nodes[i] ?? {};
    const summary = format(props).slice(0, 160);
    parts.push(`[${label}${summary ? ` ${summary}` : ""}]`);
    if (i < path.rels.length) parts.push(`-${path.rels[i]}-`);
  });
  return parts.join(" ");
}
