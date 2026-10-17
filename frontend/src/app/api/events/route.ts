import type { NextRequest } from "next/server";
import { streamEvents } from "@/server/source";

export async function GET(req: NextRequest) {
  const speed = Math.min(4, Math.max(0.25, Number(req.nextUrl.searchParams.get("speed")) || 1));
  return new Response(streamEvents(req.signal, speed), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
