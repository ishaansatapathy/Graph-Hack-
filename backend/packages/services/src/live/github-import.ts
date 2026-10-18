import { indexCodeFiles } from "../graph/code-index";
import { graphRead, graphWrite } from "../graph/falkordb";
import { extractJiraKeys } from "../github/push-schema";
import * as workspaceDb from "../workspace/db";
import { decryptJson } from "../workspace/secrets";
import { publish } from "./bus";
import { agentId, changeId, fileLanguage, slotFor } from "./model";
import { evidenceFor } from "./snapshot";
import type { LiveLog, LivePatch } from "./types";

const API = "https://api.github.com";
const MAX_BRANCHES = 8;
const MAX_FILES_PER_CHANGE = 60;
const MAX_CONFLICTS = 30;
const MAX_CONTENT_FILES = 12;
const MAX_CONTENT_BYTES = 200_000;

const running = new Set<string>();

export class ImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type CompareFile = { filename: string; status: string; additions: number; deletions: number };
type Compare = {
  ahead_by: number;
  behind_by: number;
  commits: { sha: string; commit: { message: string; author?: { name?: string } }; author?: { login?: string } | null }[];
  files?: CompareFile[];
};

type Side = {
  id: string;
  branch: string;
  isDefault: boolean;
  ahead: number;
  behind: number;
  title: string;
  authors: string;
  headSha: string;
  shas: Set<string>;
  files: Set<string>;
};

export function isValidRepoName(repo: string) {
  return /^[\w.-]+\/[\w.-]+$/.test(repo);
}

async function githubToken(workspaceId: string): Promise<string | undefined> {
  try {
    const row = await workspaceDb.getIntegration(workspaceId, "github");
    const token = row ? (decryptJson(row.config_encrypted) as { personalAccessToken?: string }).personalAccessToken : undefined;
    if (token?.trim()) return token.trim();
  } catch {
    // no integration configured
  }
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

function client(token: string | undefined) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "stackfox",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        throw new ImportError("GitHub API rate limit reached. Set GITHUB_TOKEN in backend .env or connect GitHub in the workspace.", 429);
      }
      if (res.status === 404) throw new ImportError(`GitHub returned 404 for ${path} — check the repository name (private repos need a token).`, 404);
      throw new ImportError(`GitHub ${res.status}: ${body?.message ?? res.statusText}`, 502);
    }
    return res.json() as Promise<T>;
  }

  async function raw(repo: string, path: string, ref: string): Promise<string> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    // Without a token, raw.githubusercontent.com keeps file reads off the 60/h API quota.
    const res = token
      ? await fetch(`${API}/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
          headers: { ...headers, Accept: "application/vnd.github.raw+json" },
        })
      : await fetch(`https://raw.githubusercontent.com/${repo}/${ref.split("/").map(encodeURIComponent).join("/")}/${encodedPath}`);
    if (res.status === 404) return "";
    if (!res.ok) throw new ImportError(`GitHub ${res.status} reading ${path}@${ref}`, 502);
    const text = await res.text();
    return text.length > MAX_CONTENT_BYTES ? `${text.slice(0, MAX_CONTENT_BYTES)}\n/* … truncated by Stackfox */\n` : text;
  }

  return { get, raw };
}

/** Times an async call and publishes it as a tool_call / tool_result pair. */
async function tool<T>(
  workspaceId: string,
  actor: string,
  name: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
  summarize: (r: T) => { message: string; result?: unknown; patches?: LivePatch[] },
): Promise<T> {
  emit(workspaceId, { actor, kind: "tool_call", tool: name, args, message: name });
  const t0 = performance.now();
  const r = await fn();
  const s = summarize(r);
  emit(workspaceId, { actor, kind: "tool_result", tool: name, durationMs: Math.round(performance.now() - t0), result: s.result, message: s.message }, s.patches);
  return r;
}

function emit(workspaceId: string, log: LiveLog, patches: LivePatch[] = []) {
  publish(workspaceId, { log, patches });
}

const firstLine = (s: string) => s.split("\n")[0]!.trim();

