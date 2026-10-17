import type { GithubPushPayload } from "../github/push-schema";
import { extractJiraKeys, summarizePush } from "../github/push-schema";
import { upsertChunks } from "../graph/chunks";
import { graphWrite } from "../graph/falkordb";
import * as workspaceDb from "./db";
import { decryptJson } from "./secrets";

async function readGithubConfig(workspaceId: string) {
  const row = await workspaceDb.getIntegration(workspaceId, "github");
  if (!row) return null;
  return decryptJson(row.config_encrypted);
}

async function postSlack(workspaceId: string, text: string) {
  const row = await workspaceDb.getIntegration(workspaceId, "slack");
  if (!row) return;
  const { webhookUrl } = decryptJson(row.config_encrypted) as { webhookUrl?: string };
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function commentJira(workspaceId: string, issueKey: string, body: string) {
  const row = await workspaceDb.getIntegration(workspaceId, "jira");
  if (!row) return;
  const config = decryptJson(row.config_encrypted) as {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
  };
  if (!config.baseUrl || !config.email || !config.apiToken) return;
  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  await fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: body }],
          },
        ],
      },
    }),
  });
}

/** Infer file language from extension. */
function fileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "ts", js: "js", jsx: "js",
    py: "python", rs: "rust", go: "go",
    java: "java", kt: "kotlin", rb: "ruby",
    cs: "csharp", cpp: "cpp", c: "c",
    json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "shell",
  };
  return map[ext] ?? ext;
}

export async function handleGithubPush(workspaceId: string, payload: GithubPushPayload) {
  const summary = summarizePush(payload);
  const jiraKeys = extractJiraKeys(summary.message);

  try {
    const sha = summary.fullSha || summary.sha;

    // 1. Upsert Repository + Commit + Person + edges
    await graphWrite(
      workspaceId,
      `
      MERGE (r:Repository { name: $repo })
      MERGE (c:Commit { sha: $sha })
      SET c.message = $message, c.author = $author, c.branch = $branch,
          c.at = $at, c.source = 'github'
      MERGE (p:Person { name: $author })
      MERGE (p)-[:AUTHORED]->(c)
      MERGE (r)-[:HAS_COMMIT]->(c)
      `,
      {
        repo: summary.repo,
        branch: summary.branch,
        sha,
        message: summary.message,
        author: summary.author,
        at: new Date().toISOString(),
      },
    );

    // 2. Upsert File nodes for every changed file + MODIFIED edges on the Commit
    const changedFiles: string[] =
      (payload as unknown as { commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }> })
        .commits
        ?.flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])])
        .filter(Boolean)
        .slice(0, 40) ?? [];

    for (const filePath of changedFiles) {
      await graphWrite(
        workspaceId,
        `
        MATCH (r:Repository { name: $repo })
        MERGE (f:File { path: $path })
        SET f.language = $lang, f.repo = $repo
        MERGE (r)-[:CONTAINS]->(f)
        WITH f
        MATCH (c:Commit { sha: $sha })
        MERGE (c)-[:MODIFIED]->(f)
        `,
        {
          repo: summary.repo,
          path: filePath,
          lang: fileLanguage(filePath),
          sha,
        },
      );
    }

    // 3. Wire Jira issue references
    for (const key of jiraKeys) {
      await graphWrite(
        workspaceId,
        `
        MATCH (c:Commit { sha: $sha })
        MERGE (i:Issue { key: $key })
        SET i.source = 'github-ref'
        MERGE (c)-[:REFERENCES]->(i)
        `,
        { sha, key },
      );
    }

    // 4. Chunk the commit message for GraphRAG
    const commitText = `commit ${sha} by ${summary.author} on ${summary.branch}: ${summary.message}`;
    await upsertChunks(workspaceId, {
      type: "Commit",
      keyProp: "sha",
      keyValue: sha,
      label: `${summary.repo}/${summary.branch}`,
    }, commitText).catch(() => {/* non-fatal */});
  } catch (error) {
    console.warn("[github] FalkorDB ingest skipped", error instanceof Error ? error.message : error);
  }

  const slackLine = `*${summary.repo}* \`${summary.sha}\` on \`${summary.branch}\` — ${summary.message}${
    jiraKeys.length ? ` (Jira: ${jiraKeys.join(", ")})` : ""
  }`;

  await postSlack(workspaceId, slackLine);

  for (const key of jiraKeys) {
    await commentJira(
      workspaceId,
      key,
      `Stackfox: commit ${summary.sha} on ${summary.branch} — ${summary.message}`,
    );
  }

  const gh = await readGithubConfig(workspaceId);
  return {
    ok: true,
    repo: summary.repo,
    sha: summary.sha,
    filesIngested: 0,
    jiraKeys,
    webhookRegistered: Boolean(gh?.repositoryFullName),
  };
}

export async function getGithubWebhookSecretForWorkspace(workspaceId: string): Promise<string> {
  const config = await readGithubConfig(workspaceId);
  return config?.webhookSecret?.trim() ?? "";
}
