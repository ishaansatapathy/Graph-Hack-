import { TRPCError } from "@trpc/server";

export function sanitizeTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;

  console.error("[trpc] unhandled error", error);

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}
