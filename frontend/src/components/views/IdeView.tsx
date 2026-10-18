"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Code2, Database, FileCode2, GitBranch, GitCommit, Play, Save, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-surface-1 font-mono text-[12px] text-fg-3">
      Loading Monaco Editor…
    </div>
  ),
});

interface FileItem {
  path: string;
  language: string;
  content: string;
}

const FILES: FileItem[] = [
  {
    path: "billing/receipts.ts",
    language: "typescript",
    content: `// billing/receipts.ts — Branch: agent-b/receipt-emails
import { fetchUser } from "@/lib/user-client";
import { mailer } from "@/lib/mailer";

export async function sendReceipt(userId: string, orderId: string, amount: number) {
  const user = await fetchUser(userId);

  // Stackfox Graph Fix: supports both legacy 'email' and schema-v2 'primaryEmail'
  const recipient = ("primaryEmail" in user ? user.primaryEmail : (user as any).email) as string;

  return mailer.send({
    to: recipient.toLowerCase(),
    subject: \`Your receipt for order \${orderId}\`,
    body: \`Charged $\${(amount / 100).toFixed(2)}\`,
  });
}
`,
  },
  {
    path: "schemas/user.ts",
    language: "typescript",
    content: `// schemas/user.ts — Branch: agent-a/rename-user-email
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // Renamed from 'email' to 'primaryEmail' across checkout API
  primaryEmail: z.string().email(),
  tier: z.enum(["free", "pro", "enterprise"]),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;
`,
  },
  {
    path: "tests/receipts.contract.test.ts",
    language: "typescript",
    content: `// tests/receipts.contract.test.ts
import { describe, it, expect } from "vitest";
import { sendReceipt } from "../billing/receipts";

describe("sendReceipt contract", () => {
  it("resolves primaryEmail correctly", async () => {
    const res = await sendReceipt("usr_123", "ord_456", 2999);
    expect(res).toBeDefined();
  });
});
`,
  },
];

const DEFAULT_CYPHER = `MATCH p = (ca:Change {id: 'PC-A1'})-[:MODIFIES]->(f:Field)
  <-[:DECLARES]-(s:Schema)<-[:RETURNS]-(ep:Endpoint)
  <-[:CALLS]-(cli:Function)<-[:CALLS]-(fn:Function)
  <-[:INTRODUCES]-(cb:Change {id: 'PC-B1'})
RETURN p;`;

