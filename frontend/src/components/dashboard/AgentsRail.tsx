"use client";

import { GitBranch, History } from "lucide-react";
import { motion } from "motion/react";
import { Glyph } from "@/components/ui/glyph";
import { EmptyState, Skeleton } from "@/components/ui/state";
import { AGENT_STYLE, STATUS_STYLE } from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { Agent, ChangeStatus, Incident, ProposedChange } from "@/lib/types";
import { AskGraph } from "./AskGraph";

const CHANGE_STATUS: Record<ChangeStatus, { label: string; text: string }> = {
  pending: { label: "pending", text: "text-fg-3" },
  conflict: { label: "conflict", text: "text-conflict" },
  adapted: { label: "adapted", text: "text-pass" },
  verified: { label: "verified", text: "text-pass" },
};

export function AgentsRail({
  loading,
  agents,
  changes,
  incidents,
  selectedAgentId,
  pulses,
  onSelectAgent,
  onSelectNode,
}: {
  loading: boolean;
  agents: Agent[];
  changes: ProposedChange[];
  incidents: Incident[];
  selectedAgentId: string | null;
  pulses: Record<string, number>;
  onSelectAgent: (id: string | null) => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-surface-1">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="eyebrow">Agents</span>
        {selectedAgentId && (
          <button onClick={() => onSelectAgent(null)} className="text-[11.5px] text-fg-3 hover:text-fg-2">
            Clear focus
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 p-3">
          {loading &&
            [0, 1, 2].map((i) => (
              <div key={i} className="surface space-y-2.5 p-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          {!loading && agents.length === 0 && <EmptyState title="No agents connected" body="Agents appear here once they register with the Stackfox MCP server." />}
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              changes={changes.filter((c) => c.agentId === a.id)}
              selected={selectedAgentId === a.id}
              dimmed={!!selectedAgentId && selectedAgentId !== a.id}
              onSelect={() => onSelectAgent(selectedAgentId === a.id ? null : a.id)}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>

        <AskGraph />

        <div className="border-t border-line">
          <div className="flex h-10 items-center gap-2 px-4">
            <History size={13} strokeWidth={1.5} className="text-fg-3" />
            <span className="eyebrow">Memory · Incidents</span>
          </div>
          <div className="px-4 pb-4">
            {loading && <Skeleton className="h-14 w-full" />}
            {!loading && incidents.length === 0 && (
              <p className="text-[12px] leading-relaxed text-fg-3">No incidents stored yet. Each resolved conflict is written back to the graph.</p>
            )}
            <ol className="relative space-y-3 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line-strong">
              {incidents.map((inc) => (
                <IncidentItem key={inc.id} incident={inc} pulsing={!!pulses[inc.nodeId]} onSelect={() => onSelectNode(inc.nodeId)} />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AgentCard({
  agent,
  changes,
  selected,
  dimmed,
  onSelect,
  onSelectNode,
}: {
  agent: Agent;
  changes: ProposedChange[];
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onSelectNode: (id: string) => void;
}) {
  const a = AGENT_STYLE[agent.slot];
  const st = STATUS_STYLE[agent.status];
  return (
    <div
      className={cn(
        "surface group relative cursor-pointer overflow-hidden p-3 transition-[opacity,border-color] duration-300",
        selected && "border-line-strong",
        dimmed && "opacity-45",
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[2px] origin-top transition-transform duration-500", a.dot, selected ? "scale-y-100" : "scale-y-0")} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", a.dot)} />
          <span className="text-[13px] font-medium">{agent.name}</span>
        </div>
        <span className={cn("flex items-center gap-1.5 text-[11.5px]", st.text)}>
          <span className="relative flex size-1.5">
            {agent.status === "working" && <span className={cn("pulse-ring absolute inset-0 rounded-full", st.dot)} />}
            <span className={cn("relative size-1.5 rounded-full transition-colors duration-500", st.dot)} />
          </span>
          {st.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-3">
        <GitBranch size={11} strokeWidth={1.5} />
        <span className="truncate">{agent.branch}</span>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-fg-2">{agent.task}</p>

      {changes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {changes.map((c) => {
            const cs = CHANGE_STATUS[c.status];
            return (
              <li key={c.id}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(c.nodeId);
                  }}
                  className={cn(
                    "w-full rounded-[var(--radius-control)] border bg-surface-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-3",
                    c.status === "conflict" ? "border-conflict/40" : "border-line",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Glyph kind="change" size={12} filled className={a.text} />
                    <span className="font-mono text-[11px] text-fg-2">{c.id}</span>
                    <span className={cn("ml-auto font-mono text-[10.5px] transition-colors duration-500", cs.text)}>{cs.label}</span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-fg">{c.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10.5px] text-fg-3">Risk</span>
                    <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-4">
                      <motion.span
                        className="absolute inset-0 origin-left rounded-full bg-risk"
                        initial={false}
                        animate={{ scaleX: c.risk ?? 0, opacity: c.risk == null ? 0 : 0.35 + c.risk * 0.65 }}
                        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </span>
                    <span className="w-7 text-right font-mono text-[10.5px] tabular text-fg-2">{c.risk == null ? "—" : c.risk.toFixed(2)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IncidentItem({ incident, pulsing, onSelect }: { incident: Incident; pulsing: boolean; onSelect: () => void }) {
  const lit = incident.recalled || incident.isNew;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative pl-6"
    >
      <span className="absolute left-0 top-1 grid size-[11px] place-items-center">
        {pulsing && lit && <span className="pulse-ring absolute inset-0 rounded-full bg-risk/60" />}
        <Glyph kind="incident" size={11} filled={lit} className={lit ? "text-risk" : "text-fg-3"} />
      </span>
      <button onClick={onSelect} className="block w-full text-left">
        <div className="flex items-center gap-2 font-mono text-[10.5px] text-fg-3">
          <span>{incident.id}</span>
          <span>·</span>
          <span>{incident.sessionId}</span>
          {incident.recalled && <span className="ml-auto rounded-[4px] border border-risk/30 bg-risk/10 px-1.5 py-px text-risk">recalled</span>}
          {incident.isNew && <span className="ml-auto rounded-[4px] border border-pass/30 bg-pass/10 px-1.5 py-px text-pass">stored</span>}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-fg">{incident.title}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{incident.summary}</p>
      </button>
    </motion.li>
  );
}
