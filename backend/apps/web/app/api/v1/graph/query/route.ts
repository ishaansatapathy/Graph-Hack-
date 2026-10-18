import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey, graphEngine, reserveApiKeyRequest } from "@stackfox/services";

export const runtime = "nodejs";

const querySchema = z.object({
  cypher: z.string().trim().min(1).max(8_000),
}).strict();

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (sk_stackfox_[A-Za-z0-9_-]{20,})$/.exec(authorization);
  if (!match) {
    return NextResponse.json({ error: "A valid workspace API key is required" }, { status: 401 });
  }

  let key: Awaited<ReturnType<typeof authenticateApiKey>>;
  try {
    key = await authenticateApiKey(match[1]);
  } catch {
    return NextResponse.json({ error: "Workspace API authentication is temporarily unavailable" }, { status: 503 });
  }
  if (!key) {
    return NextResponse.json({ error: "A valid workspace API key is required" }, { status: 401 });
  }

  const now = Date.now();
  const minute = new Date(now).toISOString().slice(0, 16);
  let allowed: boolean;
  try {
    allowed = await reserveApiKeyRequest(key.id, minute, 60);
  } catch {
    return NextResponse.json({ error: "Workspace API quota is temporarily unavailable" }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "API key request limit reached; retry in the next minute" },
      { status: 429, headers: { "Retry-After": String(60 - Math.floor((now % 60_000) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = querySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected a single Cypher query (max 8,000 characters)" }, { status: 400 });
  }
  if (parsed.data.cypher.includes(";")) {
    return NextResponse.json({ error: "Multiple Cypher statements are not allowed" }, { status: 400 });
  }
  const cypher = parsed.data.cypher;
  const limit = /\bLIMIT\s+(\d+)\s*$/i.exec(cypher);
  if (!/^MATCH\b/i.test(cypher) || !/\bRETURN\b/i.test(cypher) || !limit || Number(limit[1]) > 100) {
    return NextResponse.json(
      { error: "Use a single MATCH … RETURN query with an explicit LIMIT of 100 or less" },
      { status: 400 },
    );
  }
  if (/\b(UNWIND|WITH|OPTIONAL|UNION|FOREACH|LOAD|CALL)\b/i.test(cypher) || /\/\*|\/\/|--/.test(cypher)) {
    return NextResponse.json({ error: "This API supports bounded MATCH … RETURN queries only" }, { status: 400 });
  }

  const returnIndex = cypher.search(/\bRETURN\b/i);
  const matchClause = cypher.slice(5, returnIndex);
  if (/\[[^\]]*\*/.test(matchClause) || /\bMATCH\b/i.test(matchClause) || /,\s*\(/.test(matchClause)) {
    return NextResponse.json(
      { error: "Variable-length paths, repeated MATCH clauses, and cartesian products are not supported" },
      { status: 400 },
    );
  }

  try {
    const result = await graphEngine.runReadOnlyCypher(key.workspaceId, cypher);
    const payload = { workspaceId: key.workspaceId, ...result };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 512 * 1024) {
      return NextResponse.json({ error: "Query result exceeds the 512 KB response limit; return fewer or smaller properties" }, { status: 413 });
    }
    return NextResponse.json({ workspaceId: key.workspaceId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph query failed";
    const status = /read-only Cypher/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? message : "Graph query failed" }, { status });
  }
}
