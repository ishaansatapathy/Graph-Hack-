import { graphRead, isGraphEngineActive, workspaceGraphName } from "../graph/falkordb";
import { TOOL_CATALOG } from "../workspace/tools";
import { agentId, edgeKind, fileLanguage, kindForLabel, nodeKey, nodeLabel, slotFor } from "./model";
import type {
  LiveAgent,
  LiveChange,
  LiveCodeFile,
  LiveEdge,
  LiveEvidence,
  LiveIncident,
  LiveNode,
  LiveSnapshot,
} from "./types";

const NODE_LIMIT = 2000;

type Props = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

export function evidenceFor(conflict: Props): LiveEvidence {
  const file = str(conflict.file);
  const a = str(conflict.a);
  const b = str(conflict.b);
  const fileNode = `file:${file}`;
  return {
    id: `evidence:${conflict.id}`,
    from: `change:${a}`,
    to: `change:${b}`,
    summary: `${a.split("@").pop()} and ${b.split("@").pop()} both modify ${file} since they diverged. Git may merge the text, but the two changes were written without seeing each other.`,
    cypher: `MATCH p = (a:Change {id: '${a}'})-[:MODIFIES]->(f:File {path: '${file}'})<-[:MODIFIES]-(b:Change {id: '${b}'})\nRETURN p`,
    hops: [
      { nodeId: `change:${a}`, why: `pending change on ${a.split("@").pop()}` },
      { nodeId: fileNode, edgeId: `change:${a}|MODIFIES|${fileNode}`, relation: "MODIFIES", why: `${file} — touched on both sides` },
      { nodeId: `change:${b}`, edgeId: `change:${b}|MODIFIES|${fileNode}`, relation: "MODIFIES", why: `pending change on ${b.split("@").pop()}` },
    ],
  };
}

export async function buildSnapshot(workspaceId: string): Promise<LiveSnapshot> {
  const [nodeRows, edgeRows, repoRows, contentRows] = await Promise.all([
    graphRead(workspaceId, "MATCH (n) RETURN id(n) AS id, labels(n)[0] AS label, properties(n) AS props LIMIT $limit", {
      limit: NODE_LIMIT,
    }),
    graphRead(workspaceId, "MATCH (a)-[r]->(b) RETURN id(a) AS s, id(b) AS t, type(r) AS type LIMIT $limit", {
      limit: NODE_LIMIT * 4,
    }),
    graphRead(
      workspaceId,
      "MATCH (r:Repository) RETURN r.name AS name, r.importedAt AS importedAt ORDER BY r.importedAt DESC LIMIT 1",
    ),
    graphRead(
      workspaceId,
      `MATCH (c:Change)-[m:MODIFIES]->(f:File) WHERE m.content IS NOT NULL
       RETURN c.id AS changeId, c.repo AS repo, c.branch AS branch, f.path AS path,
              f.baseContent AS original, m.content AS modified`,
    ),
  ]);

  // Nodes, keyed by stable id.
  const keyByInternal = new Map<string, string>();
  const nodes: LiveNode[] = [];
  const changeProps: Props[] = [];
  const conflictProps: Props[] = [];
  const commitProps: Props[] = [];
  for (const row of nodeRows) {
    const label = str(row.label);
    const props = (row.props ?? {}) as Props;
    if (label === "Change") changeProps.push(props);
    if (label === "Conflict") conflictProps.push(props);
    if (label === "Commit") commitProps.push(props);
    const kind = kindForLabel(label);
    if (!kind) continue;
    const id = nodeKey(label, props, str(row.id));
    keyByInternal.set(str(row.id), id);
    nodes.push({
      id,
      kind,
      label: nodeLabel(label, props),
      ...(props.path || props.file ? { path: str(props.path ?? props.file) } : {}),
      centrality: 0,
    });
  }

  const edges: LiveEdge[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();
  for (const row of edgeRows) {
    const source = keyByInternal.get(str(row.s));
    const target = keyByInternal.get(str(row.t));
    if (!source || !target) continue;
    const kind = edgeKind(str(row.type));
    const id = `${source}|${kind}|${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degree.values());
  for (const n of nodes) n.centrality = +((degree.get(n.id) ?? 0) / maxDegree).toFixed(3);

  // Agents = branches with pending changes. Default branch sorts last.
  changeProps.sort((x, y) => Number(Boolean(x.isDefault)) - Number(Boolean(y.isDefault)) || str(x.branch).localeCompare(str(y.branch)));
  const conflicted = new Set(conflictProps.filter((c) => c.status !== "resolved").flatMap((c) => [str(c.a), str(c.b)]));

  const agents: LiveAgent[] = [];
  const changes: LiveChange[] = [];
  const touchesByChange = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "MODIFIES" || !e.source.startsWith("change:")) continue;
    touchesByChange.set(e.source, [...(touchesByChange.get(e.source) ?? []), e.target]);
  }

  changeProps.forEach((c, i) => {
    const id = str(c.id);
    const aid = agentId(str(c.repo), str(c.branch));
    const inConflict = conflicted.has(id);
    agents.push({
      id: aid,
      name: str(c.authors) || str(c.branch),
      slot: slotFor(i),
      branch: str(c.branch),
      model: c.isDefault ? "default branch" : `${c.ahead ?? 0} ahead · ${c.behind ?? 0} behind`,
      task: str(c.title),
      status: inConflict ? "blocked" : c.isDefault ? "idle" : "working",
    });
    const nodeId = `change:${id}`;
    const node = nodes.find((n) => n.id === nodeId);
    if (node) node.agentId = aid;
    const touches = touchesByChange.get(nodeId) ?? [];
    changes.push({
      id,
      agentId: aid,
      title: str(c.title) || str(c.branch),
      files: touches.map((t) => t.slice("file:".length)),
      nodeId,
      touches,
      status: inConflict ? "conflict" : "pending",
      risk: null,
    });
  });

  // Webhook-ingested commits get the colour of their branch's agent, when there is one.
  for (const c of commitProps) {
    const agent = agents.find((a) => a.branch === str(c.branch));
    const node = nodes.find((n) => n.id === `commit:${c.sha}`);
    if (agent && node) node.agentId = agent.id;
  }

  const incidents: LiveIncident[] = conflictProps.map((c) => ({
    id: str(c.id),
    title: `Conflict · ${str(c.file)}`,
    summary: `${str(c.a).split("@").pop()} × ${str(c.b).split("@").pop()} both modify this file`,
    occurredAt: str(c.detectedAt) || new Date().toISOString(),
    sessionId: workspaceId,
    nodeId: `conflict:${c.id}`,
    recalled: false,
  }));

  const files: LiveCodeFile[] = contentRows.map((r) => ({
    path: str(r.path),
    agentId: agentId(str(r.repo), str(r.branch)),
    changeId: str(r.changeId),
    language: fileLanguage(str(r.path)),
    original: str(r.original),
    modified: str(r.modified),
    anchors: [{ nodeId: `file:${r.path}`, line: 1 }],
  }));

  return {
    sessionId: workspaceId.slice(0, 8),
    graphName: workspaceGraphName(workspaceId),
    engine: isGraphEngineActive().engine,
    repo: repoRows[0]?.name ? str(repoRows[0].name) : null,
    agents,
    changes,
    nodes,
    edges,
    incidents,
    files,
    evidence: conflictProps.filter((c) => c.status !== "resolved").map(evidenceFor),
    mcpTools: Object.entries(TOOL_CATALOG).map(([name, t]) => ({ name, description: t.description })),
    durationMs: 0,
  };
}
