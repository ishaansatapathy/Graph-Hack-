/**
 * Answer a question about a workspace from its graph: GraphRAG evidence plus
 * matching chunks, the user's recent conversation, and one model call.
 * Callers enforce membership and quotas before calling this.
 */

import { completeWithGraphContext, type Message } from "../ai/router";
import { formatChunkContext, searchChunks } from "./chunks";
import { appendMessage, getThread } from "./memory";
import { graphRagAnswer } from "./rag";

export type WorkspaceAnswer = {
  answer: string;
  model: string;
  complexity: string;
  rateLimited: boolean;
  cypher: string[];
  evidenceCount: number;
  chunkCount: number;
};

export async function answerWorkspaceQuestion(workspaceId: string, userId: string, question: string): Promise<WorkspaceAnswer> {
  await appendMessage(workspaceId, userId, "user", question);

  const ragResult = await graphRagAnswer(workspaceId, question);

  const keywords = question
    .toLowerCase()
    .split(/[\s,.:;?!()\[\]{}'"`]+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);
  const chunkHits = await searchChunks(workspaceId, keywords, 6);
  const chunkContext = formatChunkContext(chunkHits);

  const graphContext = [
    ragResult.answer,
    chunkContext ? `\n\n### Additional chunk context:\n${chunkContext}` : "",
  ].filter(Boolean).join("");

  const thread = await getThread(workspaceId, userId);
  const memoryThread: Message[] = thread
    .slice(-8)
    .map((m) => ({ role: m.role as Message["role"], content: m.content }));

  const ai = await completeWithGraphContext({ workspaceId, userId, question, graphContext, memoryThread });

  await appendMessage(workspaceId, userId, "assistant", ai.content);

  return {
    answer: ai.content,
    model: ai.model,
    complexity: ai.complexity,
    rateLimited: ai.rateLimited,
    cypher: ragResult.cypher,
    evidenceCount: ragResult.evidenceCount + chunkHits.length,
    chunkCount: chunkHits.length,
  };
}
