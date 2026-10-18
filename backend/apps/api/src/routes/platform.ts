import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  AuthService,
  answerWorkspaceQuestion,
  UserError,
  assertWorkspaceAdmin,
  callWorkspaceService,
  checkDatabaseHealth,
  checkDeviceQuota,
  checkFalkorDbConnection,
  createGithubPullRequest,
  createWorkspaceService,
  ensureGithubEditBranch,
  getApiPublicUrl,
  getOrCreateWorkspaceForUser,
  getWorkspaceAiUsage,
  getWorkspaceFileDraft,
  graphEngine,
  graphRead,
  isGraphEngineActive,
  listGithubRepositoryBranches,
  listGithubRepositoryFiles,
  listWorkspaceServices,
  readGithubRepositoryFile,
  removeWorkspaceService,
  resolveConflict,
  saveGithubRepositoryFile,
  saveWorkspaceFileDraft,
  scanGithubConflicts,
  syncDb,
  triggerSync,
  workspaceEditBranchName,
  workspaceIntegrations,
  workspaceMembers,
  workspaceTools,
  type ConflictRecord,
  type ServiceMethod,
  type WorkspacePublic,
} from "@stackfox/services";

/** REST API behind the dashboard's IDE, Vault, Integrations, Workspace and
    Conflicts views. Every route requires a session and acts only on the
    signed-in user's workspace, through the same services the tRPC API uses. */
export const platformRouter = Router();

const authService = new AuthService();

type SessionUser = NonNullable<Awaited<ReturnType<AuthService["resolveSession"]>>>;
type Ctx = { user: SessionUser; workspace: WorkspacePublic; workspaceId: string };

const STATUS: Record<UserError["code"], number> = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 };

function sendError(res: Response, error: unknown, exposeMessages: boolean) {
  if (res.headersSent) return;
  if (error instanceof UserError) {
    res.status(STATUS[error.code]).json({ error: error.message, code: error.code });
  } else if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request", code: "BAD_REQUEST" });
  } else if (exposeMessages && error instanceof Error) {
    // Integration setup errors are validation messages about the user's own input.
    res.status(400).json({ error: error.message, code: "BAD_REQUEST" });
  } else {
    console.error("[platform]", error);
    res.status(500).json({ error: "Something went wrong. Try again.", code: "INTERNAL" });
  }
}

/** Resolves the session and workspace, runs the handler, and JSON-encodes its result. */
function route(handler: (req: Request, ctx: Ctx) => Promise<unknown>, opts: { exposeMessages?: boolean } = {}) {
  return async (req: Request, res: Response) => {
    try {
      const user = await authService.resolveSession(req, res);
      if (!user) {
        res.status(401).json({ error: "Sign in to use this workspace", code: "UNAUTHORIZED" });
        return;
      }
      const workspace = await getOrCreateWorkspaceForUser(user.id, user.fullName, user.email);
      const result = await handler(req, { user, workspace, workspaceId: workspace.id });
      if (!res.headersSent) res.json(result);
    } catch (error) {
      sendError(res, error, Boolean(opts.exposeMessages));
    }
  };
}

const str = (v: unknown) => (v == null ? "" : String(v));

// ── Workspace: roster, invites, usage, infrastructure ────────────────────────

platformRouter.get(
  "/api/workspace",
  route(async (_req, { user, workspace, workspaceId }) => {
    const [roster, usage, dbHealth, falkor, graph] = await Promise.all([
      workspaceMembers.listMembers(workspaceId, user.id),
      getWorkspaceAiUsage(workspaceId),
      checkDatabaseHealth(),
      checkFalkorDbConnection(),
      graphEngine.getGraphStats(workspaceId),
    ]);
    return {
      workspace,
      currentUserId: user.id,
      members: roster.members,
      invites: roster.invites,
      usage,
      infrastructure: {
        database: { status: dbHealth.status, latencyMs: (dbHealth as { latencyMs?: number }).latencyMs ?? null },
        graph: { engine: falkor ? "falkordb" : isGraphEngineActive().engine, nodes: graph.nodeCount, edges: graph.relCount },
      },
    };
  }),
);

const inviteInput = z.object({ email: z.string().trim().email("Enter a valid email address"), role: z.enum(["admin", "member"]).default("member") });

platformRouter.post(
  "/api/workspace/invite",
  route(async (req, { user, workspaceId }) => {
    const input = inviteInput.parse(req.body ?? {});
    return workspaceMembers.inviteMember(workspaceId, user.id, input.email, input.role);
  }),
);

