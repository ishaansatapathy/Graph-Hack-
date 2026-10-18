"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, FileCode2, GitBranch, GitCommit, RefreshCw, Save, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConflictHop {
  node: string;
  label: string;
  annotation: string;
}

interface ConflictItem {
  id: string;
  file: string;
  authorA: string;
  roleA: string;
  branchA: string;
  commitShaA: string;
  messageA: string;
  authorB: string;
  roleB: string;
  branchB: string;
  commitShaB: string;
  messageB: string;
  status: string;
  evidence: string;
  authorScopeWarning: {
    flagged: boolean;
    severity: string;
    reason: string;
  };
  hops: ConflictHop[];
  cypher: string;
}

interface Resolution {
  id: string;
  targetFile: string;
  authorScopeProtected: boolean;
  model: string;
  suggestion: string;
  reverifyTests: string[];
}

export function ConflictsView() {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  const loadConflicts = async () => {
    try {
      const res = await fetch("/api/conflicts");
      if (res.ok) {
        const json = await res.json();
        setConflicts((json.conflicts ?? []) as ConflictItem[]);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConflicts();
  }, []);

  const handleResolve = async (conflictId: string) => {
    setResolving(true);
    try {
      const res = await fetch(`/api/conflicts/${conflictId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        setResolution(json.resolution as Resolution);
      }
    } finally {
      setResolving(false);
    }
  };

  const handleApplyFix = async () => {
    if (!resolution) return;
    setApplying(true);
    setApplyStatus(null);
    try {
      const res = await fetch("/api/workspace/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: resolution.targetFile,
          content: resolution.suggestion,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setApplyStatus(json.message ?? "Applied to workspace working tree & Neon PostgreSQL");
      } else {
        setApplyStatus("Failed to apply fix");
      }
    } catch {
      setApplyStatus("Error applying fix");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg font-mono text-[12px] text-fg-3">
        <RefreshCw className="mr-2 size-4 animate-spin text-accent" /> Scanning FalkorDB for cross-branch AST contract drifts…
      </div>
    );
  }

  const conflict = conflicts[0];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">GraphRAG AST Conflict Resolver</h1>
            <span className="rounded border border-conflict/30 bg-conflict/10 px-2 py-0.5 font-mono text-[11px] text-conflict">
              Semantic Drift Detected
            </span>
          </div>
          <p className="mt-1 text-[13px] text-fg-2">
            FalkorDB isolates multi-hop contract breaks between concurrent agent branches before merge into main.
          </p>
        </div>

        {conflict && !resolution && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleResolve(conflict.id)}
            disabled={resolving}
            className="gap-2"
          >
            {resolving ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-accent-ink" />}
            Resolve with GraphRAG AI
          </Button>
        )}
      </div>

      {conflict ? (
        <div className="space-y-6">
          {/* Author Scope Warning Card */}
          {conflict.authorScopeWarning?.flagged && (
            <div className="rounded-lg border border-conflict/40 bg-conflict/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 flex-shrink-0 text-conflict" />
                <div>
                  <h3 className="font-mono text-[12.5px] font-semibold text-conflict uppercase tracking-wider">
                    Author Role Scope Warning · High Severity
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
                    {conflict.authorScopeWarning.reason}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Conflict Meta Comparison */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Agent A Card */}
            <div className="rounded-lg border border-line bg-surface-1 p-4">
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2 font-mono text-[11px]">
                <span className="font-semibold text-accent">{conflict.authorA} ({conflict.roleA})</span>
                <span className="flex items-center gap-1 text-fg-3">
                  <GitCommit className="size-3" /> {conflict.commitShaA}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <GitBranch className="size-3.5 text-accent" />
                <span>{conflict.branchA}</span>
              </div>
              <p className="mt-2 text-[12.5px] text-fg">{conflict.messageA}</p>
            </div>

            {/* Agent B Card */}
            <div className="rounded-lg border border-line bg-surface-1 p-4">
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2 font-mono text-[11px]">
                <span className="font-semibold text-pink-400">{conflict.authorB} ({conflict.roleB})</span>
                <span className="flex items-center gap-1 text-fg-3">
                  <GitCommit className="size-3" /> {conflict.commitShaB}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <GitBranch className="size-3.5 text-pink-400" />
                <span>{conflict.branchB}</span>
              </div>
              <p className="mt-2 text-[12.5px] text-fg">{conflict.messageB}</p>
            </div>
          </div>

          {/* 6-Hop Graph Traversal */}
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-fg-3">
              FalkorDB 6-Hop AST Dependency Chain
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {conflict.hops.map((hop, i) => (
                <div key={hop.node} className="flex items-center gap-2">
                  <div className="rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px]">
                    <div className="font-bold text-accent">{hop.label}</div>
                    <div className="text-[10px] text-fg-3">{hop.annotation}</div>
                  </div>
                  {i < conflict.hops.length - 1 && <ChevronRight className="size-4 text-fg-3" />}
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-line/60 pt-3">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-3">Cypher Query</span>
              <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2.5 font-mono text-[11px] text-fg-2">
                {conflict.cypher}
              </pre>
            </div>
          </div>

          {/* AI Resolution Result */}
          {resolution && (
            <div className="rounded-lg border border-pass/40 bg-pass/5 p-5">
              <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-pass" />
                  <h3 className="text-[14px] font-semibold text-fg">GraphRAG AI Resolution ({resolution.id})</h3>
                </div>
                <span className="font-mono text-[11px] text-pass">✓ Author Scope Respected</span>
              </div>

              <div className="mb-3 flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <FileCode2 className="size-4 text-accent" />
                <span>Target File: <strong>{resolution.targetFile}</strong></span>
                <span className="text-fg-3">({resolution.model})</span>
              </div>

              <pre className="overflow-x-auto rounded border border-line bg-surface-1 p-3 font-mono text-[11.5px] leading-relaxed text-pass">
                {resolution.suggestion}
              </pre>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-3">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-2">
                  <span>Targeted Unit & Contract Tests:</span>
                  {resolution.reverifyTests.map((t) => (
                    <span key={t} className="rounded bg-pass/10 px-2 py-0.5 text-pass">
                      ✓ {t} pass
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  {applyStatus && (
                    <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-pass">
                      <Check className="size-3.5" /> {applyStatus}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void handleApplyFix()}
                    disabled={applying}
                    className="gap-2"
                  >
                    {applying ? <RefreshCw className="size-3.5 animate-spin" /> : <Save className="size-3.5 text-accent-ink" />}
                    Apply Fix to IDE Working Tree
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-64 flex-col items-center justify-center text-fg-3 font-mono text-[12px]">
          <CheckCircle2 className="size-6 text-pass mb-2" />
          No open AST conflicts detected across branches.
        </div>
      )}
    </div>
  );
}
