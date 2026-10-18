import * as workspaceDb from "./db";
import { decryptJson } from "./secrets";
import { UserError } from "../errors";

const GITHUB_API = "https://api.github.com";
const MAX_FILE_BYTES = 1_000_000;

type GithubConfig = { personalAccessToken?: string; repositoryFullName?: string };

async function getRepo(workspaceId: string) {
  const row = await workspaceDb.getIntegration(workspaceId, "github");
  if (!row) throw new UserError("Connect GitHub to browse this workspace repository");
  const config = decryptJson(row.config_encrypted) as GithubConfig;
  const token = config.personalAccessToken?.trim();
  const repository = config.repositoryFullName?.trim();
  const [owner, repo] = repository?.split("/") ?? [];
  if (
    !token || !repository || repository.length > 200 || !owner || !repo || owner === "." || owner === ".." || repo === "." || repo === ".." ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new UserError("GitHub repository and token are not configured");
  }
  return { token, repository };
}

async function githubRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 409 || response.status === 422) {
    throw new UserError("GitHub rejected this update. Reload the file; it may have changed on another branch.", "CONFLICT");
  }
  if (!response.ok) throw new UserError(`GitHub request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function validatePath(path: string) {
  if (
    !path || path.length > 500 || path.startsWith("/") || path.includes("\\") ||
    path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new UserError("Invalid repository file path");
  }
  return path.split("/").map(encodeURIComponent).join("/");
}

function validateBranch(branch: string) {
  if (!branch || branch.length > 255 || /[\s\x00-\x1f~^:?*\[]/.test(branch) || branch.startsWith("-") || branch.endsWith(".")) {
    throw new UserError("Invalid Git branch name");
  }
  return branch;
}

async function defaultBranch(token: string, repository: string) {
  const repo = await githubRequest<{ default_branch?: string }>(token, `/repos/${repository}`);
  if (!repo.default_branch) throw new UserError("GitHub repository has no default branch");
  return repo.default_branch;
}

export function workspaceEditBranchName(userId: string) {
  return `stackfox/user-${userId.replace(/-/g, "").slice(0, 12)}`;
}

async function branchRefSha(token: string, repository: string, branch: string): Promise<string | null> {
  try {
    const ref = await githubRequest<{ object?: { sha?: string } }>(
      token,
      `/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object?.sha ?? null;
  } catch (error) {
    if (error instanceof UserError && error.message.includes("(404)")) return null;
    throw error;
  }
}

export async function listGithubRepositoryBranches(workspaceId: string) {
  const { token, repository } = await getRepo(workspaceId);
  const base = await defaultBranch(token, repository);
  const branches = await githubRequest<Array<{ name: string; protected?: boolean }>>(
    token,
    `/repos/${repository}/branches?per_page=100`,
  );
  return {
    defaultBranch: base,
    truncated: branches.length === 100,
    branches: branches.map((item) => ({ name: item.name, protected: Boolean(item.protected) })),
  };
}

export async function ensureGithubEditBranch(workspaceId: string, userId: string) {
  const { token, repository } = await getRepo(workspaceId);
  const base = await defaultBranch(token, repository);
  const branch = workspaceEditBranchName(userId);
  if (await branchRefSha(token, repository, branch)) return { branch, defaultBranch: base };

  const baseSha = await branchRefSha(token, repository, base);
  if (!baseSha) throw new UserError("Could not find the repository default branch");
  try {
    await githubRequest(token, `/repos/${repository}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (error) {
    // A simultaneous first edit can create the same per-user branch. Re-read it before failing.
    if (!(error instanceof UserError) || !await branchRefSha(token, repository, branch)) throw error;
  }
  return { branch, defaultBranch: base };
}

export async function createGithubPullRequest(input: {
  workspaceId: string;
  userId: string;
  branch: string;
  title: string;
  body?: string;
}) {
  const expectedBranch = workspaceEditBranchName(input.userId);
  if (input.branch !== expectedBranch) throw new UserError("You can open a pull request only for your own workspace branch", "FORBIDDEN");
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new UserError("Pull request title is required");
  const { token, repository } = await getRepo(input.workspaceId);
  const base = await defaultBranch(token, repository);
  if (!(await branchRefSha(token, repository, input.branch))) throw new UserError("Your edit branch does not exist", "NOT_FOUND");
  const comparison = await githubRequest<{ ahead_by?: number }>(
    token,
    `/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(input.branch)}`,
  );
  if (!comparison.ahead_by) throw new UserError("There are no new commits to put in a pull request");

  const head = `${repository.split("/")[0]}:${input.branch}`;
  const query = new URLSearchParams({ state: "open", head, base });
  const existing = await githubRequest<Array<{ html_url: string; number: number }>>(
    token,
    `/repos/${repository}/pulls?${query.toString()}`,
  );
  if (existing[0]) return { url: existing[0].html_url, number: existing[0].number, existing: true };

  const created = await githubRequest<{ html_url: string; number: number }>(token, `/repos/${repository}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head: input.branch, base, body: input.body?.slice(0, 5_000) ?? "" }),
  });
  return { url: created.html_url, number: created.number, existing: false };
}

