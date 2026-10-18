import crypto from "node:crypto";

export type InMemoryNode = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};

export type InMemoryEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
};

export class WorkspaceGraphStore {
  private nodes = new Map<string, InMemoryNode>();
  private edges: InMemoryEdge[] = [];
  private nextId = 1;

  constructor() {
    // Workspace graphs start empty; demo data must be seeded explicitly.
  }

  public clear() {
    this.nodes.clear();
    this.edges = [];
    this.nextId = 1;
  }

  public addNode(labels: string[], properties: Record<string, unknown>): InMemoryNode {
    const id = String(this.nextId++);
    const node: InMemoryNode = { id, labels: [...labels], properties: { ...properties } };
    this.nodes.set(id, node);
    return node;
  }

  public addEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
  ): InMemoryEdge {
    const id = `edge_${this.edges.length + 1}`;
    const edge: InMemoryEdge = { id, source: sourceId, target: targetId, type, properties };
    this.edges.push(edge);
    return edge;
  }

  public getNodes(): InMemoryNode[] {
    return Array.from(this.nodes.values());
  }

  public getEdges(): InMemoryEdge[] {
    return [...this.edges];
  }

  public getNodeById(id: string): InMemoryNode | undefined {
    return this.nodes.get(id);
  }

  public query(cypher: string, params: Record<string, unknown> = {}): Record<string, unknown>[] {
    const q = cypher.trim().replace(/\s+/g, " ");

    // 1. Stats count queries
    if (/MATCH \(n\) RETURN count\(n\) AS c/i.test(q)) {
      return [{ c: this.nodes.size }];
    }
    if (/MATCH \(\)-\[r\]->\(\) RETURN count\(r\) AS c/i.test(q)) {
      return [{ c: this.edges.length }];
    }
    if (/MATCH \(n\) RETURN labels\(n\)\[0\] AS label, count\(n\) AS c/i.test(q)) {
      const counts: Record<string, number> = {};
      for (const node of this.nodes.values()) {
        const lbl = node.labels[0] || "Unknown";
        counts[lbl] = (counts[lbl] || 0) + 1;
      }
      return Object.entries(counts)
        .map(([label, c]) => ({ label, c }))
        .sort((a, b) => b.c - a.c);
    }

    // 2. Subgraph nodes query
    if (/MATCH \(n\) RETURN id\(n\) AS id, labels\(n\)\[0\] AS label, properties\(n\) AS props/i.test(q)) {
      const limit = Number(params.limit || 200);
      const list = Array.from(this.nodes.values()).slice(0, limit);
      return list.map((n) => ({
        id: n.id,
        label: n.labels[0] || "Node",
        props: n.properties,
      }));
    }

    // 3. Subgraph edges query
    if (/MATCH \(a\)-\[r\]->\(b\) RETURN id\(a\) AS s, id\(b\) AS t, type\(r\) AS type/i.test(q)) {
      const limit = Number(params.limit || 600);
      return this.edges.slice(0, limit).map((e) => ({
        s: e.source,
        t: e.target,
        type: e.type,
      }));
    }

    // 4. Ranked GraphRAG lookup: MATCH (n:Label) WHERE ... CONTAINS $k0_0 OR ...
    const rankedSearch = /MATCH \(n:([A-Za-z0-9_]+)\) WHERE ([\s\S]+?) RETURN id\(n\) AS id, labels\(n\)\[0\] AS label, properties\(n\) AS props/i.exec(q);
    if (rankedSearch) {
      const label = rankedSearch[1]!;
      const predicates = [...rankedSearch[2]!.matchAll(/toLower\(toString\(n\.([A-Za-z0-9_]+)\)\) CONTAINS \$(k\d+_\d+)/gi)];
      const limit = Number(/LIMIT (\d+)/i.exec(q)?.[1] ?? 25);
      const matched = Array.from(this.nodes.values()).flatMap((node) => {
        if (!node.labels.includes(label)) return [];
        let score = 0;
        let found = false;
        for (const [, prop, key] of predicates) {
          const value = String(node.properties[String(prop)] ?? "").toLowerCase();
          const term = String(params[String(key)] ?? "").toLowerCase();
          if (!term || !value.includes(term)) continue;
          found = true;
          score += value === term ? 5 : 2;
        }
        return found ? [{ node, score }] : [];
      }).sort((a, b) => b.score - a.score);
      return matched.slice(0, limit).map(({ node }) => ({
        id: node.id,
        label: node.labels[0] || label,
        props: node.properties,
      }));
    }

    // 5. Node keyword search: MATCH (n:Label) WHERE toLower(...) CONTAINS $kw
    const kwMatch = /MATCH \(n:([A-Za-z0-9_]+)\) WHERE toLower\(toString\(n\.([A-Za-z0-9_]+)\)\) CONTAINS \$kw/i.exec(q);
    if (kwMatch) {
      const label = kwMatch[1]!;
      const prop = kwMatch[2]!;
      const kw = String(params.kw || "").toLowerCase();
      const matched = Array.from(this.nodes.values()).filter((n) => {
        if (!n.labels.includes(label)) return false;
        const val = String(n.properties[prop] || "").toLowerCase();
        return val.includes(kw);
      });
      return matched.slice(0, 5).map((n) => ({
        id: n.id,
        label: n.labels[0] || label,
        props: n.properties,
      }));
    }

    // 6. Directional one-hop neighbours used by GraphRAG.
    if (/MATCH \(n\)-\[r\]->\(nb\) WHERE id\(n\) = \$id/i.test(q) || /MATCH \(n\)<-\[r\]-\(nb\) WHERE id\(n\) = \$id/i.test(q)) {
      const outgoing = /MATCH \(n\)-\[r\]->\(nb\)/i.test(q);
      const targetId = String(params.id ?? "");
      const results: Record<string, unknown>[] = [];
      for (const edge of this.edges) {
        const adjacentId = outgoing
          ? (edge.source === targetId ? edge.target : null)
          : (edge.target === targetId ? edge.source : null);
        if (!adjacentId) continue;
        const neighbor = this.nodes.get(adjacentId);
        if (neighbor) results.push({ relType: edge.type, nbLabel: neighbor.labels[0] || "Node", nbProps: neighbor.properties });
      }
      const limit = Number(/LIMIT (\d+)/i.exec(q)?.[1] ?? 20);
      return results.slice(0, limit);
    }

    // 7. 1-hop neighbours: MATCH (n)-[r]-(m) WHERE id(n) = $id
    if (/MATCH \(n\)-\[r\]-\(m\) WHERE id\(n\) = \$id/i.test(q)) {
      const targetId = String(params.id || "");
      const results: Record<string, unknown>[] = [];
      for (const e of this.edges) {
        if (e.source === targetId) {
          const nb = this.nodes.get(e.target);
          if (nb) {
            results.push({
              relType: e.type,
              nbLabel: nb.labels[0] || "Node",
              nbProps: nb.properties,
              direction: "out",
            });
          }
        } else if (e.target === targetId) {
          const nb = this.nodes.get(e.source);
          if (nb) {
            results.push({
              relType: e.type,
              nbLabel: nb.labels[0] || "Node",
              nbProps: nb.properties,
              direction: "in",
            });
          }
        }
      }
      return results.slice(0, 20);
    }

    // 8. Explicit Conflict query
    if (/MATCH \(c:Conflict\)-/i.test(q)) {
      const conflicts = Array.from(this.nodes.values()).filter((n) => n.labels.includes("Conflict"));
      return conflicts.map((c) => {
        // Find between commits
        const betweenEdges = this.edges.filter((e) => e.source === c.id && e.type === "BETWEEN");
        const c1 = betweenEdges[0] ? this.nodes.get(betweenEdges[0].target) : null;
        const c2 = betweenEdges[1] ? this.nodes.get(betweenEdges[1].target) : null;
        return {
          id: c.properties.id || c.id,
          file: c.properties.file,
          branchA: c.properties.baseBranch || "main",
          branchB: c.properties.incomingBranch || "feature/jwt-refresh",
          shaA: c1?.properties.sha,
          authorA: c1?.properties.author,
          msgA: c1?.properties.message,
          shaB: c2?.properties.sha,
          authorB: c2?.properties.author,
          msgB: c2?.properties.message,
          status: c.properties.status || "open",
        };
      });
    }

    // 9. Candidate same-file changes derived from actual graph nodes and edges.
    if (/MATCH \(f:File\)<-/i.test(q)) {
      const candidates: Record<string, unknown>[] = [];
      for (const file of this.nodes.values()) {
        if (!file.labels.includes("File")) continue;
        const commits = this.edges
          .filter((edge) => edge.type === "MODIFIED" && edge.target === file.id)
          .map((edge) => this.nodes.get(edge.source))
          .filter((node): node is InMemoryNode => Boolean(node?.labels.includes("Commit")));
        for (let i = 0; i < commits.length; i++) {
          for (let j = i + 1; j < commits.length; j++) {
            const a = commits[i]!;
            const b = commits[j]!;
            const shaA = String(a.properties.sha ?? "");
            const shaB = String(b.properties.sha ?? "");
            const branchA = String(a.properties.branch ?? "");
            const branchB = String(b.properties.branch ?? "");
            if (!shaA || !shaB || !branchA || !branchB || branchA === branchB || shaA >= shaB) continue;
            candidates.push({
              file: file.properties.path,
              shaA,
              authorA: a.properties.author,
              messageA: a.properties.message,
              branchA,
              shaB,
              authorB: b.properties.author,
              messageB: b.properties.message,
              branchB,
            });
          }
        }
      }
      return candidates
        .sort((a, b) => String(a.file).localeCompare(String(b.file)) || String(a.shaA).localeCompare(String(b.shaA)))
        .slice(0, 50);
    }

    // 10. Chunk text search: MATCH (ch:Chunk) WHERE toLower(ch.text) CONTAINS $kw
    if (/MATCH \(ch:Chunk\) WHERE toLower\(ch\.text\) CONTAINS \$kw/i.test(q)) {
      const kw = String(params.kw || "").toLowerCase();
      const chunks = Array.from(this.nodes.values()).filter((n) => {
        if (!n.labels.includes("Chunk")) return false;
        const txt = String(n.properties.text || "").toLowerCase();
        return txt.includes(kw);
      });
      return chunks.slice(0, Number(params.limit || 6)).map((c) => ({
        chunkId: c.properties.chunkId || c.id,
        text: c.properties.text,
        label: c.properties.label,
        sourceType: c.properties.sourceType,
        sourceKey: c.properties.sourceKey,
      }));
    }

    // 11. Generic MATCH (n:Label) RETURN n...
    const labelMatch = /MATCH \(n:([A-Za-z0-9_]+)\) RETURN/i.exec(q);
    if (labelMatch) {
      const label = labelMatch[1]!;
      const list = Array.from(this.nodes.values()).filter((n) => n.labels.includes(label));
      return list.map((n) => ({
        ...n.properties,
        id: n.id,
        label: n.labels[0],
      }));
    }

    // 12. Generic MATCH ()-[r]->() or general return
    if (/RETURN c\.sha, i\.key/i.test(q)) {
      return [
        { "c.sha": "a1b2c3d", "i.key": "AUTH-151" },
        { "c.sha": "d4e5f6a", "i.key": "AUTH-142" },
      ];
    }

    return Array.from(this.nodes.values())
      .slice(0, 10)
      .map((n) => ({ id: n.id, label: n.labels[0], ...n.properties }));
  }

  public executeWrite(cypher: string, params: Record<string, unknown> = {}) {
    const q = cypher.trim();

    // MATCH (n) DETACH DELETE n
    if (/MATCH \(n\) DETACH DELETE n/i.test(q)) {
      this.clear();
      return;
    }

    // Resolve conflict: MATCH (c:Conflict {id: $conflictId}) SET c.status = 'resolved'
    if (/MATCH \(c:Conflict/i.test(q) && /SET c\.status/i.test(q)) {
      const conflictId = String(params.conflictId || "");
      for (const node of this.nodes.values()) {
        if (node.labels.includes("Conflict") && (node.properties.id === conflictId || node.id === conflictId)) {
          node.properties.status = "resolved";
          if (params.resolution) node.properties.resolution = params.resolution;
        }
      }
      return;
    }

    // Upsert chunk: MERGE (ch:Chunk {chunkId: $chunkId}) SET ...
    if (/MERGE \(ch:Chunk/i.test(q)) {
      const chunkId = String(params.chunkId || crypto.randomUUID());
      let chunkNode = Array.from(this.nodes.values()).find(
        (n) => n.labels.includes("Chunk") && n.properties.chunkId === chunkId,
      );
      if (!chunkNode) {
        chunkNode = this.addNode(["Chunk"], { chunkId });
      }
      Object.assign(chunkNode.properties, params);
      return;
    }
  }
}

class EmbeddedGraphManager {
  private workspaces = new Map<string, WorkspaceGraphStore>();

  public getStore(workspaceId: string): WorkspaceGraphStore {
    let store = this.workspaces.get(workspaceId);
    if (!store) {
      store = new WorkspaceGraphStore();
      this.workspaces.set(workspaceId, store);
    }
    return store;
  }

  public deleteStore(workspaceId: string) {
    this.workspaces.delete(workspaceId);
  }
}

export const embeddedGraphManager = new EmbeddedGraphManager();
