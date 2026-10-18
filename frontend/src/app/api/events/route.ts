import { streamEvents } from "@/server/source";

export async function GET(req: Request) {
  return new Response(streamEvents(req), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
