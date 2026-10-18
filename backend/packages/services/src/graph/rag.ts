/**
 * GraphRAG: graph-retrieval augmented generation.
 *
 * Retrieval is workspace-scoped and bounded: a small number of label lookups,
 * relevance ranking, then capped relationship expansion.
 */

import { graphRead } from "./falkordb";

// ---------------------------------------------------------------------------
// Keep identifiers intact while also matching their camel-case components.
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
  const terms = question.match(/[A-Za-z0-9_$./-]+/g) ?? [];
  const expanded = terms.flatMap((term) => [
    term.toLowerCase(),
    ...term.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9_$]+/),
  ]);
  return [...new Set(expanded)]
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
    .slice(0, 12);
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
  SlackMessage: ["text", "channel", "user"],
  SlackChannel: ["name"],
  Person: ["name", "email"],
};

// ---------------------------------------------------------------------------
// Seed nodes: find nodes whose string props contain any keyword
// ---------------------------------------------------------------------------

type SeedNode = {
  id: string;
  label: string;
  props: Record<string, unknown>;
  score: number;
  matchedTerms: string[];
};

function scoreSeed(props: Record<string, unknown>, fields: string[], keywords: string[]) {
  const matched = new Set<string>();
  let score = 0;
  for (const keyword of keywords) {
    for (const field of fields) {
      const value = String(props[field] ?? "").toLowerCase();
      if (value === keyword) {
        score += 5;
        matched.add(keyword);
      } else if (value.includes(keyword)) {
        score += keyword.length >= 5 ? 2 : 1;
        matched.add(keyword);
      }
    }
  }
  return { score, matchedTerms: [...matched] };
}