function sideFromCompare(repo: string, branch: string, isDefault: boolean, cmp: Compare): Side {
  const authors = [...new Set(cmp.commits.map((c) => c.author?.login ?? c.commit.author?.name).filter(Boolean))] as string[];
  const last = cmp.commits[cmp.commits.length - 1];
  return {
    id: changeId(repo, branch),
    branch,
    isDefault,
    ahead: cmp.ahead_by,
    behind: cmp.behind_by,
    title: last ? firstLine(last.commit.message) : branch,
    authors: authors.slice(0, 3).join(", "),
    headSha: last?.sha ?? "",
    shas: new Set(cmp.commits.map((c) => c.sha)),
    files: new Set((cmp.files ?? []).slice(0, MAX_FILES_PER_CHANGE).map((f) => f.filename)),
  };
}

async function writeSide(workspaceId: string, repo: string, side: Side, index: number, messages: string[]) {
  await graphWrite(
    workspaceId,
    `MATCH (r:Repository {name: $repo})
     MERGE (c:Change {id: $id})
     SET c.repo = $repo, c.branch = $branch, c.isDefault = $isDefault, c.ahead = $ahead, c.behind = $behind,
         c.title = $title, c.authors = $authors, c.headSha = $headSha, c.commitCount = $commitCount, c.updatedAt = $at
     MERGE (r)-[:HAS_CHANGE]->(c)`,
    {
      repo,
      id: side.id,
      branch: side.branch,
      isDefault: side.isDefault,
      ahead: side.ahead,
      behind: side.behind,
      title: side.title,
      authors: side.authors,
      headSha: side.headSha,
      commitCount: side.shas.size,
      at: new Date().toISOString(),
    },
  );

  const changeNode = `change:${side.id}`;
  const aid = agentId(repo, side.branch);
  const patches: LivePatch[] = [
    {
      op: "agentUpsert",
      agent: {
        id: aid,
        name: side.authors || side.branch,
        slot: slotFor(index),
        branch: side.branch,
        model: side.isDefault ? "default branch" : `${side.ahead} ahead · ${side.behind} behind`,
        task: side.title,
        status: side.isDefault ? "idle" : "working",
      },
    },
    { op: "node", node: { id: changeNode, kind: "change", label: side.branch, centrality: 0.5, agentId: aid } },
  ];

  for (const path of side.files) {
    await graphWrite(
      workspaceId,
      `MATCH (r:Repository {name: $repo}), (c:Change {id: $id})
       MERGE (f:File {path: $path})
       SET f.repo = $repo, f.language = $lang
       MERGE (r)-[:CONTAINS]->(f)
       MERGE (c)-[:MODIFIES]->(f)`,
      { repo, id: side.id, path, lang: fileLanguage(path) },
    );
    const fileNode = `file:${path}`;
    patches.push(
      { op: "node", node: { id: fileNode, kind: "file", label: path.split("/").pop() || path, path, centrality: 0.2 } },
      { op: "edge", edge: { id: `${changeNode}|MODIFIES|${fileNode}`, source: changeNode, target: fileNode, kind: "MODIFIES" } },
    );
  }

  for (const key of [...new Set(messages.flatMap(extractJiraKeys))].slice(0, 10)) {
    await graphWrite(
      workspaceId,
      `MATCH (c:Change {id: $id}) MERGE (i:Issue {key: $key}) MERGE (c)-[:REFERENCES]->(i)`,
      { id: side.id, key },
    );
    const issueNode = `issue:${key}`;
    patches.push(
      { op: "node", node: { id: issueNode, kind: "issue", label: key, centrality: 0.2 } },
      { op: "edge", edge: { id: `${changeNode}|REFERENCES|${issueNode}`, source: changeNode, target: issueNode, kind: "REFERENCES" } },
    );
  }

  patches.push({
    op: "changeUpsert",
    change: {
      id: side.id,
      agentId: aid,
      title: side.title,
      files: [...side.files],
      nodeId: changeNode,
      touches: [...side.files].map((p) => `file:${p}`),
      status: "pending",
      risk: null,
    },
  });
  patches.push({ op: "pulse", nodeIds: [changeNode] });

  emit(
    workspaceId,
    {
      actor: aid,
      kind: "action",
      message: side.isDefault
        ? `${side.branch} · ${side.files.size} files changed since feature branches diverged`
        : `${side.branch} · ${side.ahead} commits ahead, ${side.files.size} files · "${side.title}"`,
    },
    patches,
  );
}