platformRouter.delete(
  "/api/workspace/invites/:id",
  route(async (req, { user, workspaceId }) => {
    await workspaceMembers.cancelInvite(workspaceId, user.id, String(req.params.id));
    return { ok: true };
  }),
);

// ── API Vault: shared services called through the server ─────────────────────

platformRouter.get(
  "/api/workspace/services",
  route(async (_req, { user, workspace, workspaceId }) => ({
    services: await listWorkspaceServices(workspaceId, user.id),
    canManage: workspace.role !== "member",
  })),
);

const serviceInput = z.object({
  name: z.string().trim().min(1, "Service name is required").max(80),
  baseUrl: z.string().trim().min(1, "Base URL is required"),
  accessToken: z.string().max(4000).optional(),
});

platformRouter.post(
  "/api/workspace/services",
  route(async (req, { user, workspaceId }) => {
    const input = serviceInput.parse(req.body ?? {});
    return { service: await createWorkspaceService({ workspaceId, userId: user.id, ...input }) };
  }),
);

platformRouter.delete(
  "/api/workspace/services/:id",
  route(async (req, { user, workspaceId }) => {
    await removeWorkspaceService(workspaceId, user.id, String(req.params.id));
    return { ok: true };
  }),
);

const callInput = z.object({
  method: z.string().trim().toUpperCase(),
  path: z.string().max(2000).default("/"),
  body: z.string().max(100_000).optional(),
});

platformRouter.post(
  "/api/workspace/services/:id/call",
  route(async (req, { user, workspaceId }) => {
    const input = callInput.parse(req.body ?? {});
    const started = Date.now();
    const response = await callWorkspaceService({
      workspaceId,
      userId: user.id,
      serviceId: String(req.params.id),
      method: input.method as ServiceMethod,
      path: input.path,
      body: input.body,
    });
    return { ...response, latencyMs: Date.now() - started };
  }),
);

// ── IDE: the workspace's GitHub repository, edited on a per-user branch ──────

platformRouter.get(
  "/api/workspace/repo",
  route(async (_req, { user, workspaceId }) => {
    const summaries = await workspaceIntegrations.listIntegrationSummaries(workspaceId);
    const github = summaries.find((s) => s.provider === "github");
    const repository = github?.maskedSecrets.repositoryFullName ?? null;
    if (!github?.configured || !repository) {
      return { connected: false, repository: null, defaultBranch: null, editBranch: workspaceEditBranchName(user.id), branches: [] };
    }
    const { defaultBranch, branches } = await listGithubRepositoryBranches(workspaceId);
    return { connected: true, repository, defaultBranch, editBranch: workspaceEditBranchName(user.id), branches };
  }),
);

platformRouter.get(
  "/api/workspace/files",
  route(async (req, { workspaceId }) => {
    const branch = typeof req.query.branch === "string" && req.query.branch ? req.query.branch : undefined;
    return listGithubRepositoryFiles(workspaceId, branch);
  }),
);

platformRouter.get(
  "/api/workspace/files/content",
  route(async (req, { user, workspaceId }) => {
    const path = str(req.query.path);
    if (!path) throw new UserError("Choose a file to open");
    const branch = typeof req.query.branch === "string" && req.query.branch ? req.query.branch : undefined;
    const file = await readGithubRepositoryFile(workspaceId, path, branch);
    const draft = await getWorkspaceFileDraft({ workspaceId, userId: user.id, path: file.path, baseContent: file.content });
    return { ...file, draft: draft.version > 0 ? draft : null };
  }),
);

const draftInput = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000),
  expectedVersion: z.number().int().min(0),
});

platformRouter.post(
  "/api/workspace/files/draft",
  route(async (req, { user, workspaceId }) => {
    const input = draftInput.parse(req.body ?? {});
    return saveWorkspaceFileDraft({ workspaceId, userId: user.id, ...input });
  }),
);

const commitInput = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000),
  message: z.string().trim().min(1, "Commit message is required").max(200),
});

/** Commits to the user's own edit branch (created from the default branch on first use). */
platformRouter.post(
  "/api/workspace/files/commit",
  route(async (req, { user, workspaceId }) => {
    const input = commitInput.parse(req.body ?? {});
    const { branch } = await ensureGithubEditBranch(workspaceId, user.id);
    let sha: string | null = null;
    try {
      sha = (await readGithubRepositoryFile(workspaceId, input.path, branch)).sha || null;
    } catch (error) {
      if (!(error instanceof UserError)) throw error; // new file on this branch
    }
    const saved = await saveGithubRepositoryFile({
      workspaceId,
      userId: user.id,
      path: input.path,
      branch,
      content: input.content,
      sha,
      message: input.message,
      author: { name: user.fullName, email: user.email },
    });
    return { ...saved, branch };
  }),
);

