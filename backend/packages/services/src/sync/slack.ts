/**
 * Slack → FalkorDB sync.
 *
 * Uses the Slack Web API (requires a Bot OAuth token, not just a webhook URL).
 * Falls back to a webhook-only mode that posts a notification that Slack
 * ingestion requires a bot token.
 *
 * With a bot token, it fetches the most recent 200 messages across all
 * public channels the bot has joined and upserts them as:
 *   (:SlackMessage {ts, text, channel, user, url})
 * with edges:
 *   (:SlackMessage)-[:POSTED_IN]->(:SlackChannel {name})
 *   (:SlackMessage)-[:MENTIONS]->(n) when the text contains an Issue key
 */

import { graphWrite } from "../graph/falkordb";
import { graphRead } from "../graph/falkordb";
import { linkConversationToCode, type ConversationItem } from "../graph/discussions";
import { decryptJson } from "../workspace/secrets";
import * as workspaceDb from "../workspace/db";

const MAX_MESSAGES_PER_CHANNEL = 50;
const MAX_CHANNELS = 10;

export type SlackSyncResult = {
  messages: number;
  channels: number;
  mentions: number;
  mode: "full" | "webhook-only";
  /** Messages that name a file or function in the graph, and how many read as decisions. */
  codeLinks?: number;
  decisions?: number;
};

type SlackChannel = { id: string; name: string };
type SlackMessage = { ts: string; text: string; user?: string };

export async function syncSlackToGraph(workspaceId: string): Promise<SlackSyncResult> {
  const row = await workspaceDb.getIntegration(workspaceId, "slack");
  if (!row) throw new Error("Slack is not connected for this workspace");

  const config = decryptJson(row.config_encrypted) as {
    webhookUrl?: string;
    botToken?: string;
    teamDomain?: string;
  };

  // Full sync requires a bot token
  if (!config.botToken) {
    return { messages: 0, channels: 0, mentions: 0, mode: "webhook-only" };
  }

  const token = config.botToken;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // 1. List channels
  const chanResp = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel&limit=200&exclude_archived=true",
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!chanResp.ok) throw new Error(`Slack conversations.list returned HTTP ${chanResp.status}`);
  const chanData = (await chanResp.json()) as { ok: boolean; channels?: SlackChannel[] };
  if (!chanData.ok || !chanData.channels) {
    throw new Error("Slack conversations.list failed — check bot token scopes (channels:read)");
  }

  const channels = chanData.channels.slice(0, MAX_CHANNELS);
  let totalMessages = 0;
  let totalMentions = 0;
  const conversation: ConversationItem[] = [];

  for (const channel of channels) {
    // Upsert channel node
    await graphWrite(
      workspaceId,
      "MERGE (c:SlackChannel {slackId: $id}) SET c.name = $name, c.source = 'slack'",
      { id: channel.id, name: channel.name },
    );

    // Fetch history
    const histResp = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel.id}&limit=${MAX_MESSAGES_PER_CHANNEL}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!histResp.ok) throw new Error(`Slack history request returned HTTP ${histResp.status}`);
    const histData = (await histResp.json()) as { ok: boolean; messages?: SlackMessage[] };
    if (!histData.ok || !histData.messages) {
      throw new Error(`Slack history sync failed for channel ${channel.name}`);
    }

    const teamDomain = config.teamDomain && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.teamDomain)
      ? config.teamDomain
      : "slack";

    for (const msg of histData.messages) {
      if (!msg.text || msg.text.trim() === "") continue;
      const text = msg.text.slice(0, 500).replace(/'/g, "\\'");
      const msgUrl = `https://${teamDomain}.slack.com/archives/${channel.id}/p${msg.ts.replace(".", "")}`;

      await graphWrite(
        workspaceId,
        `MERGE (m:SlackMessage {ts: $ts, channelId: $channelId})
         SET m.text = $text, m.user = $user, m.url = $msgUrl, m.source = 'slack'`,
        { ts: msg.ts, channelId: channel.id, text, user: msg.user ?? "unknown", msgUrl },
      );

      conversation.push({
        id: `${channel.id}:${msg.ts}`,
        text: msg.text.slice(0, 500),
        author: msg.user ?? "unknown",
        channel: channel.name,
        url: msgUrl,
        source: "slack",
      });

      // Link to channel
      await graphWrite(
        workspaceId,
        `MATCH (m:SlackMessage {ts: $ts, channelId: $channelId}), (c:SlackChannel {slackId: $channelId})
         MERGE (m)-[:POSTED_IN]->(c)`,
        { ts: msg.ts, channelId: channel.id },
      );

      // Detect mentions of Issue keys (e.g. AUTH-123, PROJ-456)
      const issueKeys = [...msg.text.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)].map((m) => m[1]);
      for (const key of issueKeys.slice(0, 5)) {
        // Only wire if the issue exists in the graph
        const existing = await graphRead(
          workspaceId,
          "MATCH (i:Issue {key: $key}) RETURN id(i) AS id LIMIT 1",
          { key },
        );
        if (existing.length > 0) {
          await graphWrite(
            workspaceId,
            `MATCH (m:SlackMessage {ts: $ts, channelId: $channelId}), (i:Issue {key: $key})
             MERGE (m)-[:MENTIONS]->(i)`,
            { ts: msg.ts, channelId: channel.id, key },
          );
          totalMentions++;
        }
      }

      totalMessages++;
    }
  }

  const code = await linkConversationToCode(workspaceId, conversation);
  return {
    messages: totalMessages,
    channels: channels.length,
    mentions: totalMentions,
    mode: "full",
    codeLinks: code.linked,
    decisions: code.decisions,
  };
}
