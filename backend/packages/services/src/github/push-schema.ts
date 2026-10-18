import { z } from "zod";

export const githubPushPayloadSchema = z.object({
  ref: z.string().optional(),
  repository: z
    .object({
      full_name: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  pusher: z.object({ name: z.string().optional() }).optional(),
  commits: z
    .array(
      z.object({
        id: z.string().optional(),
        message: z.string().optional(),
        timestamp: z.string().optional(),
        author: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
        added: z.array(z.string()).optional(),
        modified: z.array(z.string()).optional(),
        removed: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  head_commit: z
    .object({
      id: z.string().optional(),
      message: z.string().optional(),
      timestamp: z.string().optional(),
      author: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
    })
    .optional(),
});

export type GithubPushPayload = z.infer<typeof githubPushPayloadSchema>;

export function summarizePush(payload: GithubPushPayload) {
  const repo = payload.repository?.full_name ?? payload.repository?.name ?? "unknown";
  const branch = payload.ref?.replace("refs/heads/", "") ?? "main";
  const head = payload.head_commit;
  const sha = head?.id?.slice(0, 7) ?? "unknown";
  const message = head?.message?.split("\n")[0]?.trim() ?? "Push";
  const author =
    head?.author?.username ?? head?.author?.name ?? payload.pusher?.name ?? "unknown";
  return { repo, branch, sha, fullSha: head?.id ?? "", message, author };
}

export function extractJiraKeys(text: string) {
  const matches = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g);
  return [...new Set(matches ?? [])];
}
