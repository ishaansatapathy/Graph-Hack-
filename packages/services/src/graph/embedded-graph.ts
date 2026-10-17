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
    this.seedDefaultEnterpriseScenario();
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

  public seedDefaultEnterpriseScenario() {
    this.clear();

    const repo = this.addNode(["Repository"], {
      name: "stackfox/payments-api",
      defaultBranch: "main",
      language: "TypeScript",
      visibility: "private",
    });

    const fileToken = this.addNode(["File"], { path: "src/auth/token-service.ts", language: "ts" });
    const fileAuth = this.addNode(["File"], { path: "src/routes/auth.ts", language: "ts" });
    const fileCheckout = this.addNode(["File"], { path: "src/routes/checkout.ts", language: "ts" });
    const fileTest = this.addNode(["File"], { path: "tests/token.test.ts", language: "ts" });

    this.addEdge(repo.id, fileToken.id, "CONTAINS");
    this.addEdge(repo.id, fileAuth.id, "CONTAINS");
    this.addEdge(repo.id, fileCheckout.id, "CONTAINS");
    this.addEdge(repo.id, fileTest.id, "CONTAINS");

    const fnVerify = this.addNode(["Function"], {
      name: "verifyToken",
      file: "src/auth/token-service.ts",
      signature: "verifyToken(token: string): Claims",
      lineStart: 42,
    });
    const fnIssue = this.addNode(["Function"], {
      name: "issueRefreshToken",
      file: "src/auth/token-service.ts",
      signature: "issueRefreshToken(userId: string): string",
      lineStart: 89,
    });
    const fnRefresh = this.addNode(["Function"], {
      name: "refreshSession",
      file: "src/auth/token-service.ts",
      signature: "refreshSession(refresh: string): Session",
      lineStart: 134,
    });
    const fnLogin = this.addNode(["Function"], {
      name: "loginHandler",
      file: "src/routes/auth.ts",
      signature: "loginHandler(req: Request, res: Response)",
      lineStart: 25,
    });
    const fnCheckout = this.addNode(["Function"], {
      name: "checkoutHandler",
      file: "src/routes/checkout.ts",
      signature: "checkoutHandler(req: Request, res: Response)",
      lineStart: 50,
    });

    this.addEdge(fileToken.id, fnVerify.id, "DECLARES");
    this.addEdge(fileToken.id, fnIssue.id, "DECLARES");
    this.addEdge(fileToken.id, fnRefresh.id, "DECLARES");
    this.addEdge(fileAuth.id, fnLogin.id, "DECLARES");
    this.addEdge(fileCheckout.id, fnCheckout.id, "DECLARES");

    this.addEdge(fnLogin.id, fnIssue.id, "CALLS");
    this.addEdge(fnCheckout.id, fnVerify.id, "CALLS");
    this.addEdge(fnRefresh.id, fnVerify.id, "CALLS");
    this.addEdge(fnRefresh.id, fnIssue.id, "CALLS");

    const test1 = this.addNode(["Test"], { name: "test_token_expiry", status: "passing" });
    const test2 = this.addNode(["Test"], { name: "test_refresh_rotation", status: "passing" });
    this.addEdge(fileTest.id, test1.id, "DECLARES");
    this.addEdge(fileTest.id, test2.id, "DECLARES");
    this.addEdge(test1.id, fnVerify.id, "TESTS");
    this.addEdge(test2.id, fnRefresh.id, "TESTS");

    const commitA = this.addNode(["Commit"], {
      sha: "a1b2c3d",
      message: "fix(auth): enforce 15m access-token expiry AUTH-151",
      author: "priya",
      branch: "main",
    });
    const commitB = this.addNode(["Commit"], {
      sha: "d4e5f6a",
      message: "feat(auth): refresh token flow AUTH-142",
      author: "ishaan",
      branch: "feature/jwt-refresh",
    });

    this.addEdge(commitA.id, fnVerify.id, "MODIFIED");
    this.addEdge(commitB.id, fnVerify.id, "MODIFIED");
    this.addEdge(commitB.id, fnIssue.id, "MODIFIED");
    this.addEdge(commitB.id, fnRefresh.id, "MODIFIED");
    this.addEdge(commitA.id, fileToken.id, "MODIFIED");
    this.addEdge(commitB.id, fileToken.id, "MODIFIED");

    const issue1 = this.addNode(["Issue"], {
      key: "AUTH-151",
      title: "Security: access tokens must expire in 15 minutes",
      status: "In Review",
    });
    const issue2 = this.addNode(["Issue"], {
      key: "AUTH-142",
      title: "Zero-downtime refresh token migration",
      status: "In Progress",
    });
    this.addEdge(commitA.id, issue1.id, "REFERENCES");
    this.addEdge(commitB.id, issue2.id, "REFERENCES");

    const disc = this.addNode(["Discussion"], {
      channel: "#dev-security",
      author: "priya",
      text: "Do NOT drop the 15m expiry check when adding refresh tokens. Audit requirement SEC-77.",
    });
    this.addEdge(disc.id, issue1.id, "MENTIONS");
    this.addEdge(disc.id, fnVerify.id, "CONCERNS");

    const dec = this.addNode(["Decision"], {
      title: "Access tokens expire in 15 minutes",
      rationale: "Security audit SEC-77",
      status: "active",
    });
    this.addEdge(dec.id, fnVerify.id, "CONSTRAINS");
    this.addEdge(dec.id, disc.id, "DECIDED_IN");

    const conflict = this.addNode(["Conflict"], {
      id: "conflict-1",
      file: "src/auth/token-service.ts",
      baseBranch: "main",
      incomingBranch: "feature/jwt-refresh",
      status: "open",
    });
    this.addEdge(conflict.id, fnVerify.id, "AFFECTS");
    this.addEdge(conflict.id, commitA.id, "BETWEEN");
    this.addEdge(conflict.id, commitB.id, "BETWEEN");

    // Add initial search chunks
    this.addNode(["Chunk"], {
      chunkId: "chk_verify_token",
      text: "verifyToken validates the JWT signature using HMAC SHA256 and verifies that expiration does not exceed 15 minutes. It handles key rotation and revocation check.",
      label: "src/auth/token-service.ts",
      sourceType: "File",
      sourceKey: "src/auth/token-service.ts",
    });
    this.addNode(["Chunk"], {
      chunkId: "chk_refresh_token",
      text: "issueRefreshToken generates a cryptographically random 30-day token tied to tokenVersion in PostgreSQL users table. Bumping tokenVersion revokes all active refresh tokens.",
      label: "src/auth/token-service.ts",
      sourceType: "File",
      sourceKey: "src/auth/token-service.ts",
    });
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

    // 4. Node keyword search: MATCH (n:Label) WHERE toLower(...) CONTAINS $kw
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

    // 5. 1-hop neighbours: MATCH (n)-[r]-(m) WHERE id(n) = $id
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

    // 6. Explicit Conflict query
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
          shaA: c1?.properties.sha || "a1b2c3d",
          authorA: c1?.properties.author || "priya",
          msgA: c1?.properties.message || "fix(auth): enforce 15m access-token expiry",
          shaB: c2?.properties.sha || "d4e5f6a",
          authorB: c2?.properties.author || "ishaan",
          msgB: c2?.properties.message || "feat(auth): refresh token flow",
          status: c.properties.status || "open",
        };
      });
    }

    // 7. Implicit Conflict query
    if (/MATCH \(f:File\)<-mod/i.test(q) || /WHERE cA\.branch <> cB\.branch/i.test(q)) {
      return [
        {
          file: "src/auth/token-service.ts",
          shaA: "a1b2c3d",
          authorA: "priya",
          msgA: "fix(auth): enforce 15m access-token expiry AUTH-151",
          branchA: "main",
          shaB: "d4e5f6a",
          authorB: "ishaan",
          msgB: "feat(auth): refresh token flow AUTH-142",
          branchB: "feature/jwt-refresh",
        },
      ];
    }

    // 8. Chunk text search: MATCH (ch:Chunk) WHERE toLower(ch.text) CONTAINS $kw
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

    // 9. Generic MATCH (n:Label) RETURN n...
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

    // 10. Generic MATCH ()-[r]->() or general return
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
