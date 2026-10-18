import type { NextRequest } from "next/server";
import { relayAuthStep } from "@/server/auth-proxy";

/** Starts GitHub sign-in through this origin so the OAuth state cookie is first-party. */
export function GET(request: NextRequest) {
  return relayAuthStep(request, "/auth/github");
}
