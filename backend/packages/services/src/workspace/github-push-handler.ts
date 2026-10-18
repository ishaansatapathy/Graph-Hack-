import type { GithubPushPayload } from "../github/push-schema";
import { extractJiraKeys, summarizePush } from "../github/push-schema";
import { notifyNewConflicts } from "../conflict/notify";
import { upsertChunks } from "../graph/chunks";
import { graphWrite } from "../graph/falkordb";
import { redactSecrets } from "../graph/redact";
import { normalizeJiraCloudBaseUrl, normalizeSlackWebhookUrl } from "../integrations/config";
import * as workspaceDb from "./db";
import { decryptJson } from "./secrets";

type GithubCommitFiles = {
  files?: Array<{ filename: string; status?: string; patch?: string }>;
};

async function fetchCommitPatch(repository: string, sha: string, token?: string) {
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(sha)) {
    return [];
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Stackfox",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`GitHub commit detail request failed (${response.status})`);

  const data = (await response.json()) as GithubCommitFiles;
  let remaining = 16_000;
  const patches: string[] = [];
  for (const file of (data.files ?? []).slice(0, 24)) {
    if (!file.patch || remaining <= 0) continue;
    const patch = redactSecrets(file.patch.slice(0, Math.min(2_000, remaining)));
    patches.push(`### ${file.status ?? "modified"}: ${file.filename}\n${patch}`);
    remaining -= patch.length;
  }
  return patches;
}

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
  await fetch(normalizeSlackWebhookUrl(webhookUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(8_000),
  });
}

async function moveJiraIssueToInProgress(
  config: { baseUrl?: string; email?: string; apiToken?: string },
  issueKey: string,
): Promise<"moved" | "already_in_progress" | "transition_unavailable" | "failed"> {
  if (!config.baseUrl || !config.email || !config.apiToken) return "failed";
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) return "failed";
  const baseUrl = normalizeJiraCloudBaseUrl(config.baseUrl);
  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const headers = { Authorization: `Basic ${basic}`, Accept: "application/json" };
  const issueResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!issueResponse.ok) return "failed";
  const issue = (await issueResponse.json()) as { fields?: { status?: { name?: string } } };
  if (issue.fields?.status?.name?.trim().toLowerCase() === "in progress") return "already_in_progress";

  const transitionsResponse = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    { headers, signal: AbortSignal.timeout(8_000) },
  );
  if (!transitionsResponse.ok) return "failed";
  const transitions = (await transitionsResponse.json()) as {
    transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
  };
  const transition = transitions.transitions?.find((item) =>
    [item.name, item.to?.name].some((name) => name?.trim().toLowerCase() === "in progress"),
  );
  if (!transition) return "transition_unavailable";

  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ transition: { id: transition.id } }),
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok ? "moved" : "failed";
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

async function ingestCommit(
  workspaceId: string,
  repository: string,
  branch: string,
  commit: { sha: string; message: string; author: string; at: string; files: string[]; jiraKeys: string[] },
  token?: string,
) {
  await graphWrite(workspaceId, `
    MERGE (r:Repository { name: $repo })
    MERGE (c:Commit { sha: $sha })
    SET c.message = $message, c.author = $author, c.branch = $branch,
        c.at = $at, c.source = 'github'
    MERGE (p:Person { name: $author })
    MERGE (p)-[:AUTHORED]->(c)
    MERGE (r)-[:HAS_COMMIT]->(c)
  `, {
    repo: repository,
    branch,
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    at: commit.at || new Date().toISOString(),
  });

  for (const filePath of commit.files) {
    await graphWrite(workspaceId, `
      MATCH (r:Repository { name: $repo })
      MERGE (f:File { path: $path })
      SET f.language = $lang, f.repo = $repo
      MERGE (r)-[:CONTAINS]->(f)
      WITH f
      MATCH (c:Commit { sha: $sha })
      MERGE (c)-[:MODIFIED]->(f)
    `, { repo: repository, path: filePath, lang: fileLanguage(filePath), sha: commit.sha });
  }

  for (const key of commit.jiraKeys) {
    await graphWrite(workspaceId, `
      MATCH (c:Commit { sha: $sha })
      MERGE (i:Issue { key: $key })
      SET i.source = 'github-ref'
      MERGE (c)-[:REFERENCES]->(i)
    `, { sha: commit.sha, key });
  }

  const patches = await fetchCommitPatch(repository, commit.sha, token).catch((error) => {
    console.warn("[github] commit diff retrieval failed", error instanceof Error ? error.message : error);
    return [];
  });
  await upsertChunks(workspaceId, {
    type: "Commit",
    keyProp: "sha",
    keyValue: commit.sha,
    label: `${repository}/${branch}`,
  }, redactSecrets([
    `commit ${commit.sha} by ${commit.author} on ${branch}: ${commit.message}`,
    ...patches,
  ].join("\n\n"))).catch(() => {/* non-fatal */});
}

