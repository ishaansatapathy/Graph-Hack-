/**
 * Links team conversation to code. A Slack message or Jira issue that names a
 * file or function in the graph gets a CONCERNS edge to it; one that reads like
 * a decision also produces a Decision node that CONSTRAINS that code.
 *
 *   Slack:  (:Discussion)-[:CONCERNS]->(:File|:Function), (:Discussion)-[:FROM]->(:SlackMessage)
 *   Jira:   (:Issue)-[:CONCERNS]->(:File|:Function)
 *   Both:   (:Decision)-[:CONSTRAINS]->(:File|:Function)
 */

import { graphRead, graphWrite } from "./falkordb";

export type ConversationItem = {
  /** Slack: `${channelId}:${ts}`; Jira: the issue key. */
  id: string;
  text: string;
  author: string;
  channel: string;
  url?: string;
  source: "slack" | "jira";
  /** Jira labels such as `decision` or `adr` mark the issue as a decision. */
  labels?: string[];
};

type CodeNames = { files: string[]; functions: { name: string; file: string }[] };

const DECISION_TEXT = /\b(decided|decision|we will|we'll|let'?s go with|agreed|going forward|from now on|must always|should always|never use|don'?t use)\b/i;
const DECISION_LABELS = new Set(["decision", "adr", "architecture-decision"]);

async function loadCodeNames(workspaceId: string): Promise<CodeNames> {
  const [files, functions] = await Promise.all([
    graphRead(workspaceId, "MATCH (f:File) RETURN f.path AS path LIMIT 3000"),
    graphRead(workspaceId, "MATCH (fn:Function) RETURN fn.name AS name, fn.file AS file LIMIT 3000"),
  ]);
  return {
    files: files.map((r) => String(r.path ?? "")).filter(Boolean),
    functions: functions.map((r) => ({ name: String(r.name ?? ""), file: String(r.file ?? "") })).filter((f) => f.name && f.file),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Files are matched by full path or by a distinctive file name ("request.js").
 * Functions are matched when written as a call (`send(`), in backticks, or as a
 * camelCase/snake_case identifier, so ordinary words like "status" do not link.
 */
export function findCodeMentions(text: string, names: CodeNames) {
  const files = new Set<string>();
  const baseCounts = new Map<string, number>();
  for (const path of names.files) {
    const base = path.split("/").pop() ?? path;
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  for (const path of names.files) {
    const base = path.split("/").pop() ?? path;
    if (text.includes(path)) files.add(path);
    else if (base.length >= 5 && base.includes(".") && baseCounts.get(base) === 1
      && new RegExp(`(^|[^\\w./-])${escapeRegExp(base)}($|[^\\w-])`).test(text)) files.add(path);
  }

  const functions: { name: string; file: string }[] = [];
  for (const fn of names.functions) {
    const n = escapeRegExp(fn.name);
    const distinctive = fn.name.length >= 6 && /[A-Z_]/.test(fn.name.slice(1));
    const mentioned = new RegExp(`(^|[^\\w$])${n}\\s*\\(`).test(text)
      || new RegExp("`" + n + "(\\(\\))?`").test(text)
      || (distinctive && new RegExp(`(^|[^\\w$])${n}($|[^\\w$])`).test(text));
    if (mentioned) functions.push(fn);
  }
  return { files: [...files].slice(0, 10), functions: functions.slice(0, 10) };
}

export function looksLikeDecision(item: Pick<ConversationItem, "text" | "labels">) {
  return (item.labels ?? []).some((l) => DECISION_LABELS.has(l.toLowerCase())) || DECISION_TEXT.test(item.text);
}

async function linkTargets(workspaceId: string, from: string, fromKey: Record<string, string>, rel: string, mentions: ReturnType<typeof findCodeMentions>) {
  const keys = Object.keys(fromKey).map((k) => `${k}: $${k}`).join(", ");
  for (const fn of mentions.functions) {
    await graphWrite(workspaceId, `MATCH (s:${from} {${keys}}), (t:Function {name: $fnName, file: $fnFile}) MERGE (s)-[:${rel}]->(t)`,
      { ...fromKey, fnName: fn.name, fnFile: fn.file });
  }
  for (const path of mentions.files) {
    await graphWrite(workspaceId, `MATCH (s:${from} {${keys}}), (t:File {path: $path}) MERGE (s)-[:${rel}]->(t)`,
      { ...fromKey, path });
  }
}

export async function linkConversationToCode(workspaceId: string, items: ConversationItem[]) {
  if (items.length === 0) return { linked: 0, decisions: 0 };
  const names = await loadCodeNames(workspaceId);
  if (names.files.length === 0 && names.functions.length === 0) return { linked: 0, decisions: 0 };

  let linked = 0;
  let decisions = 0;
  for (const item of items) {
    const mentions = findCodeMentions(item.text, names);
    if (mentions.files.length === 0 && mentions.functions.length === 0) continue;
    linked++;

    if (item.source === "slack") {
      const discussionId = `slack:${item.id}`;
      await graphWrite(
        workspaceId,
        `MERGE (d:Discussion {id: $id})
         SET d.text = $text, d.author = $author, d.channel = $channel, d.url = $url, d.source = 'slack'`,
        { id: discussionId, text: item.text.slice(0, 500), author: item.author, channel: item.channel, url: item.url ?? "" },
      );
      const [channelId, ts] = item.id.split(":");
      await graphWrite(
        workspaceId,
        `MATCH (d:Discussion {id: $id}), (m:SlackMessage {ts: $ts, channelId: $channelId}) MERGE (d)-[:FROM]->(m)`,
        { id: discussionId, ts: ts ?? "", channelId: channelId ?? "" },
      );
      await linkTargets(workspaceId, "Discussion", { id: discussionId }, "CONCERNS", mentions);
    } else {
      await linkTargets(workspaceId, "Issue", { key: item.id }, "CONCERNS", mentions);
    }

    if (looksLikeDecision(item)) {
      const decisionId = `${item.source}:${item.id}`;
      await graphWrite(
        workspaceId,
        `MERGE (dec:Decision {id: $id})
         SET dec.title = $title, dec.rationale = $rationale, dec.status = 'recorded', dec.source = $source, dec.url = $url, dec.author = $author`,
        {
          id: decisionId,
          title: item.text.split(/\r?\n/)[0]!.slice(0, 120),
          rationale: item.text.slice(0, 500),
          source: item.source,
          url: item.url ?? "",
          author: item.author,
        },
      );
      await linkTargets(workspaceId, "Decision", { id: decisionId }, "CONSTRAINS", mentions);
      decisions++;
    }
  }
  return { linked, decisions };
}
