import { connection } from "next/server";
import { proxyJson } from "@/server/source";

export async function GET(req: Request) {
  await connection();
  return proxyJson(req, "/live/scenario");
}
