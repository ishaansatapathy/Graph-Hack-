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
import { graphWrite } from "../graph/falkordb";
import { decryptJson } from "../workspace/secrets";
import * as workspaceDb from "../workspace/db";

const MAX_ISSUES = 200;

export type JiraSyncResult = {
  issues: number;
  skipped: number;
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
  const row = workspaceDb.getIntegration(workspaceId, "jira");
  if (!row) throw new Error("Jira is not connected for this workspace");

  const config = decryptJson(row.config_encrypted) as {
    baseUrl: string;
    email: string;
    apiToken: string;
  };

  const { baseUrl, email, apiToken } = config;
  if (!baseUrl || !email || !apiToken) throw new Error("Incomplete Jira configuration");

  const basic = Buffer.from(`${email}:${apiToken}`).toString("base64");

  let startAt = 0;
  let total = 0;
  let upserted = 0;
  let skipped = 0;

  do {
    const url = `${baseUrl}/rest/api/3/search?jql=ORDER+BY+updated+DESC&maxResults=50&startAt=${startAt}&fields=summary,status,priority,assignee,labels,issuetype`;
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Jira search returned ${resp.status}`);

    const data = (await resp.json()) as { total: number; issues: JiraIssue[] };
    total = data.total;

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

        upserted++;
      } catch {
        skipped++;
      }
    }

    startAt += data.issues.length;
  } while (startAt < total && startAt < MAX_ISSUES);

  return { issues: upserted, skipped };
}
