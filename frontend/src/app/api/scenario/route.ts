import { connection } from "next/server";
import { getScenario } from "@/server/source";

export async function GET() {
  await connection();
  try {
    return Response.json(await getScenario());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
