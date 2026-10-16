/**
 * GraphRAG: graph-retrieval augmented generation.
 *
 * Strategy (no external LLM required for hackathon):
 *   1. Extract keywords from the question.
 *   2. Run multiple focused Cypher queries against FalkorDB to collect evidence nodes.
 *   3. Traverse 1-hop neighbours for rich context.
 *   4. Format evidence as a structured answer with references.
 */

import { graphRead } from "./falkordb";

// ---------------------------------------------------------------------------
// Keyword extraction — simple but effective for code-graph questions.
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","should","could","may","might",
  "what","which","who","whom","whose","where","when","why","how","about",
  "around","into","onto","from","with","within","without","through","after",
  "before","between","among","and","or","but","not","for","on","in","at",
  "to","of","by","as","it","its","this","that","these","those","there",
  "here","show","me","give","find","tell","list","get","all","any","each",
  "function","method","class","file","code","repo","repository","graph",
  "node","edge","relationship","related","connected","link",
]);

function extractKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[\s,.:;?!()\[\]{}'"`]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Node categories for targeted lookup
// ---------------------------------------------------------------------------

const LABEL_PROPS: Record<string, string[]> = {
  Function:   ["name", "signature", "file"],
  File:       ["path"],
  Commit:     ["sha", "message", "author", "branch"],
  Issue:      ["key", "title", "status"],
  Discussion: ["text", "channel", "author"],
  Decision:   ["title", "rationale", "status"],
  Conflict:   ["id", "file", "baseBranch", "incomingBranch"],
  Test:       ["name", "status"],
  Repository: ["name"],
};

// ---------------------------------------------------------------------------
// Seed nodes: find nodes whose string props contain any keyword
// ---------------------------------------------------------------------------

async function findSeedNodes(workspaceId: string, keywords: string[]) {
  if (keywords.length === 0) return [];

  const results: Array<{ id: string; label: string; props: Record<string, unknown> }> = [];
  const seen = new Set<string>();

  for (const [label, props] of Object.entries(LABEL_PROPS)) {
    for (const kw of keywords) {
      for (const prop of props) {
        const cypher = `
          MATCH (n:${label})
          WHERE toLower(toString(n.${prop})) CONTAINS $kw
          RETURN id(n) AS id, labels(n)[0] AS label, properties(n) AS props
          LIMIT 5
        `;
        try {
          const rows = await graphRead(workspaceId, cypher, { kw });
          for (const r of rows) {
            const idStr = String(r.id);
            if (!seen.has(idStr)) {
              seen.add(idStr);
              results.push({ id: idStr, label: String(r.label), props: (r.props ?? {}) as Record<string, unknown> });
            }
          }
        } catch {
          // silently skip unknown label
        }
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1-hop expansion: get neighbours + edge types for each seed node
// ---------------------------------------------------------------------------

type NeighbourRow = {
  relType: string;
  nbLabel: string;
  nbProps: Record<string, unknown>;
  direction: "out" | "in";
};

async function expandNode(workspaceId: string, nodeId: string): Promise<NeighbourRow[]> {
  const outRows = await graphRead(
    workspaceId,
    `MATCH (n)-[r]->(nb) WHERE id(n) = $id
     RETURN type(r) AS relType, labels(nb)[0] AS nbLabel, properties(nb) AS nbProps`,
    { id: parseInt(nodeId, 10) as unknown as string },
  );
  const inRows = await graphRead(
    workspaceId,
    `MATCH (n)<-[r]-(nb) WHERE id(n) = $id
     RETURN type(r) AS relType, labels(nb)[0] AS nbLabel, properties(nb) AS nbProps`,
    { id: parseInt(nodeId, 10) as unknown as string },
  );
  return [
    ...outRows.map((r) => ({ relType: String(r.relType), nbLabel: String(r.nbLabel), nbProps: (r.nbProps ?? {}) as Record<string, unknown>, direction: "out" as const })),
    ...inRows.map((r) => ({ relType: String(r.relType), nbLabel: String(r.nbLabel), nbProps: (r.nbProps ?? {}) as Record<string, unknown>, direction: "in" as const })),
  ];
}

// ---------------------------------------------------------------------------
// Format a property bag for display
// ---------------------------------------------------------------------------

function formatProps(props: Record<string, unknown>): string {
  const interesting = ["name", "key", "path", "sha", "message", "title", "text", "status", "author", "branch", "signature", "rationale", "channel"];
  return interesting
    .filter((k) => props[k] != null && String(props[k]).trim() !== "")
    .map((k) => `${k}: ${String(props[k])}`)
    .join(" | ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RagResult = {
  answer: string;
  cypher: string[];
  evidenceCount: number;
};

export async function graphRagAnswer(workspaceId: string, question: string): Promise<RagResult> {
  const keywords = extractKeywords(question);
  const cypherLog: string[] = [];

  if (keywords.length === 0) {
    return {
      answer: "Could not extract meaningful keywords from your question. Try naming a function, file, issue key, or commit SHA.",
      cypher: [],
      evidenceCount: 0,
    };
  }

  // Step 1: find seeds
  const seeds = await findSeedNodes(workspaceId, keywords);
  cypherLog.push(`// Seed search: keywords=[${keywords.join(", ")}] → ${seeds.length} seed nodes`);

  if (seeds.length === 0) {
    return {
      answer: `No graph nodes matched keywords [${keywords.join(", ")}]. Try seeding the demo graph or pushing a repository commit to populate the graph.`,
      cypher: cypherLog,
      evidenceCount: 0,
    };
  }

  // Step 2: expand each seed
  const lines: string[] = [`## Graph evidence for: "${question}"\n`];
  let evidenceCount = 0;

  for (const seed of seeds.slice(0, 6)) {
    const primary = formatProps(seed.props);
    lines.push(`### [${seed.label}] ${primary || seed.id}`);

    const neighbours = await expandNode(workspaceId, seed.id);
    cypherLog.push(`// 1-hop expansion for ${seed.label}#${seed.id} → ${neighbours.length} neighbours`);

    if (neighbours.length === 0) {
      lines.push("  _(no relationships found)_");
    } else {
      for (const nb of neighbours.slice(0, 8)) {
        const dir = nb.direction === "out" ? "→" : "←";
        const nbFmt = formatProps(nb.nbProps);
        lines.push(`  ${dir} [${nb.relType}] [${nb.nbLabel}] ${nbFmt}`);
        evidenceCount++;
      }
    }
    lines.push("");
  }

  // Step 3: Cypher for conflicts if the question seems conflict-related
  if (/conflict|merge|branch|resolv/i.test(question)) {
    const conflictCypher = `MATCH (c:Conflict)-[:AFFECTS]->(f:Function)<-[:MODIFIED]-(cm:Commit)
OPTIONAL MATCH (f)<-[:CONSTRAINS]-(dec:Decision)
RETURN c.id, c.file, f.name, collect(cm.message) AS commits, dec.title AS decision LIMIT 10`;
    cypherLog.push(conflictCypher);
    try {
      const rows = await graphRead(workspaceId, conflictCypher);
      if (rows.length > 0) {
        lines.push("### Conflict analysis from FalkorDB");
        for (const r of rows) {
          lines.push(`- Conflict in **${r["c.file"]}** on function **${r["f.name"]}**`);
          lines.push(`  Commits: ${(r["commits"] as string[]).join("; ")}`);
          if (r["decision"]) lines.push(`  Decision: ${r["decision"]}`);
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    answer: lines.join("\n"),
    cypher: cypherLog,
    evidenceCount: seeds.length + evidenceCount,
  };
}
