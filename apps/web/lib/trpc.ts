import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

import type { ServerRouter } from "@stackfox/trpc/client";

function getTrpcUrl() {
  if (typeof window === "undefined") {
    return `${process.env.API_INTERNAL_URL ?? "http://localhost:8000"}/trpc`;
  }
  return "/api-backend/trpc";
}

export const trpc = createTRPCProxyClient<ServerRouter>({
  links: [
    httpBatchLink({
      url: getTrpcUrl(),
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
