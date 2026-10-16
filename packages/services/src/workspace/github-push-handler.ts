import type { GithubPushPayload } from "../github/push-schema";
import { extractJiraKeys, summarizePush } from "../github/push-schema";
import { getGraph } from "../graph/falkordb";
import * as workspaceDb from "./db";
import { decryptJson } from "./secrets";

function readGithubConfig(workspaceId: string) {
  const row = workspaceDb.getIntegration(workspaceId, "github");
  if (!row) return null;
  return decryptJson(row.config_encrypted);
}

async function postSlack(workspaceId: string, text: string) {
  const row = workspaceDb.getIntegration(workspaceId, "slack");
  if (!row) return;
  const { webhookUrl } = decryptJson(row.config_encrypted);
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function commentJira(workspaceId: string, issueKey: string, body: string) {
  const row = workspaceDb.getIntegration(workspaceId, "jira");
  if (!row) return;
  const config = decryptJson(row.config_encrypted);
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

export async function handleGithubPush(workspaceId: string, payload: GithubPushPayload) {
  const summary = summarizePush(payload);
  const jiraKeys = extractJiraKeys(summary.message);

  try {
    const graph = await getGraph();
    const sha = summary.fullSha || summary.sha;
    await graph.query(
      `
      MERGE (r:Repository { fullName: $repo })
      SET r.branch = $branch
      MERGE (c:Commit { sha: $sha })
      SET c.message = $message, c.author = $author, c.branch = $branch, c.at = $at
      MERGE (r)-[:HAS_COMMIT]->(c)
      `,
      {
        params: {
          repo: summary.repo,
          branch: summary.branch,
          sha,
          message: summary.message,
          author: summary.author,
          at: new Date().toISOString(),
        },
      },
    );

    for (const key of jiraKeys) {
      await graph.query(
        `
        MATCH (c:Commit { sha: $sha })
        MERGE (i:Issue { key: $key })
        MERGE (c)-[:REFERENCES]->(i)
        `,
        { params: { sha, key } },
      );
    }
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

  const gh = readGithubConfig(workspaceId);
  return {
    ok: true,
    repo: summary.repo,
    sha: summary.sha,
    jiraKeys,
    webhookRegistered: Boolean(gh?.repositoryFullName),
  };
}

export function getGithubWebhookSecretForWorkspace(workspaceId: string) {
  const config = readGithubConfig(workspaceId);
  return config?.webhookSecret?.trim() ?? "";
}
