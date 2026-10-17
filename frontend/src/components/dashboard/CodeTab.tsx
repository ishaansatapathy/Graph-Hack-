"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { FileCode2 } from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui/state";
import { AGENT_STYLE } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { alpha, readTokens } from "@/lib/tokens";
import type { Agent, CodeFile, FixProposal, GraphNode } from "@/lib/types";

const DiffEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="space-y-2.5 p-4">
      {[70, 52, 84, 40, 66, 58, 76].map((w, i) => (
        <div key={i} style={{ width: `${w}%` }}>
          <Skeleton className="h-3" />
        </div>
      ))}
    </div>
  );
}

interface Entry {
  key: string;
  label: string;
  sub: string;
  agentId: string;
  file: CodeFile;
}

function defineTheme(monaco: Monaco) {
  const t = readTokens();
  const hex = (v: string) => v.replace("#", "");
  const themeData: Parameters<Monaco["editor"]["defineTheme"]>[1] = {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: hex(t.fg) },
      { token: "comment", foreground: hex(t["fg-3"]), fontStyle: "italic" },
      { token: "keyword", foreground: hex(t["fg-2"]) },
      { token: "string", foreground: hex(t["agent-c"]) },
      { token: "number", foreground: hex(t["agent-c"]) },
      { token: "type", foreground: hex(t["agent-a"]) },
      { token: "identifier", foreground: hex(t.fg) },
      { token: "delimiter", foreground: hex(t["fg-3"]) },
    ],
    colors: {
      "editor.background": t["surface-1"],
      "editor.foreground": t.fg,
      "editorLineNumber.foreground": alpha(t["fg-3"], 0.7),
      "editorLineNumber.activeForeground": t["fg-2"],
      "editor.lineHighlightBackground": alpha(t["surface-3"], 0.6),
      "editor.lineHighlightBorder": alpha(t.bg, 0),
      "editor.selectionBackground": alpha(t.accent, 0.2),
      "editorCursor.foreground": t.accent,
      "editorGutter.background": t["surface-1"],
      "diffEditor.insertedTextBackground": alpha(t.pass, 0.16),
      "diffEditor.removedTextBackground": alpha(t.conflict, 0.16),
      "diffEditor.insertedLineBackground": alpha(t.pass, 0.07),
      "diffEditor.removedLineBackground": alpha(t.conflict, 0.07),
      "diffEditor.border": t.line,
      "scrollbarSlider.background": alpha(t.fg, 0.08),
      "scrollbarSlider.hoverBackground": alpha(t.fg, 0.14),
      "editorWidget.background": t["surface-2"],
      "editorWidget.border": t["line-strong"],
    },
  };
  monaco.editor.defineTheme("stackfox", themeData);
  monaco.editor.defineTheme("synk", themeData);
}

export function CodeTab({ files, fix, selectedNode, agents, active }: { files: CodeFile[]; fix: FixProposal | null; selectedNode: GraphNode | null; agents: Agent[]; active: boolean }) {
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = files.map((f) => ({ key: f.path, label: f.path, sub: f.changeId, agentId: f.agentId, file: f }));
    if (fix) {
      const base = files.find((f) => f.path === fix.file);
      list.push({
        key: `${fix.id}:${fix.file}`,
        label: fix.file,
        sub: fix.id,
        agentId: fix.agentId,
        file: { path: fix.file, agentId: fix.agentId, changeId: fix.id, language: fix.language, original: fix.original, modified: fix.modified, anchors: base?.anchors ?? [] },
      });
    }
    return list;
  }, [files, fix]);

  const [current, setCurrent] = useState<string | null>(null);
  const [flagLine, setFlagLine] = useState<number | null>(null);
  const [mounted, setMounted] = useState(0);
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const decos = useRef<editor.IEditorDecorationsCollection | null>(null);

  // Jump to the flagged line of whichever file anchors the clicked node.
  const [seenNode, setSeenNode] = useState<GraphNode | null>(null);
  if (selectedNode !== seenNode) {
    setSeenNode(selectedNode);
    const hit = selectedNode && [...entries].reverse().find((e) => e.file.anchors.some((a) => a.nodeId === selectedNode.id));
    if (hit) {
      setCurrent(hit.key);
      setFlagLine(hit.file.anchors.find((a) => a.nodeId === selectedNode.id)!.line);
    }
  }

  const entry = entries.find((e) => e.key === current) ?? entries[0];

  useEffect(() => {
    const ed = diffRef.current?.getModifiedEditor();
    if (!ed || !flagLine || !active) return;
    const id = window.setTimeout(() => {
      ed.revealLineInCenter(flagLine);
      decos.current?.clear();
      decos.current = ed.createDecorationsCollection([
        { range: { startLineNumber: flagLine, startColumn: 1, endLineNumber: flagLine, endColumn: 1 }, options: { isWholeLine: true, className: "synk-flag-line", linesDecorationsClassName: "synk-flag-gutter" } },
      ]);
    }, 120);
    return () => window.clearTimeout(id);
  }, [flagLine, entry?.key, active, mounted]);

  if (!entries.length)
    return <EmptyState icon={<FileCode2 size={16} strokeWidth={1.5} />} title="No diffs" body="Pending changes from agents show up here as read-only diffs." />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {entries.map((e) => {
          const ag = agents.find((a) => a.id === e.agentId);
          const sel = e.key === entry.key;
          return (
            <button
              key={e.key}
              onClick={() => {
                setCurrent(e.key);
                setFlagLine(null);
                decos.current?.clear();
              }}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-left transition-colors", sel ? "border-line-strong bg-surface-3" : "border-transparent hover:bg-surface-2")}
            >
              <span className={cn("size-1.5 rounded-full", ag ? AGENT_STYLE[ag.slot].dot : "bg-fg-3")} />
              <span className={cn("font-mono text-[11px]", sel ? "text-fg" : "text-fg-2")}>{e.label.split("/").pop()}</span>
              <span className="font-mono text-[10px] text-fg-3">{e.sub}</span>
            </button>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center justify-between px-4 py-1.5">
        <span className="font-mono text-[11px] text-fg-3">{entry.file.path}</span>
        <span className="text-[11px] text-fg-3">read-only</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {active && (
          <DiffEditor
            key={entry.key}
            original={entry.file.original}
            modified={entry.file.modified}
            language={entry.file.language}
            theme="stackfox"
            beforeMount={defineTheme}
            onMount={(ed) => {
              const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
              if (mono) ed.updateOptions({ fontFamily: `${mono}, ui-monospace, monospace` });
              diffRef.current = ed;
              decos.current = null;
              setMounted((n) => n + 1); // re-run the reveal effect against the new editor
            }}
            loading={<EditorSkeleton />}
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: false,
              minimap: { enabled: false },
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              lineHeight: 19,
              scrollBeyondLastLine: false,
              renderOverviewRuler: false,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: false,
              padding: { top: 8 },
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              renderIndicators: true,
              contextmenu: false,
            }}
          />
        )}
      </div>
    </div>
  );
}