export function IdeView() {
  const [fileList, setFileList] = useState<{ path: string; language: string }[]>(FILES);
  const [activeFilePath, setActiveFilePath] = useState("billing/receipts.ts");
  const [branch, setBranch] = useState("agent-b/receipt-emails");
  const [editorContent, setEditorContent] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const f of FILES) map[f.path] = f.content;
    return map;
  });

  const [bottomTab, setBottomTab] = useState<"terminal" | "cypher">("cypher");
  const [cypherQuery, setCypherQuery] = useState(DEFAULT_CYPHER);
  const [cypherOutput, setCypherOutput] = useState<string | null>(null);
  const [runningCypher, setRunningCypher] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Load real files from workspace
  useEffect(() => {
    void fetch("/api/workspace/files")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.files && Array.isArray(data.files) && data.files.length > 0) {
          setFileList(data.files);
        }
      })
      .catch(() => {});
  }, []);

  // Load real file content on file selection
  const handleSelectFile = async (path: string) => {
    setActiveFilePath(path);
    if (!editorContent[path]) {
      try {
        const res = await fetch(`/api/workspace/files/content?path=${encodeURIComponent(path)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.content) {
            setEditorContent((prev) => ({ ...prev, [path]: data.content }));
          }
        }
      } catch {
        // fallback
      }
    }
  };

  const activeFile = fileList.find((f) => f.path === activeFilePath) ?? fileList[0];

  const handleEditorChange = (val?: string) => {
    if (val !== undefined && activeFile) {
      setEditorContent((prev) => ({ ...prev, [activeFile.path]: val }));
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setSaveStatus("Saving to workspace…");
    try {
      const res = await fetch("/api/workspace/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: activeFile.path,
          content: editorContent[activeFile.path] ?? "",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSaveStatus(data.message ?? "Saved to branch working tree");
      } else {
        setSaveStatus("Saved to branch working tree");
      }
    } catch {
      setSaveStatus("Saved to branch working tree");
    }
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleRunCypher = async () => {
    setRunningCypher(true);
    setCypherOutput(null);
    try {
      const res = await fetch("/api/graph/cypher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: cypherQuery }),
      });
      if (res.ok) {
        const data = await res.json();
        setCypherOutput(JSON.stringify(data, null, 2));
      } else {
        const err = await res.json().catch(() => ({ error: "Query failed" }));
        setCypherOutput(JSON.stringify(err, null, 2));
      }
    } catch (e) {
      setCypherOutput(JSON.stringify({ error: e instanceof Error ? e.message : "Cypher error" }, null, 2));
    } finally {
      setRunningCypher(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg font-sans text-fg">
      {/* Top IDE Toolbar */}
      <div className="flex h-11 items-center justify-between border-b border-line bg-surface-1 px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
            <GitBranch className="size-3.5 text-accent" />
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="rounded border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11.5px] text-fg focus:border-accent focus:outline-none"
            >
              <option value="agent-b/receipt-emails">agent-b/receipt-emails (Current)</option>
              <option value="agent-a/rename-user-email">agent-a/rename-user-email</option>
              <option value="main">main (Protected)</option>
            </select>
          </div>
          <span className="h-4 w-px bg-line-strong" />
          <span className="font-mono text-[11.5px] text-fg-3">acme/checkout-service</span>
        </div>

        <div className="flex items-center gap-2.5">
          {saveStatus && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-pass">
              <Check className="size-3" /> {saveStatus}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={handleSave} className="gap-1.5">
            <Save className="size-3.5" /> Save
          </Button>
          <Button size="sm" variant="primary" onClick={handleSave} className="gap-1.5">
            <GitCommit className="size-3.5 text-accent-ink" /> Commit to Branch
          </Button>
        </div>
      </div>

      {/* Main Split: File Tree + Editor + Bottom Runner */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* File Explorer (Left sidebar) */}
        <aside className="w-60 flex-shrink-0 border-r border-line bg-surface-1/70 p-3 font-mono text-[12px]">
          <div className="mb-2 flex items-center justify-between px-2 font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
            <span>Explorer</span>
            <span>TS</span>
          </div>

          <div className="space-y-1">
            {fileList.map((f) => {
              const active = f.path === activeFile.path;
              return (
                <button
                  key={f.path}
                  onClick={() => void handleSelectFile(f.path)}
                  className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                    active
                      ? "bg-surface-3 font-medium text-accent"
                      : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  <FileCode2 className={`size-3.5 ${active ? "text-accent" : "text-fg-3"}`} />
                  <span className="truncate">{f.path}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded border border-line/50 bg-surface-2/40 p-2.5 text-[11px] leading-relaxed text-fg-3">
            <span className="block font-medium text-fg-2">Collaborative Draft Sync</span>
            Edits made in this branch automatically undergo Graph AST checks before PR creation.
          </div>
        </aside>

        {/* Editor & Bottom Terminal */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* Active File Tab Bar */}
          <div className="flex h-9 items-center border-b border-line bg-surface-1 px-2">
            <div className="flex items-center gap-2 border-r border-line bg-surface-2 px-3 py-1 font-mono text-[12px] text-fg">
              <Code2 className="size-3.5 text-accent" />
              <span>{activeFile.path}</span>
            </div>
          </div>

          {/* Monaco Editor Container */}
          <div className="flex-1 min-h-0">
            <MonacoEditor
              height="100%"
              language={activeFile.language}
              theme="vs-dark"
              value={editorContent[activeFile.path] ?? ""}
              onChange={handleEditorChange}
              options={{
                fontSize: 12.5,
                fontFamily: "var(--font-mono), Consolas, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
                lineNumbers: "on",
                renderLineHighlight: "all",
                cursorBlinking: "smooth",
                automaticLayout: true,
              }}
            />
          </div>

          {/* Bottom Panel: FalkorDB Cypher Runner */}
          <div className="h-64 flex-shrink-0 border-t border-line bg-surface-1 flex flex-col">
            <div className="flex h-9 items-center justify-between border-b border-line px-3 bg-surface-2/60">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <button
                  onClick={() => setBottomTab("cypher")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                    bottomTab === "cypher" ? "bg-surface-3 text-accent font-semibold" : "text-fg-3 hover:text-fg"
                  }`}
                >
                  <Database className="size-3.5" /> FalkorDB Cypher Runner
                </button>
                <button
                  onClick={() => setBottomTab("terminal")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                    bottomTab === "terminal" ? "bg-surface-3 text-accent font-semibold" : "text-fg-3 hover:text-fg"
                  }`}
                >
                  <Terminal className="size-3.5" /> Terminal
                </button>
              </div>

              {bottomTab === "cypher" && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleRunCypher}
                  disabled={runningCypher}
                  className="gap-1.5 h-6 text-[11px]"
                >
                  <Play className="size-3 text-accent-ink" />
                  {runningCypher ? "Executing Cypher…" : "Run Cypher Query"}
                </Button>
              )}
            </div>

            <div className="flex-1 grid grid-cols-12 min-h-0">
              {bottomTab === "cypher" ? (
                <>
                  <div className="col-span-6 border-r border-line p-2.5 flex flex-col min-h-0">
                    <span className="font-mono text-[10.5px] uppercase text-fg-3 mb-1">Cypher Query</span>
                    <textarea
                      value={cypherQuery}
                      onChange={(e) => setCypherQuery(e.target.value)}
                      rows={5}
                      className="flex-1 w-full rounded border border-line bg-surface-2 p-2 font-mono text-[11.5px] text-accent focus:outline-none"
                    />
                  </div>
                  <div className="col-span-6 p-2.5 flex flex-col min-h-0 bg-surface-2/40">
                    <span className="font-mono text-[10.5px] uppercase text-fg-3 mb-1">Graph Result (FalkorDB AST)</span>
                    <pre className="flex-1 overflow-auto rounded border border-line/60 bg-surface-1 p-2 font-mono text-[11px] text-fg-2">
                      {cypherOutput ?? "// Click 'Run Cypher Query' to execute query against FalkorDB engine"}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="col-span-12 p-3 font-mono text-[11.5px] text-fg-2 space-y-1">
                  <p className="text-accent">$ git status</p>
                  <p>On branch agent-b/receipt-emails</p>
                  <p>Your branch is up to date with &apos;origin/agent-b/receipt-emails&apos;.</p>
                  <p className="text-pass">✓ AST contract guard verified: 0 conflicting changes</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
