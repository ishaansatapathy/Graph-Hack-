/**
 * AI-powered conflict resolver.
 *
 * Given a ConflictRecord (from detect.ts), it:
 *   1. Fetches graph context: the conflicting function's callers, decisions, discussions
 *   2. Calls the AI router (gpt-4o for conflict resolution — always complex)
 *   3. Returns a suggested resolution with reasoning
 *   4. Marks the conflict as resolved in FalkorDB
 */

import { completeWithGraphContext, type Message } from "../ai/router";
import { graphRead } from "../graph/falkordb";
import { markConflictResolved, type ConflictRecord } from "./detect";

// ── Build graph context for a conflict ──────────────────────────────────────

async function buildConflictContext(workspaceId: string, conflict: ConflictRecord): Promise<string> {
  const lines: string[] = [];

  // Decisions that constrain the conflicted file
  const decisions = await graphRead(
    workspaceId,
    `MATCH (dec:Decision)-[:CONSTRAINS]->(f:Function)
     WHERE f.file = $file OR f.file CONTAINS $fileBase
     RETURN dec.title AS title, dec.rationale AS rationale, dec.status AS status
     LIMIT 5`,
    {
      file: conflict.file,
      fileBase: conflict.file.split("/").pop() ?? conflict.file,
    },
  );
  if (decisions.length > 0) {
    lines.push("### Active decisions affecting this file:");
    for (const d of decisions) {
      lines.push(`- **${d.title}** (${d.status}): ${d.rationale}`);
    }
  }

  // Discussions mentioning the file
  const discussions = await graphRead(
    workspaceId,
    `MATCH (d:Discussion)-[:CONCERNS]->(f:Function)
     WHERE f.file = $file OR f.file CONTAINS $fileBase
     RETURN d.author AS author, d.text AS text, d.channel AS channel
     LIMIT 5`,
    {
      file: conflict.file,
      fileBase: conflict.file.split("/").pop() ?? conflict.file,
    },
  );
  if (discussions.length > 0) {
    lines.push("\n### Team discussions:");
    for (const d of discussions) {
      lines.push(`- [${d.channel}] ${d.author}: "${d.text}"`);
    }
  }

  // Other issues the conflicting commits reference
  const issues = await graphRead(
    workspaceId,
    `MATCH (c:Commit {sha: $shaA})-[:REFERENCES]->(i:Issue)
     RETURN i.key AS key, i.title AS title, i.status AS status`,
    { shaA: conflict.commitShaA },
  );
  const issuesB = await graphRead(
    workspaceId,
    `MATCH (c:Commit {sha: $shaB})-[:REFERENCES]->(i:Issue)
     RETURN i.key AS key, i.title AS title, i.status AS status`,
    { shaB: conflict.commitShaB },
  );
  const allIssues = [...issues, ...issuesB];
  if (allIssues.length > 0) {
    lines.push("\n### Referenced issues:");
    for (const i of allIssues) {
      lines.push(`- ${i.key}: ${i.title} (${i.status})`);
    }
  }

  return lines.join("\n") || "No additional graph context found.";
}

// ── Public resolver ──────────────────────────────────────────────────────────

export type ResolveResult = {
  suggestion: string;
  model: string;
  rateLimited: boolean;
  graphContextUsed: boolean;
};

export async function resolveConflict(
  workspaceId: string,
  conflict: ConflictRecord,
  memoryThread: Message[] = [],
): Promise<ResolveResult> {
  const graphContext = await buildConflictContext(workspaceId, conflict);

  const conflictDescription = [
    `File: ${conflict.file}`,
    `Branch A (${conflict.branchA}): commit ${conflict.commitShaA} by ${conflict.authorA}`,
    `  Message: "${conflict.messageA}"`,
    `Branch B (${conflict.branchB}): commit ${conflict.commitShaB} by ${conflict.authorB}`,
    `  Message: "${conflict.messageB}"`,
  ].join("\n");

  const result = await completeWithGraphContext({
    workspaceId,
    question: conflictDescription,
    graphContext,
    memoryThread,
    systemExtra: [
      "You are resolving a git conflict. Analyze the two commits carefully.",
      "Consider active team decisions and discussions from the graph context.",
      "Output:",
      "1. **Root cause** — why did this conflict occur?",
      "2. **Recommended resolution** — which change to keep, which to discard, or how to merge.",
      "3. **Action items** — specific git commands or code changes needed.",
      "Keep your answer under 300 words. Be direct and actionable.",
    ].join("\n"),
  });

  // Auto-mark resolved in the graph if AI succeeded
  if (!result.rateLimited && result.content) {
    await markConflictResolved(workspaceId, conflict.id, result.content.slice(0, 500));
  }

  return {
    suggestion: result.content,
    model: result.model,
    rateLimited: result.rateLimited,
    graphContextUsed: graphContext !== "No additional graph context found.",
  };
}
