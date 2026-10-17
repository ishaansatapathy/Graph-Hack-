import {
  assertWorkspaceMember,
  createApiKey,
  getGithubOnboarding,
  getOrCreateWorkspaceForUser,
  listApiKeys,
  messageOutputSchema,
  revokeApiKey,
  workspaceIntegrations,
  workspaceTools,
  workspaceMembers,
} from "@stackfox/services";
import { z } from "zod";

import { zodUndefinedModel } from "../../schema";
import { mapServiceError, protectedProcedure, publicProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Workspace"];
const getPath = generatePath("/workspace");

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(["owner", "admin", "member"]),
});

const providerSchema = z.enum(["github", "jira", "slack"]);

const integrationSummarySchema = z.object({
  provider: providerSchema,
  configured: z.boolean(),
  maskedSecrets: z.record(z.string(), z.string().nullable()),
  updatedAt: z.string().nullable(),
});

const testResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const workspaceRouter = router({
  current: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/current"), tags: TAGS, protect: true } })
    .input(zodUndefinedModel)
    .output(workspaceSchema)
    .query(async ({ ctx }) => {
      try {
        return await getOrCreateWorkspaceForUser(ctx.user.id, ctx.user.fullName, ctx.user.email);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await workspaceMembers.listWorkspacesForUser(ctx.user.id);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  setActive: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await workspaceMembers.setActiveWorkspace(ctx.user.id, input.workspaceId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  members: router({
    inviteDetails: publicProcedure
      .input(z.object({ token: z.string().min(32).max(128) }))
      .query(async ({ input }) => {
        try {
          return await workspaceMembers.getInviteByToken(input.token);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    acceptInvite: protectedProcedure
      .input(z.object({ token: z.string().min(32).max(128) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.acceptInviteByToken(input.token, ctx.user.id, ctx.user.email);
        } catch (error) {
          mapServiceError(error);
        }
      }),
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.listMembers(input.workspaceId, ctx.user.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    invite: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          email: z.string().email(),
          role: z.enum(["admin", "member"]).default("member"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.inviteMember(input.workspaceId, ctx.user.id, input.email, input.role);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    cancelInvite: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), inviteId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.cancelInvite(input.workspaceId, ctx.user.id, input.inviteId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    setRole: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          userId: z.string().uuid(),
          role: z.enum(["admin", "member"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.setMemberRole(input.workspaceId, ctx.user.id, input.userId, input.role);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceMembers.removeMember(input.workspaceId, ctx.user.id, input.userId);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),

  integrations: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(z.array(integrationSummarySchema))
      .query(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return await workspaceIntegrations.listIntegrationSummaries(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    githubOnboarding: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(z.object({ webhookUrl: z.string() }))
      .query(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return await getGithubOnboarding(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertGithub: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          personalAccessToken: z.string().optional(),
          repositoryFullName: z.string().optional(),
          webhookSecret: z.string().optional(),
          registerWebhook: z.boolean().optional(),
        }),
      )
      .output(
        z.object({
          message: z.string(),
          webhookRegistration: z.object({ ok: z.boolean(), message: z.string() }).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          const result = await workspaceIntegrations.upsertGithub(input.workspaceId, input);
          return {
            message: result.webhookRegistration?.message ?? result.message,
            webhookRegistration: result.webhookRegistration,
          };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertJira: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          baseUrl: z.string().min(8),
          email: z.string().email(),
          apiToken: z.string().min(1),
        }),
      )
      .output(messageOutputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          await workspaceIntegrations.upsertJira(input.workspaceId, input);
          return { message: "Jira connected" };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertSlack: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          webhookUrl: z.string().startsWith("https://hooks.slack.com/"),
          botToken: z.string().optional(),
          teamDomain: z.string().optional(),
        }),
      )
      .output(messageOutputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          await workspaceIntegrations.upsertSlack(input.workspaceId, input);
          return { message: "Slack connected" };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), provider: providerSchema }))
      .output(messageOutputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          await workspaceIntegrations.removeIntegration(input.workspaceId, input.provider);
          return { message: "Integration removed" };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testGithub: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return await workspaceIntegrations.testGithub(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testJira: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return await workspaceIntegrations.testJira(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testSlack: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return await workspaceIntegrations.testSlack(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),

  share: router({
    listApiKeys: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            prefix: z.string(),
            createdAt: z.string(),
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listApiKeys(input.workspaceId, ctx.user.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    createApiKey: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), name: z.string().min(1).max(80) }))
      .output(
        z.object({
          id: z.string(),
          name: z.string(),
          key: z.string(),
          prefix: z.string(),
          createdAt: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createApiKey(input.workspaceId, ctx.user.id, input.name);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    revokeApiKey: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), keyId: z.string().uuid() }))
      .output(messageOutputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await revokeApiKey(input.workspaceId, ctx.user.id, input.keyId);
          return { message: "API key revoked" };
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),

  tools: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        try {
          return {
            tools: await workspaceTools.listTools(input.workspaceId, ctx.user.id),
            catalog: workspaceTools.TOOL_CATALOG,
          };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    create: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          name: z.string().min(1).max(80),
          kind: z.enum(["query_graph", "find_callers", "graph_stats"]),
          description: z.string().max(300).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceTools.createTool(input.workspaceId, ctx.user.id, input);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    setVisibility: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          toolId: z.string().uuid(),
          visibility: z.enum(["private", "workspace"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceTools.setToolVisibility(input.workspaceId, ctx.user.id, input.toolId, input.visibility);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    revoke: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), toolId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceTools.revokeTool(input.workspaceId, ctx.user.id, input.toolId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    execute: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          toolId: z.string().uuid(),
          args: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await workspaceTools.callTool(input.workspaceId, ctx.user.id, input.toolId, input.args);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    audit: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        try {
          return await workspaceTools.listAudit(input.workspaceId, ctx.user.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),
});