const prInput = z.object({ title: z.string().trim().min(1, "Pull request title is required").max(200), body: z.string().max(5000).optional() });

platformRouter.post(
  "/api/workspace/pull-request",
  route(async (req, { user, workspaceId }) => {
    const input = prInput.parse(req.body ?? {});
    return createGithubPullRequest({ workspaceId, userId: user.id, branch: workspaceEditBranchName(user.id), ...input });
  }),
);

// ── Graph: read-only Cypher against this workspace's graph ───────────────────

platformRouter.post(
  "/api/graph/cypher",
  route(async (req, { workspaceId }) => {
    const cypher = z.object({ cypher: z.string().trim().min(1, "Enter a Cypher query").max(5000) }).parse(req.body ?? {}).cypher;
    const started = Date.now();
    try {
      const result = await graphEngine.runReadOnlyCypher(workspaceId, cypher);
      return { ...result, durationMs: Date.now() - started };
    } catch (error) {
      // Read-only guard violations and Cypher syntax errors are about the user's query.
      throw new UserError(error instanceof Error ? error.message : "Query failed");
    }
  }),
);

// ── Graph: GraphRAG question answering ───────────────────────────────────────

platformRouter.post(
  "/api/graph/ask",
  route(async (req, { user, workspaceId }) => {
    const { question } = z.object({ question: z.string().trim().min(1, "Ask a question").max(1000) }).parse(req.body ?? {});
    const quota = await checkDeviceQuota(null, user.id);
    if (!quota.ok) {
      throw new UserError(quota.reason === "device_rpd"
        ? "Daily AI quota reached. Try again tomorrow."
        : "Too many questions at once. Please wait a moment.");
    }
    return answerWorkspaceQuestion(workspaceId, user.id, question);
  }),
);

// ── Conflicts: webhook commits (with GitHub diff evidence) + repo imports ────

type ConflictView = ConflictRecord & { source: "commits" | "import" };

async function listConflicts(workspaceId: string): Promise<ConflictView[]> {
  const [scanned, imported] = await Promise.all([
    scanGithubConflicts(workspaceId),
    graphRead(
      workspaceId,
      `MATCH (x:Conflict) WHERE x.status = 'open' AND x.a IS NOT NULL
       OPTIONAL MATCH (a:Change {id: x.a})
       OPTIONAL MATCH (b:Change {id: x.b})
       RETURN x.id AS id, x.file AS file,
              a.branch AS branchA, a.authors AS authorA, a.title AS messageA, a.headSha AS shaA,
              b.branch AS branchB, b.authors AS authorB, b.title AS messageB, b.headSha AS shaB
       LIMIT 50`,
    ),
  ]);
  return [
    ...scanned.map((c) => ({ ...c, source: "commits" as const })),
    ...imported.map((r) => ({
      id: str(r.id),
      file: str(r.file),
      authorA: str(r.authorA),
      commitShaA: str(r.shaA).slice(0, 8),
      messageA: str(r.messageA),
      branchA: str(r.branchA),
      authorB: str(r.authorB),
      commitShaB: str(r.shaB).slice(0, 8),
      messageB: str(r.messageB),
      branchB: str(r.branchB),
      status: "open" as const,
      evidence: "diff_unavailable" as const,
      source: "import" as const,
    })),
  ];
}

platformRouter.get(
  "/api/conflicts",
  route(async (_req, { workspaceId }) => ({ conflicts: await listConflicts(workspaceId) })),
);

platformRouter.post(
  "/api/conflicts/:id/resolve",
  route(async (req, { user, workspaceId }) => {
    const id = String(req.params.id);
    // The conflict is looked up server-side; the client only names it.
    const conflict = (await listConflicts(workspaceId)).find((c) => c.id === id);
    if (!conflict) throw new UserError("This conflict is no longer open", "NOT_FOUND");
    const fp = typeof req.body?.fp === "string" ? req.body.fp.slice(0, 512) : null;
    const quota = await checkDeviceQuota(fp, user.id);
    if (!quota.ok) throw new UserError("AI review quota reached for this device. Try again later.", "CONFLICT");
    const { source: _source, ...record } = conflict;
    return resolveConflict(workspaceId, record, user.id);
  }),
);

// ── Integrations: GitHub, Jira, Slack setup, sync runs, synced items, audit ──