export async function listGithubRepositoryFiles(workspaceId: string, requestedBranch?: string) {
  const { token, repository } = await getRepo(workspaceId);
  const branch = validateBranch(requestedBranch || await defaultBranch(token, repository));
  const tree = await githubRequest<{
    truncated?: boolean;
    tree?: Array<{ path: string; type: string; size?: number }>
  }>(token, `/repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const blobs = (tree.tree ?? []).filter((entry) => entry.type === "blob");
  const readableFiles = blobs.filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES).slice(0, 2_000);
  return {
    branch,
    truncated: Boolean(tree.truncated) || readableFiles.length < blobs.filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES).length,
    skippedLargeFiles: blobs.length - blobs.filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES).length,
    files: readableFiles.map(({ path, size }) => ({ path, size: size ?? 0 })),
  };
}

export async function readGithubRepositoryFile(workspaceId: string, path: string, branch?: string) {
  const encodedPath = validatePath(path);
  const { token, repository } = await getRepo(workspaceId);
  const ref = validateBranch(branch || await defaultBranch(token, repository));
  const file = await githubRequest<{ type?: string; path?: string; sha?: string; size?: number; encoding?: string; content?: string }>(
    token,
    `/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  if (file.type !== "file" || !file.content || file.encoding !== "base64") {
    throw new UserError("GitHub did not return a readable file");
  }
  if ((file.size ?? 0) > MAX_FILE_BYTES) throw new UserError("File is larger than the 1 MB editor limit");
  const bytes = Buffer.from(file.content.replace(/\n/g, ""), "base64");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new UserError("File is larger than the 1 MB editor limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UserError("This file is not UTF-8 text and cannot be edited in the web IDE");
  }
  return {
    path: file.path ?? path,
    branch: ref,
    sha: file.sha ?? "",
    content: text,
  };
}

export async function saveGithubRepositoryFile(input: {
  workspaceId: string;
  userId: string;
  path: string;
  branch: string;
  content: string;
  sha: string | null;
  message: string;
  author: { name: string; email: string };
}) {
  const encodedPath = validatePath(input.path);
  const branch = validateBranch(input.branch);
  if (branch !== workspaceEditBranchName(input.userId)) {
    throw new UserError("Edits must be committed to your own workspace branch. Create a pull request to merge them.", "FORBIDDEN");
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) throw new UserError("File is larger than the 1 MB editor limit");
  const message = input.message.trim().slice(0, 200);
  if (!message) throw new UserError("Commit message is required");
  const { token, repository } = await getRepo(input.workspaceId);

  const body = await githubRequest<{ content?: { path?: string; sha?: string } }>(
    token,
    `/repos/${repository}/contents/${encodedPath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch,
        ...(input.sha ? { sha: input.sha } : {}),
        author: { name: input.author.name.slice(0, 100), email: input.author.email.slice(0, 254) },
        committer: { name: input.author.name.slice(0, 100), email: input.author.email.slice(0, 254) },
      }),
    },
  );
  return { path: body.content?.path ?? input.path, sha: body.content?.sha ?? "", branch };
}
