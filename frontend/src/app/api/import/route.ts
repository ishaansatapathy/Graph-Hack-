import { proxyJson } from "@/server/source";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { repo?: unknown } | null;
  if (typeof body?.repo !== "string" || !body.repo.trim()) {
    return Response.json({ error: "Enter a GitHub repository as owner/name" }, { status: 400 });
  }
  return proxyJson(req, "/live/import", { method: "POST", body: JSON.stringify({ repo: body.repo.trim() }) });
}
