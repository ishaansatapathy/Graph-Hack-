/**
 * GraphRAG Chunking via FalkorDB only (no vector store).
 *
 * Strategy:
 *   1. Split text into overlapping chunks (e.g. 400 tokens ≈ 1600 chars).
 *   2. Store each chunk as a (:Chunk) node with text + metadata.
 *   3. Link chunks with (:Chunk)-[:NEXT]->(:Chunk) for sequence.
 *   4. Link source nodes: (:File)-[:HAS_CHUNK]->(:Chunk), etc.
 *   5. Retrieval: substring match on chunk.text via Cypher CONTAINS.
 *
 * This gives keyword-searchable, graph-traversable chunks —
 * the "vectorless RAG" approach using only FalkorDB.
 */

import crypto from "node:crypto";

import { graphRead, graphWrite } from "./falkordb";

const CHUNK_SIZE = 1600;   // chars ≈ 400 tokens
const CHUNK_OVERLAP = 200; // chars overlap between adjacent chunks

// ── Chunking ────────────────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 20);
}

// ── Upsert chunks for a source (file, commit message, issue, slack message) ──

export type ChunkSource = {
  type: "File" | "Commit" | "Issue" | "SlackMessage" | "Discussion";
  /** The FalkorDB property used to match the source node, e.g. path, sha, key, ts */
  keyProp: string;
  keyValue: string;
  /** Human-readable label for the chunk (e.g. file path) */
  label: string;
};

export async function upsertChunks(
  workspaceId: string,
  source: ChunkSource,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);
  let prevChunkId: string | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = crypto
      .createHash("sha1")
      .update(`${workspaceId}:${source.type}:${source.keyValue}:${i}`)
      .digest("hex")
      .slice(0, 16);

    const chunkText_ = chunks[i]!.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    // Upsert the Chunk node
    await graphWrite(
      workspaceId,
      `MERGE (ch:Chunk {chunkId: $chunkId})
       SET ch.text = $text, ch.index = $index,
           ch.sourceType = $sourceType, ch.sourceKey = $sourceKey,
           ch.label = $label`,
      {
        chunkId,
        text: chunkText_.slice(0, 2000),
        index: i,
        sourceType: source.type,
        sourceKey: source.keyValue,
        label: source.label,
      },
    );

    // Link to source node
    await graphWrite(
      workspaceId,
      `MATCH (src:${source.type} {${source.keyProp}: $keyValue}), (ch:Chunk {chunkId: $chunkId})
       MERGE (src)-[:HAS_CHUNK]->(ch)`,
      { keyValue: source.keyValue, chunkId },
    );

    // Chain chunks sequentially
    if (prevChunkId) {
      await graphWrite(
        workspaceId,
        `MATCH (prev:Chunk {chunkId: $prevId}), (ch:Chunk {chunkId: $chunkId})
         MERGE (prev)-[:NEXT]->(ch)`,
        { prevId: prevChunkId, chunkId },
      );
    }

    prevChunkId = chunkId;
  }

  return chunks.length;
}

// ── Chunk retrieval (keyword search via Cypher CONTAINS) ─────────────────────

export type ChunkHit = {
  chunkId: string;
  text: string;
  sourceType: string;
  sourceKey: string;
  label: string;
  index: number;
};

export async function searchChunks(
  workspaceId: string,
  keywords: string[],
  limit = 8,
): Promise<ChunkHit[]> {
  if (keywords.length === 0) return [];

  const hits: ChunkHit[] = [];
  const seen = new Set<string>();

  for (const kw of keywords.slice(0, 5)) {
    const rows = await graphRead(
      workspaceId,
      `MATCH (ch:Chunk)
       WHERE toLower(ch.text) CONTAINS $kw
       RETURN ch.chunkId AS chunkId, ch.text AS text, ch.sourceType AS sourceType,
              ch.sourceKey AS sourceKey, ch.label AS label, ch.index AS index
       LIMIT $limit`,
      { kw: kw.toLowerCase(), limit },
    );

    for (const r of rows) {
      const id = String(r.chunkId);
      if (!seen.has(id)) {
        seen.add(id);
        hits.push({
          chunkId: id,
          text: String(r.text),
          sourceType: String(r.sourceType),
          sourceKey: String(r.sourceKey),
          label: String(r.label),
          index: Number(r.index),
        });
      }
    }
  }

  return hits.slice(0, limit);
}

// ── Format chunk hits as RAG context string ──────────────────────────────────

export function formatChunkContext(hits: ChunkHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .map(
      (h, i) =>
        `### Chunk ${i + 1} [${h.sourceType}] ${h.label} (chunk ${h.index})\n${h.text}`,
    )
    .join("\n\n");
}
