"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "~/lib/trpc";

type RepoFile = { path: string; size: number };
type OpenFile = { path: string; sha: string; branch: string; content: string };
type FileListing = { branch: string; truncated: boolean; skippedLargeFiles: number; files: RepoFile[] };
type BranchInfo = { name: string; protected: boolean };
type SharedDraft = { content: string; version: number; updatedAt: string | null; updatedByUserId: string | null };

export function IdePanel() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [branch, setBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchListTruncated, setBranchListTruncated] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [listingNotice, setListingNotice] = useState("");
  const [activeFile, setActiveFile] = useState<OpenFile | null>(null);
  const [content, setContent] = useState("");
  const [baseContent, setBaseContent] = useState("");
  const [draftVersion, setDraftVersion] = useState(0);
  const [newerDraft, setNewerDraft] = useState<Pick<SharedDraft, "content" | "version"> | null>(null);
  const [draftSyncStatus, setDraftSyncStatus] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [newPath, setNewPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingPullRequest, setOpeningPullRequest] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const draftVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const activeDraftPathRef = useRef("");
  const draftSaveInFlightRef = useRef(false);
  const sharedDraftContentRef = useRef("");

  const loadFiles = useCallback(async (id: string, selectedBranch: string) => {
    const listing = await trpc.workspace.githubFiles.list.query({ workspaceId: id, branch: selectedBranch }) as FileListing;
    setFiles(listing.files);
    setBranch(listing.branch);
    setListingNotice([
      listing.truncated ? "Showing the first 2,000 files." : "",
      listing.skippedLargeFiles ? `${listing.skippedLargeFiles} files over 1 MB are not editable here.` : "",
    ].filter(Boolean).join(" "));
    return listing;
  }, []);

  useEffect(() => {
    let disposed = false;
    void trpc.workspace.current.query({}).then(async (workspace) => {
      if (disposed) return;
      setWorkspaceId(workspace.id);
      try {
        const [edit, branchInfo] = await Promise.all([
          trpc.workspace.githubFiles.editBranch.mutate({ workspaceId: workspace.id }),
          trpc.workspace.githubFiles.branches.query({ workspaceId: workspace.id }),
        ]);
        setEditBranch(edit.branch);
        setDefaultBranch(branchInfo.defaultBranch);
        setBranches(branchInfo.branches as BranchInfo[]);
        setBranchListTruncated(branchInfo.truncated);
        await loadFiles(workspace.id, edit.branch);
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load GitHub repository" });
      } finally {
        if (!disposed) setLoading(false);
      }
    }).catch((error) => {
      if (!disposed) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load workspace" });
        setLoading(false);
      }
    });
    return () => { disposed = true; };
  }, [loadFiles]);

  const dirty = content !== baseContent;
  dirtyRef.current = dirty;
  activeDraftPathRef.current = activeFile?.path ?? "";
  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [files, filter]);
  const selectableBranches = useMemo(() => {
    const all = [...branches];
    for (const name of [defaultBranch, editBranch]) {
      if (name && !all.some((item) => item.name === name)) all.push({ name, protected: false });
    }
    return all;
  }, [branches, defaultBranch, editBranch]);

  async function openFile(path: string) {
    if (!workspaceId) return;
    if (dirty && !window.confirm("Discard your unsaved edits and open another file?")) return;
    setMessage(null);
    try {
      const file = await trpc.workspace.githubFiles.read.query({ workspaceId, path, branch }) as OpenFile;
      const draft = await trpc.workspace.fileDrafts.get.query({
        workspaceId,
        path,
        baseContent: file.content,
      }) as SharedDraft;
      setActiveFile(file);
      setContent(draft.content);
      setBaseContent(file.content);
      sharedDraftContentRef.current = draft.content;
      draftVersionRef.current = draft.version;
      setDraftVersion(draft.version);
      setNewerDraft(null);
      setDraftSyncStatus(draft.version ? `Shared draft v${draft.version}` : "No shared draft yet");
      setCommitMessage(`Update ${path.split("/").pop()}`);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not open file" });
    }
  }

  // Persist edits as workspace drafts and poll for teammates' saved versions.
  useEffect(() => {
    if (!workspaceId || !activeFile || branch !== editBranch || !dirty || content === sharedDraftContentRef.current) return;
    const path = activeFile.path;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const saveDraft = () => {
      if (draftSaveInFlightRef.current) {
        retryTimer = setTimeout(saveDraft, 150);
        return;
      }
      draftSaveInFlightRef.current = true;
      void trpc.workspace.fileDrafts.save.mutate({
        workspaceId,
        path,
        content,
        expectedVersion: draftVersionRef.current,
      }).then((saved) => {
        if (activeDraftPathRef.current !== path) return;
        if (saved.version < draftVersionRef.current) return;
        draftVersionRef.current = saved.version;
        sharedDraftContentRef.current = content;
        setDraftVersion(saved.version);
        setNewerDraft(null);
        setDraftSyncStatus(`Shared draft v${saved.version} saved`);
      }).catch(async (error) => {
        if (activeDraftPathRef.current !== path) return;
        setDraftSyncStatus("A teammate saved at the same time. Your edits are still local.");
        try {
          const latest = await trpc.workspace.fileDrafts.get.query({
            workspaceId,
            path,
            baseContent: activeFile.content,
          }) as SharedDraft;
          if (activeDraftPathRef.current === path && latest.version > draftVersionRef.current) {
            setNewerDraft({ content: latest.content, version: latest.version });
          }
        } catch {
          // Keep the local buffer intact if the refresh also fails.
        }
        if (error instanceof Error) setMessage({ tone: "error", text: error.message });
      }).finally(() => { draftSaveInFlightRef.current = false; });
    };
    const timer = setTimeout(saveDraft, 700);
    return () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [workspaceId, activeFile, branch, editBranch, content, dirty]);

  useEffect(() => {
    if (!workspaceId || !activeFile || branch !== editBranch) return;
    let disposed = false;
    const poll = async () => {
      try {
        const latest = await trpc.workspace.fileDrafts.get.query({
          workspaceId,
          path: activeFile.path,
          baseContent: activeFile.content,
        }) as SharedDraft;
        if (disposed || latest.version <= draftVersionRef.current) return;
        if (dirtyRef.current) {
          setNewerDraft({ content: latest.content, version: latest.version });
          return;
        }
        draftVersionRef.current = latest.version;
        sharedDraftContentRef.current = latest.content;
        setDraftVersion(latest.version);
        setContent(latest.content);
        setNewerDraft(null);
        setDraftSyncStatus(`Loaded teammate draft v${latest.version}`);
      } catch {
        if (!disposed) setDraftSyncStatus("Shared draft sync is temporarily unavailable");
      }
    };
    const timer = setInterval(() => void poll(), 2_500);
    return () => { disposed = true; clearInterval(timer); };
  }, [workspaceId, activeFile, branch, editBranch]);

  function loadNewerDraft() {
    if (!newerDraft) return;
    draftVersionRef.current = newerDraft.version;
    sharedDraftContentRef.current = newerDraft.content;
    setDraftVersion(newerDraft.version);
    setContent(newerDraft.content);
    setNewerDraft(null);
    setDraftSyncStatus(`Loaded shared draft v${newerDraft.version}`);
    setMessage(null);
  }

  async function changeBranch(nextBranch: string) {
    if (!workspaceId || nextBranch === branch) return;
    if (dirty && !window.confirm("Discard your unsaved edits and switch branches?")) return;
    setActiveFile(null);
    setContent("");
    setBaseContent("");
    setCommitMessage("");
    setPullRequestUrl("");
    setMessage(null);
    try {
      await loadFiles(workspaceId, nextBranch);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load branch" });
    }
  }

  function startNewFile() {
    if (dirty && !window.confirm("Discard your unsaved edits and create a file?")) return;
    setNewPath("");
    setActiveFile(null);
    setContent("");
    setBaseContent("");
    setCommitMessage("Add file");
  }

  async function saveFile() {
    if (!workspaceId || !branch || branch !== editBranch || saving) return;
    const path = activeFile?.path ?? newPath.trim();
    if (!path) {
      setMessage({ tone: "error", text: "Enter a repository path before saving" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (activeFile) {
        if (draftSaveInFlightRef.current) throw new Error("Shared draft is still syncing. Try committing again in a moment.");
        draftSaveInFlightRef.current = true;
        try {
          const latest = await trpc.workspace.fileDrafts.get.query({
            workspaceId,
            path,
            baseContent: activeFile.content,
          }) as SharedDraft;
          sharedDraftContentRef.current = latest.content;
          if (latest.version > draftVersionRef.current && latest.content !== content) {
            setNewerDraft({ content: latest.content, version: latest.version });
            throw new Error("A teammate has newer edits. Load their draft before committing.");
          }
          if (latest.version > draftVersionRef.current) {
            draftVersionRef.current = latest.version;
            setDraftVersion(latest.version);
          }
          if (latest.content !== content) {
            const draft = await trpc.workspace.fileDrafts.save.mutate({
              workspaceId,
              path,
              content,
              expectedVersion: draftVersionRef.current,
            });
            draftVersionRef.current = draft.version;
            sharedDraftContentRef.current = content;
            setDraftVersion(draft.version);
          }
        } finally {
          draftSaveInFlightRef.current = false;
        }
      }
      const saved = await trpc.workspace.githubFiles.save.mutate({
        workspaceId,
        path,
        branch,
        content,
        sha: activeFile?.sha ?? null,
        message: commitMessage,
      });
      const nextFile: OpenFile = { path: saved.path, sha: saved.sha, branch: saved.branch, content };
      setActiveFile(nextFile);
      setBaseContent(content);
      setNewPath("");
      setMessage({ tone: "ok", text: `Committed to ${saved.branch}` });
      await loadFiles(workspaceId, branch);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "GitHub save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function createPullRequest() {
    if (!workspaceId || branch !== editBranch || dirty) return;
    setOpeningPullRequest(true);
    setMessage(null);
    try {
      const result = await trpc.workspace.githubFiles.pullRequest.mutate({
        workspaceId,
        branch,
        title: `Changes from ${branch}`,
        body: "Created from Stackfox Studio. Review the file diff and run the required checks before merging.",
      });
      setPullRequestUrl(result.url);
      setMessage({ tone: "ok", text: result.existing ? `Pull request #${result.number} already exists.` : `Pull request #${result.number} created.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not create pull request" });
    } finally {
      setOpeningPullRequest(false);
    }
  }

  if (loading) return <p className="app-muted">Loading the shared GitHub repository…</p>;

  return (
    <div
      className="ide-shell"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveFile();
        }
      }}
    >
      <div className="ide-topbar">
        <div className="ide-topbar-left">
          <span className="ide-logo">◈</span>
          <span className="ide-title">Stackfox Studio</span>
          <span className="ide-badge">GitHub workspace</span>
        </div>
        <div className="ide-topbar-actions">
          <button type="button" className="app-btn-ghost app-btn-small" onClick={startNewFile} disabled={!workspaceId || branch !== editBranch}>New file</button>
          <button type="button" className="app-btn-primary app-btn-small" onClick={() => void saveFile()} disabled={!dirty || branch !== editBranch || saving || (!activeFile && !newPath.trim())}>
            {saving ? "Committing…" : dirty ? "Commit changes" : "Saved"}
          </button>
          {branch === editBranch && branch !== defaultBranch ? (
            <button type="button" className="app-btn-ghost app-btn-small" onClick={() => void createPullRequest()} disabled={saving || openingPullRequest || dirty}>
              {openingPullRequest ? "Opening…" : dirty ? "Commit before PR" : "Open pull request"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="app-muted">Workspace drafts sync with teammates every 2.5 seconds. Commit when ready to save changes to your GitHub edit branch.</p>
      {message ? <p className={`app-flash app-flash--${message.tone === "ok" ? "ok" : "err"}`} role="status">{message.text}</p> : null}

      <div className="ide-main-grid">
        <aside className="ide-explorer">
          <div className="ide-explorer-header">
            <span>REPOSITORY</span>
            <span className="ide-file-count">{files.length}</span>
          </div>
          <div className="ide-explorer-footer">
            <label className="app-muted" htmlFor="ide-branch-select">Branch</label>
            <select id="ide-branch-select" className="app-input app-input-block" value={branch} onChange={(event) => void changeBranch(event.target.value)}>
              {selectableBranches.map((item) => (
                <option key={item.name} value={item.name}>{item.name}{item.name === defaultBranch ? " (default)" : item.protected ? " (protected)" : ""}</option>
              ))}
            </select>
            {branch === editBranch ? <span className="app-muted">Your editable branch</span> : <span className="app-muted">Read-only branch preview</span>}
          </div>
          {branchListTruncated ? <p className="app-muted">Showing only the first 100 GitHub branches.</p> : null}
          <input
            className="app-input app-input-block"
            aria-label="Filter repository files"
            placeholder="Find a file…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="ide-file-list">
            {listingNotice ? <p className="app-muted">{listingNotice}</p> : null}
            {visibleFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={`ide-file-item ${activeFile?.path === file.path ? "active" : ""}`}
                onClick={() => void openFile(file.path)}
                title={`${file.path} (${file.size} bytes)`}
              >
                <span className="ide-file-icon">{file.path.split(".").pop()?.slice(0, 3).toUpperCase() ?? "FILE"}</span>
                <span className="ide-file-name">{file.path}</span>
              </button>
            ))}
            {visibleFiles.length === 0 ? <p className="app-muted">No repository files match.</p> : null}
          </div>
          <div className="ide-explorer-footer">
            <span className="status-indicator-green" /> GitHub connected
          </div>
        </aside>

        <section className="ide-editor-container">
          <div className="ide-tabs-bar">
            <div className="ide-tab active">
              <span className="ide-tab-icon">{activeFile ? "TS" : "＋"}</span>
              <span className="ide-tab-title">{activeFile?.path ?? (newPath || "No file selected")}</span>
              {dirty ? <span aria-label="Unsaved changes"> ●</span> : null}
            </div>
          </div>
          {!activeFile && !commitMessage ? (
            <div className="app-empty-state">Choose a file from the repository or create a new one.</div>
          ) : null}
          {!activeFile && commitMessage ? (
            <input
              className="app-input app-input-block"
              placeholder="Path, e.g. src/api/handler.ts"
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
            />
          ) : null}
          <div className="ide-code-area">
            <div className="ide-line-numbers" aria-hidden="true">
              {content.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
            </div>
            <textarea
              className="ide-textarea"
              aria-label={activeFile ? `Edit ${activeFile.path}` : "New file content"}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              disabled={(!activeFile && !commitMessage) || branch !== editBranch}
            />
          </div>
          <div className="ide-statusbar">
            <div className="ide-statusbar-left">
              <span>{draftSyncStatus || `Draft v${draftVersion}`}</span>
              {newerDraft ? <button type="button" className="app-btn-ghost app-btn-small" onClick={loadNewerDraft}>Load teammate draft v{newerDraft.version}</button> : null}
              <span>{content.split("\n").length} lines</span><span>·</span><span>{new TextEncoder().encode(content).length} bytes</span>
            </div>
            <div className="ide-statusbar-right">
              <input
                className="app-input"
                aria-label="Git commit message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
              />
            </div>
          </div>
          {pullRequestUrl ? <p className="app-flash app-flash--ok"><a href={pullRequestUrl} target="_blank" rel="noopener noreferrer">Open pull request on GitHub</a></p> : null}
        </section>
      </div>
    </div>
  );
}
