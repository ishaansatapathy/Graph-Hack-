import { initTRPC, TRPCError } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import { AuthError } from "@stackfox/services";
import { ZodError } from "zod";

import { createContext } from "./context";
import { sanitizeTrpcError } from "./error-handler";

export const tRPCContext = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createContext>()
  .create({
    errorFormatter({ shape, error, ctx }) {
      const zodError =
        error.cause instanceof ZodError ? error.cause.flatten().fieldErrors : null;
      return {
        ...shape,
        message: ctx?.requestId ? `[${ctx.requestId}] ${shape.message}` : shape.message,
        data: {
          ...shape.data,
          zodError,
          requestId: ctx?.requestId,
        },
      };
    },
  });

export const router = tRPCContext.router;

const logMiddleware = tRPCContext.middleware(async ({ path, type, ctx, next }) => {
  const started = Date.now();
  try {
    const result = await next();
    if (process.env.NODE_ENV !== "production") {
      console.debug("[trpc] ok", { path, type, requestId: ctx.requestId, ms: Date.now() - started });
    }
    return result;
  } catch (error) {
    console.warn("[trpc] fail", {
      path,
      type,
      requestId: ctx.requestId,
      ms: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

const baseProcedure = tRPCContext.procedure.use(logMiddleware);

export const publicProcedure = baseProcedure;

export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export function mapAuthError(error: unknown): never {
  if (error instanceof TRPCError) throw error;

  if (error instanceof AuthError) {
    const codeMap: Record<AuthError["code"], TRPCError["code"]> = {
      BAD_REQUEST: "BAD_REQUEST",
      UNAUTHORIZED: "UNAUTHORIZED",
      FORBIDDEN: "FORBIDDEN",
      NOT_FOUND: "NOT_FOUND",
      CONFLICT: "CONFLICT",
      INTERNAL: "INTERNAL_SERVER_ERROR",
    };

    throw new TRPCError({
      code: codeMap[error.code],
      message: error.message,
    });
  }

  sanitizeTrpcError(error);
}

export function mapServiceError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  sanitizeTrpcError(error);
}
