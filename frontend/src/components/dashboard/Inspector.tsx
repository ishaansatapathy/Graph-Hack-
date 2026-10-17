"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Circle, Code2, FlaskConical, Loader2, Route, Wrench, X } from "lucide-react";
import { useState } from "react";
import { Glyph } from "@/components/ui/glyph";
import { EmptyState } from "@/components/ui/state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AGENT_STYLE } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { hunk, lineDiff } from "@/lib/diff";
import { NODE_KIND_LABEL } from "@/lib/glyphs";
import type { Agent, CodeFile, EvidencePath, FixProposal, GraphNode, TestRun } from "@/lib/types";
import { CodeTab } from "./CodeTab";

export type InspectorTab = "evidence" | "tests" | "fix" | "code";

const EASE = [0.16, 1, 0.3, 1] as const;
const HOP_MS = 650; // matches graph trace speed

export function Inspector({
  tab,
  onTab,
  nodes,
  agents,
  evidence,
  tests,
  fix,
  files,
  selectedNode,
  onSelectNode,
}: {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  nodes: GraphNode[];
  agents: Agent[];
  evidence: EvidencePath | null;
  tests: TestRun[];
  fix: FixProposal | null;
  files: CodeFile[];
  selectedNode: GraphNode | null;
  onSelectNode: (id: string) => void;
}) {
  const failing = tests.filter((t) => t.status === "fail" && !tests.some((r) => r.phase === "reverify" && r.testNodeId === t.testNodeId && r.status === "pass")).length;

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-surface-1">
      <NodeStrip node={selectedNode} agents={agents} />
      <Tabs value={tab} onValueChange={(v) => onTab(v as InspectorTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="evidence">
            <Route size={13} strokeWidth={1.5} /> Evidence
            {evidence && <Dot className="bg-conflict" />}
          </TabsTrigger>
          <TabsTrigger value="tests">
            <FlaskConical size={13} strokeWidth={1.5} /> Tests
            {failing > 0 && <span className="font-mono text-[10.5px] text-conflict">{failing}</span>}
          </TabsTrigger>
          <TabsTrigger value="fix">
            <Wrench size={13} strokeWidth={1.5} /> Fix
            {fix && <Dot className={fix.status === "verified" ? "bg-pass" : "bg-accent"} />}
          </TabsTrigger>
          <TabsTrigger value="code">
            <Code2 size={13} strokeWidth={1.5} /> Code
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evidence" className="overflow-y-auto">
          <EvidenceTab evidence={evidence} nodes={nodes} onSelectNode={onSelectNode} />
        </TabsContent>
        <TabsContent value="tests" className="overflow-y-auto">
          <TestsTab tests={tests} />
        </TabsContent>
        <TabsContent value="fix" className="overflow-y-auto">
          <FixTab fix={fix} tests={tests} agents={agents} onOpenCode={() => onTab("code")} />
        </TabsContent>
        <TabsContent value="code" className="flex flex-col" forceMount hidden={tab !== "code"}>
          <CodeTab files={files} fix={fix} selectedNode={selectedNode} agents={agents} active={tab === "code"} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={cn("size-1.5 rounded-full", className)} />;
}

function NodeStrip({ node, agents }: { node: GraphNode | null; agents: Agent[] }) {
  const agent = node?.agentId ? agents.find((a) => a.id === node.agentId) : undefined;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-4">
      {node ? (
        <>
          <Glyph kind={node.kind} size={13} className={agent ? AGENT_STYLE[agent.slot].text : "text-fg-2"} filled={node.kind === "change"} />
          <span className="truncate font-mono text-[12px] text-fg">{node.label}</span>
          <span className="text-[11px] text-fg-3">{NODE_KIND_LABEL[node.kind]}</span>
          <span className="ml-auto font-mono text-[10.5px] tabular text-fg-3" title="Betweenness centrality">
            c={node.centrality.toFixed(2)}
          </span>
        </>
      ) : (
        <span className="eyebrow">Inspector</span>
      )}
    </div>
  );
}

/* --------------------------------- Evidence --------------------------------- */

function EvidenceTab({ evidence, nodes, onSelectNode }: { evidence: EvidencePath | null; nodes: GraphNode[]; onSelectNode: (id: string) => void }) {
  const [showQuery, setShowQuery] = useState(false);
  if (!evidence)
    return (
      <EmptyState
        icon={<Route size={16} strokeWidth={1.5} />}
        title="No conflict traced yet"
        body="When two pending changes collide, SYNK runs evidence_path and shows the shortest chain that explains why."
      />
    );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="p-4">
      <p className="eyebrow !text-conflict">Contract drift · {evidence.hops.length - 1} hops</p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg">{evidence.summary}</p>
      <button onClick={() => setShowQuery((x) => !x)} className="mt-3 text-[11.5px] text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg-2">
        {showQuery ? "Hide" : "Show"} Cypher query
      </button>
      <AnimatePresence initial={false}>
        {showQuery && (
          <motion.pre
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-fg-2"
          >
            {evidence.cypher}
          </motion.pre>
        )}
      </AnimatePresence>

      <ol className="mt-5">
        {evidence.hops.map((h, i) => {
          const n = byId.get(h.nodeId);
          if (!n) return null;
          const last = i === evidence.hops.length - 1;
          return (
            <motion.li
              key={h.nodeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (i * HOP_MS) / 1000, duration: 0.45, ease: EASE }}
              className="relative pl-7"
            >
              {!last && (
                <motion.span
                  className="absolute bottom-0 left-[6px] top-[18px] w-px origin-top bg-conflict/50"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: (i * HOP_MS + 200) / 1000, duration: HOP_MS / 1000, ease: EASE }}
                />
              )}
              <span className="absolute left-0 top-[3px] grid size-[13px] place-items-center text-conflict">
                <Glyph kind={n.kind} size={13} filled={n.kind === "change"} />
              </span>
              <button onClick={() => onSelectNode(n.id)} className="group block w-full pb-4 text-left">
                {h.relation && <span className="mb-0.5 block font-mono text-[10px] tracking-wider text-fg-3">{h.relation}</span>}
                <span className="font-mono text-[12.5px] text-fg group-hover:text-accent">{n.label}</span>
                {n.path && <span className="ml-2 font-mono text-[10.5px] text-fg-3">{n.path}:{n.line}</span>}
                <span className="mt-1 block text-[12px] leading-relaxed text-fg-2">{h.why}</span>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------------------------- Tests ---------------------------------- */

function TestIcon({ status }: { status: TestRun["status"] }) {
  switch (status) {
    case "queued":
      return <Circle size={13} strokeWidth={1.5} className="text-fg-3" />;
    case "running":
      return <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-risk motion-reduce:animate-none" />;
    case "pass":
      return <Check size={13} strokeWidth={2} className="text-pass" />;
    case "fail":
      return <X size={13} strokeWidth={2} className="text-conflict" />;
  }
}

function TestsTab({ tests }: { tests: TestRun[] }) {
  if (tests.length === 0)
    return (
      <EmptyState
        icon={<FlaskConical size={16} strokeWidth={1.5} />}
        title="No targeted tests yet"
        body="tests_for_path selects only the tests that cover the evidence path — not the full suite."
      />
    );
  const groups = [
    { phase: "detect" as const, title: "On merged main", sub: "Selected by tests_for_path" },
    { phase: "reverify" as const, title: "Re-verify after fix", sub: "Same tests, patched branch" },
  ];
  return (
    <div className="space-y-5 p-4">
      {groups.map((g) => {
        const list = tests.filter((t) => t.phase === g.phase);
        if (!list.length) return null;
        const pass = list.filter((t) => t.status === "pass").length;
        return (
          <section key={g.phase}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[12.5px] font-medium text-fg">{g.title}</h3>
              <span className="font-mono text-[11px] tabular text-fg-3">
                {pass}/{list.length} pass
              </span>
            </div>
            <p className="text-[11.5px] text-fg-3">{g.sub}</p>
            <ul className="mt-2.5 space-y-1.5">
              {list.map((t) => (
                <motion.li
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className={cn("rounded-[var(--radius-control)] border bg-surface-2 px-3 py-2 transition-colors duration-500", t.status === "fail" ? "border-conflict/35" : t.status === "pass" ? "border-pass/20" : "border-line")}
                >
                  <div className="flex items-center gap-2.5">
                    <TestIcon status={t.status} />
                    <span className="truncate font-mono text-[12px] text-fg">{t.name}</span>
                    <span className="ml-auto font-mono text-[10.5px] tabular text-fg-3">{t.durationMs != null ? `${t.durationMs}ms` : t.status}</span>
                  </div>
                  {t.message && (
                    <pre className="mt-2 whitespace-pre-wrap border-t border-line pt-2 font-mono text-[11px] leading-relaxed text-conflict/90">{t.message}</pre>
                  )}
                </motion.li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ----------------------------------- Fix ----------------------------------- */

const FIX_STEPS: FixProposal["status"][] = ["proposed", "applied", "verifying", "verified"];

function FixTab({ fix, tests, agents, onOpenCode }: { fix: FixProposal | null; tests: TestRun[]; agents: Agent[]; onOpenCode: () => void }) {
  if (!fix)
    return (
      <EmptyState
        icon={<Wrench size={16} strokeWidth={1.5} />}
        title="No fix proposed yet"
        body="Once the failure is traced, SYNK proposes the smallest patch on the lower-centrality side and re-runs the same tests."
      />
    );
  const agent = agents.find((a) => a.id === fix.agentId);
  const lines = hunk(lineDiff(fix.original, fix.modified));
  const idx = FIX_STEPS.indexOf(fix.status);
  const re = tests.filter((t) => t.phase === "reverify");

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-fg-3">{fix.id}</span>
        {agent && <span className={cn("font-mono text-[11px]", AGENT_STYLE[agent.slot].text)}>→ {agent.branch}</span>}
      </div>
      <h3 className="mt-1 text-[14px] font-medium tracking-tight text-fg">{fix.title}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-2">{fix.rationale}</p>

      <ol className="mt-4 grid grid-cols-4 gap-1">
        {FIX_STEPS.map((s, i) => (
          <li key={s} className="space-y-1.5">
            <span className="block h-[2px] overflow-hidden rounded-full bg-surface-4">
              <motion.span
                className={cn("block h-full origin-left", fix.status === "verified" ? "bg-pass" : "bg-accent")}
                initial={false}
                animate={{ scaleX: i <= idx ? 1 : 0 }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </span>
            <span className={cn("block text-[11px] capitalize", i <= idx ? "text-fg-2" : "text-fg-3")}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-2">
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
          <span className="font-mono text-[11px] text-fg-2">{fix.file}</span>
          <Button size="sm" variant="ghost" className="-mr-2 h-6" onClick={onOpenCode}>
            <Code2 size={12} strokeWidth={1.5} /> Open diff
          </Button>
        </div>
        <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-[19px]">
          {lines.map((l, i) =>
            l === null ? (
              <div key={i} className="px-3 text-fg-3">⋯</div>
            ) : (
              <div
                key={i}
                className={cn(
                  "grid grid-cols-[28px_14px_1fr] whitespace-pre px-1",
                  l.type === "add" && "bg-pass/[0.08] text-fg",
                  l.type === "del" && "bg-conflict/[0.08] text-fg-2",
                  l.type === "same" && "text-fg-3",
                )}
              >
                <span className="pr-2 text-right tabular text-fg-3/70">{l.b ?? l.a}</span>
                <span className={l.type === "add" ? "text-pass" : l.type === "del" ? "text-conflict" : ""}>{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
                <span>{l.text}</span>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="eyebrow">Re-verify</p>
        {re.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-fg-3">Waiting for the fix to be applied.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {re.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 font-mono text-[12px]">
                <TestIcon status={t.status} />
                <span className="text-fg-2">{t.name}</span>
              </li>
            ))}
          </ul>
        )}
        <AnimatePresence>
          {fix.status === "verified" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-pass/25 bg-pass/[0.07] px-3 py-2 text-[12.5px] text-pass"
            >
              <Check size={14} strokeWidth={2} /> Verified — merge unblocked
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
