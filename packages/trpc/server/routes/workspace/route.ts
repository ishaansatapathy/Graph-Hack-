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
import { mapServiceError, protectedProcedure, router } from "../../trpc";
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
    .query(({ ctx }) => {
      try {
        return getOrCreateWorkspaceForUser(ctx.user.id, ctx.user.fullName, ctx.user.email);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  list: protectedProcedure.query(({ ctx }) => {
    try {
      return workspaceMembers.listWorkspacesForUser(ctx.user.id);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  setActive: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      try {
        workspaceMembers.setActiveWorkspace(ctx.user.id, input.workspaceId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  members: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        try {
          return workspaceMembers.listMembers(input.workspaceId, ctx.user.id);
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
      .mutation(({ ctx, input }) => {
        try {
          return workspaceMembers.inviteMember(input.workspaceId, ctx.user.id, input.email, input.role);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    cancelInvite: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), inviteId: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        try {
          return workspaceMembers.cancelInvite(input.workspaceId, ctx.user.id, input.inviteId);
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
      .mutation(({ ctx, input }) => {
        try {
          return workspaceMembers.setMemberRole(input.workspaceId, ctx.user.id, input.userId, input.role);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        try {
          return workspaceMembers.removeMember(input.workspaceId, ctx.user.id, input.userId);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),

  integrations: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(z.array(integrationSummarySchema))
      .query(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return workspaceIntegrations.listIntegrationSummaries(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    githubOnboarding: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(z.object({ webhookUrl: z.string() }))
      .query(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return getGithubOnboarding(input.workspaceId);
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
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
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
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          workspaceIntegrations.upsertJira(input.workspaceId, input);
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
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          workspaceIntegrations.upsertSlack(input.workspaceId, input);
          return { message: "Slack connected" };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), provider: providerSchema }))
      .output(messageOutputSchema)
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          workspaceIntegrations.removeIntegration(input.workspaceId, input.provider);
          return { message: "Integration removed" };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testGithub: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return workspaceIntegrations.testGithub(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testJira: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return workspaceIntegrations.testJira(input.workspaceId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testSlack: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .output(testResultSchema)
      .mutation(({ ctx, input }) => {
        try {
          assertWorkspaceMember(input.workspaceId, ctx.user.id);
          return workspaceIntegrations.testSlack(input.workspaceId);
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
      .query(({ ctx, input }) => {
        try {
          return listApiKeys(input.workspaceId, ctx.user.id);
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
      .mutation(({ ctx, input }) => {
        try {
          return createApiKey(input.workspaceId, ctx.user.id, input.name);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    revokeApiKey: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), keyId: z.string().uuid() }))
      .output(messageOutputSchema)
      .mutation(({ ctx, input }) => {
        try {
          revokeApiKey(input.workspaceId, ctx.user.id, input.keyId);
          return { message: "API key revoked" };
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),

  tools: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        try {
          return {
            tools: workspaceTools.listTools(input.workspaceId, ctx.user.id),
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
      .mutation(({ ctx, input }) => {
        try {
          return workspaceTools.createTool(input.workspaceId, ctx.user.id, input);
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
      .mutation(({ ctx, input }) => {
        try {
          return workspaceTools.setToolVisibility(input.workspaceId, ctx.user.id, input.toolId, input.visibility);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    revoke: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), toolId: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        try {
          return workspaceTools.revokeTool(input.workspaceId, ctx.user.id, input.toolId);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    call: protectedProcedure
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
      .query(({ ctx, input }) => {
        try {
          return workspaceTools.listAudit(input.workspaceId, ctx.user.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),
});
