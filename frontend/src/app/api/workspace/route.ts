import { connection } from "next/server";
import { proxyToBackend } from "@/server/proxy";

export async function GET() {
  await connection();
  return proxyToBackend("/api/workspace");
}
