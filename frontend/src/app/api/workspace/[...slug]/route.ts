import { connection } from "next/server";
import { proxyToBackend } from "@/server/proxy";

export async function GET(
  _req: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  await connection();
  const { slug } = await props.params;
  const path = `/api/workspace/${slug.join("/")}`;
  return proxyToBackend(path);
}

export async function POST(
  req: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  await connection();
  const { slug } = await props.params;
  const path = `/api/workspace/${slug.join("/")}`;
  const body = await req.json().catch(() => ({}));
  return proxyToBackend(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  await connection();
  const { slug } = await props.params;
  const path = `/api/workspace/${slug.join("/")}`;
  return proxyToBackend(path, {
    method: "DELETE",
  });
}