async function findSeedNodes(workspaceId: string, keywords: string[]): Promise<SeedNode[]> {
  if (keywords.length === 0) return [];

  const labels = Object.entries(LABEL_PROPS);
  const candidates: SeedNode[] = [];
  // Keep graph pressure predictable as the supported node catalog grows.
  for (let offset = 0; offset < labels.length; offset += 3) {
    const batch = labels.slice(offset, offset + 3);
    const results = await Promise.all(batch.map(async ([label, fields]) => {
      const params: Record<string, string> = {};
      const predicates: string[] = [];
      const scoreTerms: string[] = [];
      for (const [fieldIndex, field] of fields.entries()) {
        for (const [termIndex, keyword] of keywords.entries()) {
          const key = `k${fieldIndex}_${termIndex}`;
          params[key] = keyword;
          const value = `toLower(toString(n.${field}))`;
          predicates.push(`${value} CONTAINS $${key}`);
          scoreTerms.push(`(CASE WHEN ${value} = $${key} THEN 5 WHEN ${value} CONTAINS $${key} THEN 2 ELSE 0 END)`);
        }
      }
      try {
        const rows = await graphRead(
          workspaceId,
          `MATCH (n:${label}) WHERE ${predicates.join(" OR ")}
           RETURN id(n) AS id, labels(n)[0] AS label, properties(n) AS props,
                  (${scoreTerms.join(" + ")}) AS retrievalScore
           ORDER BY retrievalScore DESC
           LIMIT 25`,
          params,
        );
        return rows.map((row) => {
          const props = (row.props ?? {}) as Record<string, unknown>;
          const ranking = scoreSeed(props, fields, keywords);
          return {
            id: String(row.id),
            label: String(row.label),
            props,
            score: ranking.score,
            matchedTerms: ranking.matchedTerms,
          };
        });
      } catch {
        // A missing optional label/property should not fail retrieval for other labels.
        return [];
      }
    }));
    candidates.push(...results.flat());
  }

  const deduped = new Map<string, SeedNode>();
  for (const candidate of candidates) {
    const previous = deduped.get(candidate.id);
    if (!previous || candidate.score > previous.score) deduped.set(candidate.id, candidate);
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || b.matchedTerms.length - a.matchedTerms.length)
    .slice(0, 8);
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
     RETURN type(r) AS relType, labels(nb)[0] AS nbLabel, properties(nb) AS nbProps
     LIMIT 20`,
    { id: Number(nodeId) },
  );
  const inRows = await graphRead(
    workspaceId,
    `MATCH (n)<-[r]-(nb) WHERE id(n) = $id
     RETURN type(r) AS relType, labels(nb)[0] AS nbLabel, properties(nb) AS nbProps
     LIMIT 20`,
    { id: Number(nodeId) },
  );
  const rows = [
    ...outRows.map((r) => ({ relType: String(r.relType), nbLabel: String(r.nbLabel), nbProps: (r.nbProps ?? {}) as Record<string, unknown>, direction: "out" as const })),
    ...inRows.map((r) => ({ relType: String(r.relType), nbLabel: String(r.nbLabel), nbProps: (r.nbProps ?? {}) as Record<string, unknown>, direction: "in" as const })),
  ];
  const relationshipPriority: Record<string, number> = {
    CALLS: 5,
    TESTS: 5,
    REFERENCES: 4,
    MODIFIED: 4,
    CONSTRAINS: 3,
    HAS_CHUNK: 3,
    NEXT: 0,
  };
  const priority = (type: string) => relationshipPriority[type] ?? 1;
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.direction}:${row.relType}:${row.nbLabel}:${formatProps(row.nbProps)}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => priority(b.relType) - priority(a.relType));
}

// ---------------------------------------------------------------------------
// Format a property bag for display
// ---------------------------------------------------------------------------

function formatProps(props: Record<string, unknown>): string {
  const interesting = ["name", "key", "path", "sha", "message", "title", "text", "status", "author", "branch", "signature", "rationale", "channel"];
  return interesting
    .filter((k) => props[k] != null && String(props[k]).trim() !== "")
    .map((k) => `${k}: ${String(props[k]).slice(0, 500)}`)
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
      answer: `No graph evidence matched [${keywords.join(", ")}]. Try a specific symbol, file path, issue key, commit, or discussion term.`,
      cypher: cypherLog,
      evidenceCount: 0,
    };
  }

  // Step 2: expand each seed
  const lines: string[] = [`## Graph evidence for: "${question}"\n`];
  const maxContextChars = 14_000;
  let contextChars = lines[0]!.length;
  let truncated = false;
  const addEvidenceLine = (line: string) => {
    if (contextChars + line.length + 1 > maxContextChars) return false;
    lines.push(line);
    contextChars += line.length + 1;
    return true;
  };
  let evidenceCount = 0;

  for (const seed of seeds) {
    const primary = formatProps(seed.props);
    if (!addEvidenceLine(`### [${seed.label}] ${primary || seed.id} (relevance ${seed.score}; matched: ${seed.matchedTerms.join(", ")})`)) {
      truncated = true;
      break;
    }

    const neighbours = await expandNode(workspaceId, seed.id);
    cypherLog.push(`// 1-hop expansion for ${seed.label}#${seed.id} → ${neighbours.length} neighbours`);

    if (neighbours.length === 0) {
      addEvidenceLine("  _(no relationships found)_");
    } else {
      for (const nb of neighbours.slice(0, 6)) {
        const dir = nb.direction === "out" ? "→" : "←";
        const nbFmt = formatProps(nb.nbProps);
        if (!addEvidenceLine(`  ${dir} [${nb.relType}] [${nb.nbLabel}] ${nbFmt}`)) {
          truncated = true;
          break;
        }
        evidenceCount++;
      }
    }
    if (truncated) break;
    addEvidenceLine("");
  }
  if (truncated) lines.push("\n[Graph evidence truncated to fit the context budget.]");

  // Step 3: Cypher for conflicts if the question seems conflict-related
  if (/conflict|merge|branch|resolv/i.test(question)) {
    const conflictCypher = `MATCH (c:Conflict)-[:AFFECTS]->(f:Function)<-[:MODIFIED]-(cm:Commit)
OPTIONAL MATCH (f)<-[:CONSTRAINS]-(dec:Decision)
RETURN c.id, c.file, f.name, collect(cm.message) AS commits, dec.title AS decision LIMIT 10`;
    cypherLog.push(conflictCypher);
    try {
      const rows = await graphRead(workspaceId, conflictCypher);
      if (rows.length > 0) {
        addEvidenceLine("### Conflict analysis from graph");
        for (const r of rows) {
          addEvidenceLine(`- Conflict in **${r["c.file"]}** on function **${r["f.name"]}**`);
          addEvidenceLine(`  Commits: ${(r["commits"] as string[]).join("; ")}`);
          if (r["decision"]) addEvidenceLine(`  Decision: ${r["decision"]}`);
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
