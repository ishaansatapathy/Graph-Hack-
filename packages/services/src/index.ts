export { env, getGoogleOAuthConfig, isGoogleOAuthConfigured } from "./env";
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
export * as agentMemory from "./graph/memory";
export * as graphChunks from "./graph/chunks";
export { triggerSync, syncDb } from "./sync";
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

// ── Conflict ──────────────────────────────────────────────────────────────
export { notifyNewConflicts } from "./conflict/notify";
export { detectConflicts, markConflictResolved, type ConflictRecord } from "./conflict/detect";
export { resolveConflict, type ResolveResult } from "./conflict/resolve";