platformRouter.get(
  "/api/integrations",
  route(async (_req, { workspace, workspaceId }) => {
    const [summaries, runs, issues, messages] = await Promise.all([
      workspaceIntegrations.listIntegrationSummaries(workspaceId),
      syncDb.listRuns(workspaceId, 10),
      graphRead(
        workspaceId,
        `MATCH (i:Issue) WHERE i.source = 'jira'
         RETURN i.key AS key, i.title AS title, i.status AS status, i.priority AS priority, i.url AS url
         ORDER BY i.key DESC LIMIT 20`,
      ),
      graphRead(
        workspaceId,
        `MATCH (m:SlackMessage)-[:POSTED_IN]->(c:SlackChannel)
         RETURN m.ts AS ts, m.text AS text, m.user AS user, m.url AS url, c.name AS channel
         ORDER BY m.ts DESC LIMIT 20`,
      ),
    ]);
    return {
      canManage: workspace.role !== "member",
      integrations: summaries,
      runs,
      jiraIssues: issues.map((r) => ({ key: str(r.key), title: str(r.title), status: str(r.status), priority: str(r.priority), url: str(r.url) })),
      slackMessages: messages.map((r) => ({ ts: str(r.ts), text: str(r.text), user: str(r.user), url: str(r.url), channel: str(r.channel) })),
    };
  }),
);

const githubInput = z.object({
  personalAccessToken: z.string().trim().max(500).optional(),
  repositoryFullName: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, "Repository must look like owner/name"),
});
const jiraInput = z.object({
  baseUrl: z.string().trim().min(1, "Jira site URL is required"),
  email: z.string().trim().email("Enter the Jira account email"),
  apiToken: z.string().trim().min(1, "Jira API token is required"),
});
const slackInput = z.object({
  webhookUrl: z.string().trim().startsWith("https://hooks.slack.com/", "Use a Slack incoming webhook URL (https://hooks.slack.com/…)"),
});
const providerParam = z.enum(["github", "jira", "slack"]);

platformRouter.post(
  "/api/integrations/:provider",
  route(
    async (req, { user, workspaceId }) => {
      const provider = providerParam.parse(req.params.provider);
      await assertWorkspaceAdmin(workspaceId, user.id);
      if (provider === "github") {
        const input = githubInput.parse(req.body ?? {});
        // GitHub can only deliver pushes to a public HTTPS API; locally the repo is still usable for browsing/importing.
        const publicApi = /^https:\/\//i.test(getApiPublicUrl()) && !/localhost|127\.0\.0\.1/i.test(getApiPublicUrl());
        const result = await workspaceIntegrations.upsertGithub(workspaceId, {
          ...input,
          registerWebhook: publicApi,
          generateWebhookSecret: publicApi,
          webhookOptional: true,
        });
        const hook = result.webhookRegistration;
        if (!hook) {
          return { message: "GitHub connected. Push events need a public HTTPS API_PUBLIC_URL, so no webhook was set up." };
        }
        return hook.ok
          ? { message: `GitHub connected · ${hook.message}` }
          : { ok: false, message: `GitHub connected, but the push webhook was not set up: ${hook.message}` };
      }
      if (provider === "jira") {
        await workspaceIntegrations.upsertJira(workspaceId, jiraInput.parse(req.body ?? {}));
        return { message: "Jira connected" };
      }
      await workspaceIntegrations.upsertSlack(workspaceId, slackInput.parse(req.body ?? {}));
      return { message: "Slack connected" };
    },
    { exposeMessages: true },
  ),
);

platformRouter.delete(
  "/api/integrations/:provider",
  route(async (req, { user, workspaceId }) => {
    const provider = providerParam.parse(req.params.provider);
    await assertWorkspaceAdmin(workspaceId, user.id);
    await workspaceIntegrations.removeIntegration(workspaceId, provider);
    return { ok: true };
  }),
);

platformRouter.post(
  "/api/integrations/:provider/test",
  route(async (req, { workspaceId }) => {
    const provider = providerParam.parse(req.params.provider);
    if (provider === "github") return workspaceIntegrations.testGithub(workspaceId);
    if (provider === "jira") return workspaceIntegrations.testJira(workspaceId);
    return workspaceIntegrations.testSlack(workspaceId);
  }),
);

platformRouter.post(
  "/api/integrations/:provider/sync",
  route(async (req, { workspaceId }) => {
    const provider = z.enum(["jira", "slack"]).parse(req.params.provider);
    const runId = await triggerSync(workspaceId, provider);
    return { runId, message: `${provider === "jira" ? "Jira" : "Slack"} sync started` };
  }),
);

platformRouter.get(
  "/api/integrations/audit-log",
  route(async (_req, { user, workspaceId }) => ({ logs: await workspaceTools.listAudit(workspaceId, user.id) })),
);