export async function importGithubRepo(workspaceId: string, repo: string) {
  if (!isValidRepoName(repo)) throw new ImportError("Use the owner/name form, e.g. vercel/next.js");
  if (running.has(workspaceId)) throw new ImportError("An import is already running for this workspace", 409);
  running.add(workspaceId);
  try {
    await runImport(workspaceId, repo);
  } catch (error) {
    emit(workspaceId, {
      actor: "stackfox",
      kind: "system",
      message: `Import failed · ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  } finally {
    running.delete(workspaceId);
  }
}

async function runImport(workspaceId: string, repo: string) {
  const gh = client(await githubToken(workspaceId));
  emit(workspaceId, { actor: "stackfox", kind: "system", message: `Importing ${repo} from GitHub` }, [{ op: "phase", phase: "working" }]);

  const meta = await tool(workspaceId, "github", "github.get_repo", { repo }, () => gh.get<{ full_name: string; default_branch: string }>(`/repos/${repo}`), (r) => ({
    message: `default branch ${r.default_branch}`,
    result: { default_branch: r.default_branch },
  }));
  const fullName = meta.full_name;
  const base = meta.default_branch;

  const branches = await tool(workspaceId, "github", "github.list_branches", { repo: fullName }, () => gh.get<{ name: string }[]>(`/repos/${fullName}/branches?per_page=100`), (r) => ({
    message: `${r.length} branches`,
    result: r.slice(0, 12).map((b) => b.name),
  }));
  const candidates = branches.map((b) => b.name).filter((n) => n !== base).slice(0, MAX_BRANCHES);

  // Replace this repo's previous import; File/Issue nodes are shared and kept.
  await graphWrite(workspaceId, `MATCH (n) WHERE (n:Change OR n:Conflict) AND n.repo = $repo DETACH DELETE n`, { repo: fullName });
  await graphWrite(workspaceId, `MERGE (r:Repository {name: $repo}) SET r.defaultBranch = $base, r.importedAt = $at, r.source = 'github'`, {
    repo: fullName,
    base,
    at: new Date().toISOString(),
  });

  const sides: Side[] = [];
  const baseSince = new Map<string, Set<string>>(); // branch -> files changed on base since merge-base
  const baseFiles = new Set<string>();
  const baseMessages: string[] = [];
  let baseAhead = 0;
  for (const branch of candidates) {
    const cmp = await tool(
      workspaceId,
      "github",
      "github.compare",
      { base, head: branch },
      () => gh.get<Compare>(`/repos/${fullName}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`),
      (r) => ({ message: `${r.ahead_by} ahead · ${r.behind_by} behind · ${r.files?.length ?? 0} files`, result: { ahead: r.ahead_by, behind: r.behind_by, files: r.files?.length ?? 0 } }),
    );
    if (cmp.ahead_by === 0) continue;
    const side = sideFromCompare(fullName, branch, false, cmp);
    sides.push(side);
    await writeSide(workspaceId, fullName, side, sides.length - 1, cmp.commits.map((c) => c.commit.message));

    if (cmp.behind_by > 0) {
      const back = await tool(
        workspaceId,
        "github",
        "github.compare",
        { base: branch, head: base },
        () => gh.get<Compare>(`/repos/${fullName}/compare/${encodeURIComponent(branch)}...${encodeURIComponent(base)}`),
        (r) => ({ message: `${base} moved ${r.ahead_by} commits · ${r.files?.length ?? 0} files`, result: { ahead: r.ahead_by, files: r.files?.length ?? 0 } }),
      );
      const files = new Set((back.files ?? []).slice(0, MAX_FILES_PER_CHANGE).map((f) => f.filename));
      baseSince.set(branch, files);
      files.forEach((f) => baseFiles.add(f));
      baseAhead = Math.max(baseAhead, back.ahead_by);
      baseMessages.push(...back.commits.map((c) => c.commit.message));
    }
  }

  if (baseFiles.size > 0) {
    const side: Side = {
      id: changeId(fullName, base),
      branch: base,
      isDefault: true,
      ahead: baseAhead,
      behind: 0,
      title: baseMessages.length ? firstLine(baseMessages[baseMessages.length - 1]!) : base,
      authors: "",
      headSha: "",
      shas: new Set(),
      files: new Set([...baseFiles].slice(0, MAX_FILES_PER_CHANGE)),
    };
    sides.push(side);
    await writeSide(workspaceId, fullName, side, sides.length - 1, baseMessages);
  }

  if (sides.length === 0) {
    emit(workspaceId, { actor: "stackfox", kind: "system", message: `${fullName} has no branches ahead of ${base} — nothing to compare yet` }, [{ op: "phase", phase: "idle" }]);
    return;
  }

  // Overlap detection: two sides that both touch a file since they diverged.
  emit(workspaceId, { actor: "stackfox", kind: "tool_call", tool: "detect_conflicts", args: { repo: fullName, changes: sides.map((s) => s.branch) }, message: "detect_conflicts" });
  const t0 = performance.now();
  const pairs: { a: Side; b: Side; file: string }[] = [];
  const features = sides.filter((s) => !s.isDefault);
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i]!;
      const b = features[j]!;
      const stacked = [...a.shas].every((s) => b.shas.has(s)) || [...b.shas].every((s) => a.shas.has(s));
      if (stacked) continue;
      for (const f of a.files) if (b.files.has(f)) pairs.push({ a, b, file: f });
    }
  }
  const baseSide = sides.find((s) => s.isDefault);
  if (baseSide) {
    for (const a of features) {
      for (const f of baseSince.get(a.branch) ?? []) if (a.files.has(f) && baseSide.files.has(f)) pairs.push({ a, b: baseSide, file: f });
    }
  }
  const conflicts = pairs.slice(0, MAX_CONFLICTS);
  emit(workspaceId, {
    actor: "stackfox",
    kind: "tool_result",
    tool: "detect_conflicts",
    durationMs: Math.round(performance.now() - t0),
    result: conflicts.map((c) => `${c.a.branch} × ${c.b.branch} · ${c.file}`).slice(0, 10),
    message: conflicts.length ? `${conflicts.length} overlapping file${conflicts.length === 1 ? "" : "s"}` : "no overlapping changes",
  });

  // Base-branch content once per file, branch content per (change, file).
  const contentDone = new Set<string>();
  const sources = new Map<string, string>();
  let contentFiles = 0;
  for (const { a, b, file } of conflicts) {
    const id = `${fullName}:${a.branch}|${b.branch}:${file}`;
    const detectedAt = new Date().toISOString();
    await graphWrite(
      workspaceId,
      `MATCH (f:File {path: $file}), (ca:Change {id: $a}), (cb:Change {id: $b})
       MERGE (x:Conflict {id: $id})
       SET x.repo = $repo, x.file = $file, x.a = $a, x.b = $b, x.status = 'open', x.detectedAt = $at
       MERGE (x)-[:AFFECTS]->(f)
       MERGE (x)-[:BETWEEN]->(ca)
       MERGE (x)-[:BETWEEN]->(cb)`,
      { id, repo: fullName, file, a: a.id, b: b.id, at: detectedAt },
    );

    if (contentFiles < MAX_CONTENT_FILES) {
      for (const side of [a, b]) {
        const key = `${side.id}:${file}`;
        if (side.isDefault || contentDone.has(key)) continue;
        contentDone.add(key);
        const [original, modified] = await Promise.all([gh.raw(fullName, file, base), gh.raw(fullName, file, side.branch)]);
        // Index functions from the default branch; a file new on the branch has no base content.
        if (!sources.get(file)) sources.set(file, original || modified);
        await graphWrite(workspaceId, `MATCH (f:File {path: $file}) SET f.baseContent = $original`, { file, original });
        await graphWrite(workspaceId, `MATCH (c:Change {id: $id})-[m:MODIFIES]->(f:File {path: $file}) SET m.content = $modified`, { id: side.id, file, modified });
        emit(workspaceId, { actor: "github", kind: "action", message: `Fetched ${file} @ ${base} and @ ${side.branch}` }, [
          {
            op: "file",
            file: {
              path: file,
              agentId: agentId(fullName, side.branch),
              changeId: side.id,
              language: fileLanguage(file),
              original,
              modified,
              anchors: [{ nodeId: `file:${file}`, line: 1 }],
            },
          },
        ]);
      }
      contentFiles++;
    }

    // Prove the path exists in the graph before reporting it.
    const ev = evidenceFor({ id, file, a: a.id, b: b.id });
    const t1 = performance.now();
    const rows = await graphRead(
      workspaceId,
      `MATCH (a:Change {id: $a})-[:MODIFIES]->(f:File {path: $file})<-[:MODIFIES]-(b:Change {id: $b}) RETURN count(f) AS n`,
      { a: a.id, b: b.id, file },
    );
    const verified = Number(rows[0]?.n ?? 0) > 0;
    const conflictNode = `conflict:${id}`;
    const fileNode = `file:${file}`;
    emit(
      workspaceId,
      {
        actor: "stackfox",
        kind: "conflict",
        tool: "evidence_path",
        durationMs: Math.round(performance.now() - t1),
        message: `${a.branch} × ${b.branch} both modify ${file}${verified ? "" : " (graph path not found)"}`,
      },
      [
        { op: "phase", phase: "evidence" },
        { op: "node", node: { id: conflictNode, kind: "incident", label: `⚠ ${file.split("/").pop()}`, path: file, centrality: 0.3 } },
        { op: "edge", edge: { id: `${conflictNode}|INVOLVED|${fileNode}`, source: conflictNode, target: fileNode, kind: "INVOLVED" } },
        { op: "change", id: a.id, status: "conflict" },
        { op: "change", id: b.id, status: "conflict" },
        { op: "agent", id: agentId(fullName, a.branch), status: "blocked" },
        ...(b.isDefault ? [] : [{ op: "agent" as const, id: agentId(fullName, b.branch), status: "blocked" as const }]),
        {
          op: "incident",
          incident: {
            id,
            title: `Conflict · ${file}`,
            summary: `${a.branch} × ${b.branch} both modify this file`,
            occurredAt: detectedAt,
            sessionId: workspaceId,
            nodeId: conflictNode,
            recalled: false,
            isNew: true,
          },
        },
        { op: "evidence", path: ev },
        { op: "pulse", nodeIds: [conflictNode, `change:${a.id}`, `change:${b.id}`] },
      ],
    );
  }

  if (sources.size > 0) {
    const t2 = performance.now();
    emit(workspaceId, { actor: "stackfox", kind: "tool_call", tool: "index_code", args: { files: [...sources.keys()] }, message: "index_code" });
    const indexed = await indexCodeFiles(workspaceId, [...sources].map(([path, source]) => ({ path, source })))
      .catch((error: unknown) => {
        console.warn("[import] code index skipped", error instanceof Error ? error.message : error);
        return null;
      });
    emit(workspaceId, {
      actor: "stackfox",
      kind: "tool_result",
      tool: "index_code",
      durationMs: Math.round(performance.now() - t2),
      message: indexed ? `${indexed.functions} functions · ${indexed.calls} calls from ${indexed.files} files` : "code index skipped",
    });
  }

  emit(
    workspaceId,
    {
      actor: "stackfox",
      kind: conflicts.length ? "system" : "verified",
      message: `Import complete · ${features.length} branches · ${new Set(sides.flatMap((s) => [...s.files])).size} files · ${conflicts.length} conflicts`,
    },
    [{ op: "phase", phase: conflicts.length ? "evidence" : "merged" }],
  );
}
