export type AppFeatureId = "ide" | "graph" | "github" | "jira" | "slack" | "workspace" | "share";

export type AppFeature = {
  id: AppFeatureId;
  label: string;
  icon: string;
  description: string;
  path: string;
};

export const APP_FEATURES: AppFeature[] = [
  {
    id: "ide",
    label: "IDE",
    icon: "▣",
    description: "Query graph & agents in one editor shell",
    path: "/app/ide",
  },
  {
    id: "graph",
    label: "Graph agent",
    icon: "◈",
    description: "Ask questions over FalkorDB context",
    path: "/app",
  },
  {
    id: "github",
    label: "GitHub",
    icon: "⎇",
    description: "Commits & repos sync into the graph",
    path: "/app/github",
  },
  {
    id: "jira",
    label: "Jira",
    icon: "◆",
    description: "Tickets linked to code progress",
    path: "/app/jira",
  },
  {
    id: "slack",
    label: "Slack",
    icon: "#",
    description: "Progress updates to your channel",
    path: "/app/slack",
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: "⊞",
    description: "Shared team context",
    path: "/app/workspace",
  },
  {
    id: "share",
    label: "Share",
    icon: "↗",
    description: "API keys for integrations",
    path: "/app/share",
  },
];

export function featureFromPath(pathname: string): AppFeature {
  const exact = APP_FEATURES.find((f) => f.path === pathname);
  if (exact) return exact;
  return APP_FEATURES.find((f) => f.id === "graph")!;
}
