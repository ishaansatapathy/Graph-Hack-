"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Code2, Database, FileCode2, GitBranch, GitCommit, GitPullRequest, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { apiFetch, errorMessage, NoticeBar, useResource, ViewError, ViewLoading, type Notice, type OpenTab } from "./shared";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-surface-1 font-mono text-[12px] text-fg-3">Loading editor…</div>,
});

interface RepoInfo {
  connected: boolean;
  repository: string | null;
  defaultBranch: string | null;
  editBranch: string;
  branches: { name: string; protected: boolean }[];
}

interface FileList {
  branch: string;
  truncated: boolean;
  skippedLargeFiles: number;
  files: { path: string; size: number }[];
}

interface OpenFile {
  path: string;
  branch: string;
  sha: string;
  original: string;
  content: string;
  draft: { content: string; version: number; updatedAt: string | null } | null;
  draftVersion: number;
}

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", html: "html", py: "python", go: "go", rs: "rust",
  java: "java", rb: "ruby", sh: "shell", yml: "yaml", yaml: "yaml", sql: "sql", c: "c", h: "c", cpp: "cpp",
};
const languageOf = (path: string) => LANG[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

const DEFAULT_CYPHER = `MATCH (c:Change)-[:MODIFIES]->(f:File)
RETURN c.branch AS branch, f.path AS file
LIMIT 25`;

export function IdeView({ onOpenTab }: { onOpenTab?: OpenTab }) {
  const repo = useResource<RepoInfo>("/api/workspace/repo");

  if (repo.state.status === "loading") return <ViewLoading label="Loading repository…" />;
  if (repo.state.status === "error") return <ViewError title="Couldn't load the repository" error={repo.state.error} onRetry={() => repo.reload(false)} />;

  const info = repo.state.data;
  if (!info.connected || !info.repository || !info.defaultBranch) {
    return (
      <div className="h-full bg-bg">
        <EmptyState
          icon={<GitBranch size={16} strokeWidth={1.5} />}
          title="Connect a GitHub repository"
          body="The IDE edits the workspace's GitHub repository. Changes are committed to your own branch, and you open a pull request when ready."
          action={onOpenTab && <Button size="sm" variant="primary" onClick={() => onOpenTab("integrations")}>Open Integrations</Button>}
        />
      </div>
    );
  }
  return <Editor info={info as RepoInfo & { repository: string; defaultBranch: string }} />;
}

function Editor({ info }: { info: RepoInfo & { repository: string; defaultBranch: string } }) {
  const [branch, setBranch] = useState(info.defaultBranch);
  const files = useResource<FileList>(`/api/workspace/files?branch=${encodeURIComponent(branch)}`);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "commit" | "pr" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [commitMessage, setCommitMessage] = useState("");

  const [cypher, setCypher] = useState(DEFAULT_CYPHER);
  const [cypherOut, setCypherOut] = useState<string | null>(null);
  const [runningCypher, setRunningCypher] = useState(false);

  const visible = useMemo(() => {
    if (files.state.status !== "ready") return [];
    const q = filter.trim().toLowerCase();
    return (q ? files.state.data.files.filter((f) => f.path.toLowerCase().includes(q)) : files.state.data.files).slice(0, 500);
  }, [files.state, filter]);

  const openFile = async (path: string) => {
    setOpening(path);
    setNotice(null);
    try {
      const f = await apiFetch<{ path: string; branch: string; sha: string; content: string; draft: OpenFile["draft"] }>(
        `/api/workspace/files/content?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`,
      );
      setOpen({ ...f, original: f.content, draftVersion: f.draft?.version ?? 0 });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setOpening(null);
    }
  };

  const saveDraft = async () => {
    if (!open) return;
    setBusy("draft");
    try {
      const saved = await apiFetch<{ version: number }>("/api/workspace/files/draft", {
        method: "POST",
        body: { path: open.path, content: open.content, expectedVersion: open.draftVersion },
      });
      setOpen({ ...open, draftVersion: saved.version, draft: { content: open.content, version: saved.version, updatedAt: new Date().toISOString() } });
      setNotice({ tone: "ok", text: `Draft saved for your workspace (version ${saved.version}).` });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!open || !commitMessage.trim()) return;
    setBusy("commit");
    try {
      const saved = await apiFetch<{ branch: string; sha: string }>("/api/workspace/files/commit", {
        method: "POST",
        body: { path: open.path, content: open.content, message: commitMessage.trim() },
      });
      setNotice({ tone: "ok", text: `Committed ${open.path} to ${saved.branch}.` });
      setCommitMessage("");
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const openPullRequest = async () => {
    const title = window.prompt(`Pull request title (${info.editBranch} → ${info.defaultBranch})`);
    if (!title?.trim()) return;
    setBusy("pr");
    try {
      const pr = await apiFetch<{ url: string; number: number; existing: boolean }>("/api/workspace/pull-request", { method: "POST", body: { title: title.trim() } });
      setNotice({ tone: "ok", text: `${pr.existing ? "Pull request already open" : "Opened pull request"} #${pr.number}: ${pr.url}` });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const runCypher = async () => {
    setRunningCypher(true);
    try {
      const r = await apiFetch<{ rows: unknown[]; durationMs: number; cypher: string }>("/api/graph/cypher", { method: "POST", body: { cypher } });
      setCypherOut(`// ${r.rows.length} rows · ${r.durationMs}ms\n${JSON.stringify(r.rows, null, 2)}`);
    } catch (err) {
      setCypherOut(`// ${errorMessage(err)}`);
    } finally {
      setRunningCypher(false);
    }
  };

  const dirty = open ? open.content !== (open.draft?.content ?? open.original) : false;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg font-sans text-fg">
      <div className="flex h-11 items-center justify-between gap-3 border-b border-line bg-surface-1 px-4">
        <div className="flex min-w-0 items-center gap-3 font-mono text-[11.5px]">
          <span className="truncate text-fg-2">{info.repository}</span>
          <span className="h-4 w-px bg-line-strong" />
          <GitBranch className="size-3.5 shrink-0 text-accent" />
          <select
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setOpen(null);
            }}
            aria-label="Branch"
            className="rounded border border-line bg-surface-2 px-2.5 py-1 text-fg focus:border-accent focus:outline-none"
          >
            {info.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.name === info.defaultBranch ? " (default)" : ""}
              </option>
            ))}
          </select>
          <span className="hidden text-fg-3 xl:inline">commits go to {info.editBranch}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void openPullRequest()} disabled={busy === "pr"} className="shrink-0 gap-1.5">
          <GitPullRequest className="size-3.5" /> {busy === "pr" ? "Opening…" : "Open pull request"}
        </Button>
      </div>

      {notice && (
        <div className="px-4 pt-3">
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface-1/70 font-mono text-[12px]">
          <div className="p-3 pb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              aria-label="Filter files"
              className="w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] text-fg focus:border-accent focus:outline-none"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {files.state.status === "loading" && <p className="px-2 text-[11px] text-fg-3">Loading files…</p>}
            {files.state.status === "error" && <p className="px-2 text-[11px] text-conflict">{files.state.error.message}</p>}
            {files.state.status === "ready" && visible.length === 0 && <p className="px-2 text-[11px] text-fg-3">No matching files.</p>}
            {visible.map((f) => (
              <button
                key={f.path}
                onClick={() => void openFile(f.path)}
                title={f.path}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11.5px] transition-colors ${
                  open?.path === f.path ? "bg-surface-3 font-medium text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                }`}
              >
                <FileCode2 className="size-3.5 shrink-0 text-fg-3" />
                <span className="truncate">{opening === f.path ? "Opening…" : f.path}</span>
              </button>
            ))}
            {files.state.status === "ready" && (files.state.data.truncated || files.state.data.files.length > visible.length) && (
              <p className="mt-2 px-2 text-[10.5px] text-fg-3">Showing {visible.length} of {files.state.data.files.length} files — filter to narrow.</p>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {open ? (
            <>
              <div className="flex h-10 items-center justify-between gap-3 border-b border-line bg-surface-1 px-3">
                <div className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-fg">
                  <Code2 className="size-3.5 shrink-0 text-accent" />
                  <span className="truncate">{open.path}</span>
                  {dirty && <span className="text-risk">●</span>}
                  {open.draft && open.content !== open.draft.content && (
                    <button onClick={() => setOpen({ ...open, content: open.draft!.content })} className="shrink-0 text-[11px] text-accent hover:underline">
                      load saved draft v{open.draft.version}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void saveDraft()} disabled={busy === "draft"} className="gap-1.5">
                    <Save className="size-3.5" /> {busy === "draft" ? "Saving…" : "Save draft"}
                  </Button>
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commit();
                    }}
                  >
                    <input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message"
                      aria-label="Commit message"
                      required
                      className="h-7 w-48 rounded border border-line bg-surface-2 px-2 font-mono text-[11.5px] text-fg focus:border-accent focus:outline-none"
                    />
                    <Button size="sm" variant="primary" type="submit" disabled={busy === "commit"} className="gap-1.5">
                      <GitCommit className="size-3.5 text-accent-ink" /> {busy === "commit" ? "Committing…" : "Commit"}
                    </Button>
                  </form>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <MonacoEditor
                  height="100%"
                  language={languageOf(open.path)}
                  theme="vs-dark"
                  value={open.content}
                  onChange={(v) => v !== undefined && setOpen((o) => (o ? { ...o, content: v } : o))}
                  options={{ fontSize: 12.5, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12, bottom: 12 }, automaticLayout: true }}
                />
              </div>
            </>
          ) : (
            <EmptyState icon={<FileCode2 size={16} strokeWidth={1.5} />} title="Open a file" body={`Pick a file from ${branch} to view and edit it.`} />
          )}

          <div className="flex h-60 shrink-0 flex-col border-t border-line bg-surface-1">
            <div className="flex h-9 items-center justify-between border-b border-line bg-surface-2/60 px-3">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-accent">
                <Database className="size-3.5" /> Cypher (read-only, this workspace&apos;s graph)
              </span>
              <Button size="sm" variant="primary" onClick={() => void runCypher()} disabled={runningCypher} className="h-6 gap-1.5 text-[11px]">
                <Play className="size-3 text-accent-ink" /> {runningCypher ? "Running…" : "Run"}
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2">
              <textarea
                value={cypher}
                onChange={(e) => setCypher(e.target.value)}
                aria-label="Cypher query"
                spellCheck={false}
                className="resize-none border-r border-line bg-surface-2 p-2.5 font-mono text-[11.5px] text-accent focus:outline-none"
              />
              <pre className="overflow-auto bg-surface-1 p-2.5 font-mono text-[11px] text-fg-2">{cypherOut ?? "// Run a query to see rows from FalkorDB"}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
