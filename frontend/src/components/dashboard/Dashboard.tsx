"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { useScenario } from "@/lib/scenario-store";
import type { Phase } from "@/lib/types";
import { AgentsRail } from "./AgentsRail";
import { EventLog } from "./EventLog";
import { GraphCanvas, GraphSkeleton } from "./graph/GraphCanvas";
import { Inspector, type InspectorTab } from "./Inspector";
import { TopBar, type TopBarTab } from "./TopBar";
import { IdeView } from "../views/IdeView";
import { VaultView } from "../views/VaultView";
import { IntegrationsView } from "../views/IntegrationsView";
import { WorkspaceView } from "../views/WorkspaceView";
import { ConflictsView } from "../views/ConflictsView";

const TAB_FOR_PHASE: Partial<Record<Phase, InspectorTab>> = {
  conflict: "evidence",
  evidence: "evidence",
};

const VIEWS: TopBarTab[] = ["studio", "ide", "vault", "integrations", "workspace", "conflicts"];

export function Dashboard() {
  const params = useSearchParams();
  const { state, reconnect, retry, importRepo } = useScenario();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("evidence");
  const [follow, setFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const [activeView, setActiveView] = useState<TopBarTab>(() => {
    const t = params.get("tab") as TopBarTab;
    return t && VIEWS.includes(t) ? t : "studio";
  });

  // Inspector follows live activity until the user takes over.
  const [seenPhase, setSeenPhase] = useState(state.phase);
  if (seenPhase !== state.phase) {
    setSeenPhase(state.phase);
    const t = TAB_FOR_PHASE[state.phase];
    if (follow && t) setTab(t);
  }

  const selectedNode = useMemo(() => state.nodes.find((n) => n.id === selectedNodeId) ?? null, [state.nodes, selectedNodeId]);
  const hasAnchor = (id: string) => state.files.some((f) => f.anchors.some((a) => a.nodeId === id));

  const selectNode = (id: string | null, from: "graph" | "panel" = "graph") => {
    setSelectedNodeId(id);
    if (id && from === "graph" && hasAnchor(id)) {
      setFollow(false);
      setTab("code");
    }
  };

  const onImport = (repo: string) => {
    setFollow(true);
    setSelectedNodeId(null);
    setSelectedAgentId(null);
    setTab("evidence");
    importRepo(repo);
  };

  const loading = state.load === "loading";

  return (
    <div className="grain flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar
        repo={state.snapshot?.repo}
        workspace={state.snapshot?.workspace.name}
        phase={state.phase}
        stream={state.stream}
        clock={state.clock}
        importing={state.importing}
        importError={state.importError}
        onImport={onImport}
        onReconnect={reconnect}
        activeTab={activeView}
        onSelectTab={setActiveView}
      />

      {activeView === "studio" ? (
        <>
          <div className="flex flex-1 items-center justify-center px-6 min-[1100px]:hidden">
            <div className="surface max-w-sm p-6 text-center">
              <p className="text-[14px] font-medium text-fg">The dashboard needs a wider window</p>
              <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
                Graph, agents, inspector and event log run side by side. Open Stackfox at 1100px or wider.
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
                {state.load === "error" && state.loadStatus === 401 && (
                  <EmptyState
                    title="Sign in to see your workspace graph"
                    body="The dashboard reads your workspace from the Stackfox backend."
                    action={
                      <Link href="/signin">
                        <Button size="sm" variant="primary">Sign in</Button>
                      </Link>
                    }
                  />
                )}
                {state.load === "error" && state.loadStatus !== 401 && (
                  <ErrorState title="Couldn't load the code graph" message={state.loadError} onRetry={retry} />
                )}
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
                      <span>{state.snapshot?.engine === "falkordb" ? "FalkorDB" : "embedded graph (FalkorDB offline)"}</span>
                    </div>
                    {state.nodes.length === 0 && (
                      <EmptyState
                        icon={<GitBranch size={16} strokeWidth={1.5} />}
                        title={state.importing ? "Importing…" : "This workspace graph is empty"}
                        body="Import a GitHub repository (owner/repo) from the top bar. Stackfox compares its branches against the default branch and writes the changes into FalkorDB."
                      />
                    )}
                    {!follow && state.stream === "live" && (
                      <button
                        onClick={() => setFollow(true)}
                        className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line-strong bg-surface-2 px-3 py-1 text-[11.5px] text-fg-2 hover:text-fg"
                      >
                        Follow live
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
                onRun={reconnect}
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
              files={state.files}
              selectedNode={selectedNode}
              onSelectNode={(id) => selectNode(id, "panel")}
            />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeView === "ide" && <IdeView onOpenTab={setActiveView} />}
          {activeView === "vault" && <VaultView />}
          {activeView === "integrations" && <IntegrationsView />}
          {activeView === "workspace" && <WorkspaceView />}
          {activeView === "conflicts" && <ConflictsView onOpenTab={setActiveView} />}
        </div>
      )}
    </div>
  );
}
