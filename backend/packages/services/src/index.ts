export { env, getGoogleOAuthConfig, isGoogleOAuthConfigured, getGithubOAuthConfig, isGithubOAuthConfigured } from "./env";
export { default as AuthService } from "./auth";
export { default as UserService } from "./user";
export { AuthError, toAuthError } from "./auth/errors";
export { UserError } from "./errors";
export { authUserSchema, messageOutputSchema } from "./auth/model";
export { getAuthenticationMethodOutputSchema } from "./user/model";
export { sanitizeRedirectPath } from "./auth/safe-redirect";
export {
  getOrCreateWorkspaceForUser,
  assertWorkspaceMember,
  assertWorkspaceAdmin,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  workspaceIntegrations,
  workspaceTools,
  workspaceMembers,
  handleGithubPush,
  getGithubWebhookSecretForWorkspace,
  getGithubOnboarding,
} from "./workspace";
export { githubWebhookUrl, getApiPublicUrl } from "./integrations/config";
export * as graphEngine from "./graph/engine";
export { graphRagAnswer } from "./graph/rag";
export { fileInsight } from "./graph/advanced";
export { answerWorkspaceQuestion, type WorkspaceAnswer } from "./graph/ask";
export * as agentMemory from "./graph/memory";
export * as graphChunks from "./graph/chunks";
export { isGraphEngineActive, checkFalkorDbConnection } from "./graph/falkordb";
export { triggerSync, startIntegrationSyncWorker, syncDb } from "./sync";
export { githubPushPayloadSchema } from "./github/push-schema";
export { verifyGithubSignature } from "./github/verify";
export type { WorkspacePublic } from "./workspace";

// ── AI ────────────────────────────────────────────────────────────────────
export {
  complete,
  completeWithGraphContext,
  classifyTask,
  modelForTask,
  checkRateLimit,
  type Message,
  type CompletionResult,
  type TaskComplexity,
} from "./ai/router";
export { checkDeviceQuota, getDeviceUsage } from "./ai/fingerprint";

// ── Live dashboard ────────────────────────────────────────────────────────
export * as live from "./live";

// ── Conflict ──────────────────────────────────────────────────────────────
export { notifyNewConflicts } from "./conflict/notify";
export { detectConflicts, type ConflictRecord } from "./conflict/detect";
export { scanGithubConflicts } from "./conflict/github-scan";
export { resolveConflict, type ResolveResult } from "./conflict/resolve";

export {
  checkDatabaseHealth,
  runDatabaseHousekeeping,
  withDbRetry,
  classifyDbError,
  withDbErrorHandling,
  getWorkspaceAiUsage,
} from "./db";
export { db, schema } from "./db/client";
export { graphRead } from "./graph/falkordb";
export { eq, and, desc, sql } from "drizzle-orm";
export { authenticateApiKey, claimGithubWebhookDelivery, finishGithubWebhookDelivery } from "./db";
export { reserveApiKeyRequest } from "./db";
export {
  listGithubRepositoryFiles,
  listGithubRepositoryBranches,
  workspaceEditBranchName,
  ensureGithubEditBranch,
  readGithubRepositoryFile,
  saveGithubRepositoryFile,
  createGithubPullRequest,
} from "./workspace/github-files";
export {
  listWorkspaceServices,
  createWorkspaceService,
  removeWorkspaceService,
  callWorkspaceService,
  type ServiceMethod,
} from "./workspace/deployments";
export { getWorkspaceFileDraft, saveWorkspaceFileDraft } from "./workspace/drafts";
export { encryptJson, decryptJson, maskSecret } from "./workspace/secrets";
export { sendInviteEmail } from "./email";

