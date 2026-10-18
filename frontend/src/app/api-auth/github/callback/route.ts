import type { NextRequest } from "next/server";
import { relayAuthStep } from "@/server/auth-proxy";

/** GitHub redirects here; the backend exchanges the code and its session cookies are relayed. */
export function GET(request: NextRequest) {
  return relayAuthStep(request, "/auth/github/callback");
}
