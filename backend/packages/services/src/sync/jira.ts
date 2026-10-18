/**
 * Jira → FalkorDB sync.
 *
 * Fetches Jira issues (up to 200) and upserts them as
 *   (:Issue {key, title, status, priority, assignee, url})
 * nodes in the workspace graph, then wires
 *   (:Issue)-[:HAS_LABEL]->(:Label) and
 *   (:Issue)-[:ASSIGNED_TO]->(:Person)
 * relationships.
 */

import { upsertChunks } from "../graph/chunks";
import { linkConversationToCode, type ConversationItem } from "../graph/discussions";
import { graphWrite } from "../graph/falkordb";
import { normalizeJiraCloudBaseUrl } from "../integrations/config";
import { decryptJson } from "../workspace/secrets";
import * as workspaceDb from "../workspace/db";

const MAX_ISSUES = 200;

export type JiraSyncResult = {
  issues: number;
  skipped: number;
  /** Issues that name a file or function in the graph, and how many are recorded decisions. */
  codeLinks?: number;
  decisions?: number;
};

type JiraIssue = {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string; emailAddress?: string } | null;
    labels?: string[];
    issuetype?: { name?: string };
  };
};

export async function syncJiraToGraph(workspaceId: string): Promise<JiraSyncResult> {
  const row = await workspaceDb.getIntegration(workspaceId, "jira");
  if (!row) throw new Error("Jira is not connected for this workspace");

  const config = decryptJson(row.config_encrypted) as {
    baseUrl: string;
    email: string;
    apiToken: string;
  };

  const { email, apiToken } = config;
  const baseUrl = normalizeJiraCloudBaseUrl(config.baseUrl);
  if (!baseUrl || !email || !apiToken) throw new Error("Incomplete Jira configuration");

  const basic = Buffer.from(`${email}:${apiToken}`).toString("base64");

  let startAt = 0;
  let upserted = 0;
  let skipped = 0;
  let nextPageToken: string | undefined;
  let useJqlEndpoint = false;
  let more = true;
  const conversation: ConversationItem[] = [];
  const headers = { Authorization: `Basic ${basic}`, Accept: "application/json" };
  const query = "jql=ORDER+BY+updated+DESC&maxResults=50&fields=summary,status,priority,assignee,labels,issuetype";

  do {
    let data: { total?: number; issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    if (!useJqlEndpoint) {
      const resp = await fetch(`${baseUrl}/rest/api/3/search?${query}&startAt=${startAt}`, { headers, signal: AbortSignal.timeout(15_000) });
      // Atlassian retired GET /rest/api/3/search on Jira Cloud; /search/jql replaces it with token paging.
      if (resp.status === 404 || resp.status === 410) {
        useJqlEndpoint = true;
        continue;
      }
      if (!resp.ok) throw new Error(`Jira search returned ${resp.status}`);
      data = (await resp.json()) as typeof data;
    } else {
      const page = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const resp = await fetch(`${baseUrl}/rest/api/3/search/jql?${query}${page}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`Jira search returned ${resp.status}`);
      data = (await resp.json()) as typeof data;
    }

    if (!Array.isArray(data.issues)) {
      throw new Error("Jira returned an incomplete issue page; sync stopped to avoid reporting partial data as current");
    }
    if (!useJqlEndpoint && data.issues.length === 0 && startAt < (data.total ?? 0)) {
      throw new Error("Jira returned an incomplete issue page; sync stopped to avoid reporting partial data as current");
    }

    for (const issue of data.issues) {
      try {
        const key = issue.key;
        const title = (issue.fields.summary ?? "").replace(/'/g, "\\'").slice(0, 200);
        const status = (issue.fields.status?.name ?? "Unknown").slice(0, 60);
        const priority = (issue.fields.priority?.name ?? "Medium").slice(0, 40);
        const issueType = (issue.fields.issuetype?.name ?? "Issue").slice(0, 40);
        const assignee = (issue.fields.assignee?.displayName ?? "").slice(0, 80);
        const issueUrl = `${baseUrl}/browse/${key}`;

        // Upsert the Issue node
        await graphWrite(
          workspaceId,
          `MERGE (i:Issue {key: $key})
           SET i.title = $title, i.status = $status, i.priority = $priority,
               i.type = $issueType, i.url = $issueUrl, i.source = 'jira'`,
          { key, title, status, priority, issueType, issueUrl },
        );

        // Wire assignee
        if (assignee) {
          await graphWrite(
            workspaceId,
            `MATCH (i:Issue {key: $key})
             MERGE (p:Person {name: $name})
             MERGE (i)-[:ASSIGNED_TO]->(p)`,
            { key, name: assignee },
          );
        }

        // Wire labels
        for (const label of (issue.fields.labels ?? []).slice(0, 5)) {
          await graphWrite(
            workspaceId,
            `MATCH (i:Issue {key: $key})
             MERGE (l:Label {name: $label})
             MERGE (i)-[:HAS_LABEL]->(l)`,
            { key, label },
          );
        }

        // Chunk the issue for GraphRAG keyword search
        const chunkText = `${key} (${issueType}) [${status}] [${priority}]: ${title}. Assignee: ${assignee || "unassigned"}. Labels: ${(issue.fields.labels ?? []).join(", ")}`;
        await upsertChunks(workspaceId, { type: "Issue", keyProp: "key", keyValue: key, label: key }, chunkText)
          .catch(() => {/* non-fatal */});

        conversation.push({
          id: key,
          text: issue.fields.summary ?? "",
          author: assignee || "unassigned",
          channel: "jira",
          url: issueUrl,
          source: "jira",
          labels: issue.fields.labels ?? [],
        });
        upserted++;
      } catch {
        skipped++;
      }
    }

    startAt += data.issues.length;
    if (useJqlEndpoint) {
      nextPageToken = data.nextPageToken;
      more = Boolean(nextPageToken) && data.isLast !== true && data.issues.length > 0;
    } else {
      more = startAt < (data.total ?? 0);
    }
  } while (more && startAt < MAX_ISSUES);

  const code = await linkConversationToCode(workspaceId, conversation);
  return { issues: upserted, skipped, codeLinks: code.linked, decisions: code.decisions };
}
