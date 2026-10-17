/**
 * Sign-in seam. No identity provider is wired up yet, so this answers 501
 * and the sign-in page shows that state. Replace with the real provider
 * (e.g. GitHub OAuth) when it exists.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { method?: string } | null;
  if (body?.method !== "github" && body?.method !== "email") {
    return Response.json({ error: "Unknown sign-in method" }, { status: 400 });
  }
  return Response.json({ error: "Sign-in isn't connected to an identity provider yet." }, { status: 501 });
}
