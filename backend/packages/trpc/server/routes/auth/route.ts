import {
  authUserSchema,
  getAuthenticationMethodOutputSchema,
  messageOutputSchema,
} from "@stackfox/services";
import { z } from "zod";

import { zodUndefinedModel } from "../../schema";
import { authService, userService } from "../../services";
import { mapAuthError, protectedProcedure, publicProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Authentication"];
const getPath = generatePath("/authentication");

export const authRouter = router({
  getSupportedAuthenticationProviders: publicProcedure
    .meta({ openapi: { method: "GET", path: getPath("/supported-providers"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(z.readonly(z.array(getAuthenticationMethodOutputSchema)))
    .query(async () => userService.getAuthenticationMethods()),

  logout: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/logout"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(messageOutputSchema)
    .mutation(({ ctx }) => authService.logout(ctx.req, ctx.res)),

  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/me"), tags: TAGS, protect: true } })
    .input(zodUndefinedModel)
    .output(authUserSchema)
    .query(({ ctx }) => ctx.user),
});
