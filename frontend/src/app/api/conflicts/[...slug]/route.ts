import { connection } from "next/server";
import { proxyToBackend } from "@/server/proxy";

export async function POST(
  req: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  await connection();
  const { slug } = await props.params;
  const path = `/api/conflicts/${slug.join("/")}`;
  const body = await req.json().catch(() => ({}));
  return proxyToBackend(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
