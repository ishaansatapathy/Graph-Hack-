"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state";
import { useScenario } from "@/lib/scenario-store";
import type { Phase } from "@/lib/types";
import { AgentsRail } from "./AgentsRail";
import { EventLog } from "./EventLog";
import { GraphCanvas, GraphSkeleton } from "./graph/GraphCanvas";
import { Inspector, type InspectorTab } from "./Inspector";
import { TopBar } from "./TopBar";

const TAB_FOR_PHASE: Partial<Record<Phase, InspectorTab>> = {
  conflict: "evidence",
  evidence: "evidence",
  tests: "tests",
  fix: "fix",
  verified: "fix",
};

export function Dashboard() {
  const params = useSearchParams();
  const speed = Number(params.get("speed")) || 1;
  const { state, run, stop, retry } = useScenario({ speed });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("evidence");
  const [follow, setFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(true);

  // Inspector follows the scenario until the user takes over.
  const [seenPhase, setSeenPhase] = useState(state.phase);
  if (seenPhase !== state.phase) {
    setSeenPhase(state.phase);
    const t = TAB_FOR_PHASE[state.phase];
    if (follow && t) setTab(t);
  }

  // ?autorun=1 starts the demo immediately.
  const autoran = useRef(false);
  useEffect(() => {
    if (state.load === "ready" && params.get("autorun") === "1" && !autoran.current) {
      autoran.current = true;
      run();
    }
  }, [state.load, params, run]);

  const selectedNode = useMemo(() => state.nodes.find((n) => n.id === selectedNodeId) ?? null, [state.nodes, selectedNodeId]);
  const hasAnchor = (id: string) => state.snapshot?.files.some((f) => f.anchors.some((a) => a.nodeId === id)) ?? false;

  const selectNode = (id: string | null, from: "graph" | "panel" = "graph") => {
    setSelectedNodeId(id);
    if (id && from === "graph" && hasAnchor(id)) {
      setFollow(false);
      setTab("code");
    }
  };

  const onRun = () => {
    setFollow(true);
    setSelectedNodeId(null);
    setSelectedAgentId(null);
    setTab("evidence");
    run();
  };

  const loading = state.load === "loading";

  return (
    <div className="grain flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar
        repo={state.snapshot?.repo}
        sessionId={state.snapshot?.sessionId}
        phase={state.phase}
        stream={state.stream}
        clock={state.clock}
        durationMs={state.snapshot?.durationMs}
        onRun={onRun}
        onStop={stop}
      />

      <div className="flex flex-1 items-center justify-center px-6 min-[1100px]:hidden">
        <div className="surface max-w-sm p-6 text-center">
          <p className="text-[14px] font-medium text-fg">The dashboard needs a wider window</p>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
            Graph, agents, inspector and event log run side by side. Open SYNK at 1100px or wider to watch the run.
          </p>
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 grid-cols-[264px_minmax(0,1fr)_380px] min-[1100px]:grid 2xl:grid-cols-[288px_minmax(0,1fr)_440px]">
        <AgentsRail
          loading={loading}
          agents={state.agents}
          changes={state.changes}
          incidents={state.incidents}
          selectedAgentId={selectedAgentId}
          pulses={state.pulses}
          onSelectAgent={setSelectedAgentId}
          onSelectNode={(id) => selectNode(id)}
        />

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="relative min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_40%,var(--surface-1),var(--bg)_70%)]">
            {loading && <GraphSkeleton />}
            {state.load === "error" && <ErrorState title="Couldn't load the code graph" message={state.loadError} onRetry={retry} />}
            {state.load === "ready" && (
              <>
                <GraphCanvas
                  nodes={state.nodes}
                  edges={state.edges}
                  agents={state.agents}
                  changes={state.changes}
                  evidence={state.evidence}
                  tests={state.tests}
                  pulses={state.pulses}
                  focus={state.focus}
                  selectedAgentId={selectedAgentId}
                  selectedNodeId={selectedNodeId}
                  follow={follow}
                  resolved={state.fix?.status === "verified"}
                  onSelectNode={(id) => selectNode(id)}
                />
                <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 font-mono text-[11px] text-fg-3">
                  <span className="text-fg-2">{state.snapshot?.graphName}</span>
                  <span>·</span>
                  <span className="tabular">{state.nodes.length} nodes</span>
                  <span>·</span>
                  <span className="tabular">{state.edges.length} edges</span>
                  <span>·</span>
                  <span>FalkorDB</span>
                </div>
                {state.stream === "idle" && (
                  <div className="absolute inset-x-0 top-14 flex justify-center">
                    <div className="surface flex items-center gap-4 py-2.5 pl-4 pr-2.5">
                      <p className="text-[12.5px] text-fg-2">
                        Three agents, three branches, one shared graph. <span className="text-fg">Replay the run.</span>
                      </p>
                      <Button size="sm" variant="primary" onClick={onRun}>
                        <Play size={12} strokeWidth={2} /> Run scenario
                      </Button>
                    </div>
                  </div>
                )}
                {!follow && state.stream === "live" && (
                  <button
                    onClick={() => setFollow(true)}
                    className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line-strong bg-surface-2 px-3 py-1 text-[11.5px] text-fg-2 hover:text-fg"
                  >
                    Follow scenario
                  </button>
                )}
              </>
            )}
          </div>
          <EventLog
            log={state.log}
            agents={state.agents}
            stream={state.stream}
            streamError={state.streamError}
            open={logOpen}
            onToggle={() => setLogOpen((o) => !o)}
            onRun={onRun}
          />
        </main>

        <Inspector
          tab={tab}
          onTab={(t) => {
            setFollow(false);
            setTab(t);
          }}
          nodes={state.nodes}
          agents={state.agents}
          evidence={state.evidence}
          tests={state.tests}
          fix={state.fix}
          files={state.snapshot?.files ?? []}
          selectedNode={selectedNode}
          onSelectNode={(id) => selectNode(id, "panel")}
        />
      </div>
    </div>
  );
}