export async function handleGithubPush(workspaceId: string, payload: GithubPushPayload) {
  const summary = summarizePush(payload);
  const webhookCommits = (payload.commits ?? []).slice(-25);
  const commitMessages = webhookCommits.map((commit) => commit.message ?? "");
  const jiraKeys = extractJiraKeys([summary.message, ...commitMessages].join("\n")).slice(0, 5);
  const githubConfig = await readGithubConfig(workspaceId);
  if (
    githubConfig?.repositoryFullName &&
    githubConfig.repositoryFullName.toLowerCase() !== summary.repo.toLowerCase()
  ) {
    return { ok: true, ignored: true, reason: "repository_mismatch" };
  }

  let filesIngested = 0;
  try {
    const commitsToIngest = webhookCommits.length > 0
      ? webhookCommits.map((commit) => ({
          sha: commit.id ?? "",
          message: commit.message ?? "Push",
          author: commit.author?.username ?? commit.author?.name ?? summary.author,
          at: commit.timestamp ?? new Date().toISOString(),
          files: [...new Set([...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])])]
            .filter((path) => path && path.length <= 500),
        }))
      : [{
          sha: summary.fullSha,
          message: summary.message,
          author: summary.author,
          at: new Date().toISOString(),
          files: [] as string[],
        }];

    // Bound webhook work even if a provider sends an unusually large push payload.
    let remainingFiles = 40;
    for (const commit of commitsToIngest) {
      if (!/^[a-f0-9]{40}$/i.test(commit.sha)) continue;
      const files = commit.files.slice(0, remainingFiles);
      remainingFiles -= files.length;
      const commitJiraKeys = extractJiraKeys(commit.message).slice(0, 5);
      await ingestCommit(workspaceId, summary.repo, summary.branch, {
        ...commit,
        files,
        jiraKeys: commitJiraKeys,
      }, githubConfig?.personalAccessToken);
      filesIngested += files.length;
      if (remainingFiles === 0) break;
    }
  } catch (error) {
    console.warn("[github] FalkorDB ingest skipped", error instanceof Error ? error.message : error);
  }

  let jiraConfig: { baseUrl?: string; email?: string; apiToken?: string; autoTransitionOnCommit?: string } | null = null;
  const jiraRow = jiraKeys.length ? await workspaceDb.getIntegration(workspaceId, "jira") : null;
  if (jiraRow) jiraConfig = decryptJson(jiraRow.config_encrypted);

  const transitionResults: Record<string, string> = {};
  if (jiraConfig?.autoTransitionOnCommit === "true") {
    await Promise.all(jiraKeys.map(async (key) => {
      try {
        transitionResults[key] = await moveJiraIssueToInProgress(jiraConfig, key);
      } catch (error) {
        transitionResults[key] = "failed";
        console.warn("[jira] automatic issue transition failed", key, error instanceof Error ? error.message : error);
      }
    }));
  }

  const movedIssues = Object.entries(transitionResults)
    .filter(([, result]) => result === "moved")
    .map(([key]) => key);
  const slackLine = `*${summary.repo}* \`${summary.sha}\` on \`${summary.branch}\` - ${summary.message}${
    jiraKeys.length ? ` (Jira: ${jiraKeys.join(", ")})` : ""
  }${movedIssues.length ? ` - moved to In Progress: ${movedIssues.join(", ")}` : ""}`;

  await postSlack(workspaceId, slackLine).catch((error) => {
    console.warn("[slack] push notification failed", error instanceof Error ? error.message : error);
  });

  // Alert admins about any newly-detected conflicts (deduped, non-blocking)
  void notifyNewConflicts(workspaceId, summary.author);

  return {
    ok: true,
    repo: summary.repo,
    sha: summary.sha,
    filesIngested,
    jiraKeys,
    jiraTransitions: transitionResults,
    webhookRegistered: Boolean(githubConfig?.repositoryFullName),
  };
}

export async function getGithubWebhookSecretForWorkspace(workspaceId: string): Promise<string> {
  const config = await readGithubConfig(workspaceId);
  return config?.webhookSecret?.trim() ?? "";
}
