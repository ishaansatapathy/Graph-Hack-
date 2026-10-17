"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { APP_FEATURES, type AppFeatureId } from "~/lib/app-features";

type Props = {
  activeId: AppFeatureId;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  children: ReactNode;
};

export function AppShell({ activeId, userName, userEmail, onLogout, children }: Props) {
  const pathname = usePathname();
  const feature = APP_FEATURES.find((f) => f.id === activeId) ?? APP_FEATURES[0];

  const initials = userName
    ? userName
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  const coreNav = APP_FEATURES.filter((f) => ["ide", "graph", "conflicts"].includes(f.id));
  const integrationNav = APP_FEATURES.filter((f) => ["github", "jira", "slack"].includes(f.id));
  const adminNav = APP_FEATURES.filter((f) => ["workspace", "share"].includes(f.id));

  return (
    <div className="app-layout">
      <aside className="app-sidebar" aria-label="Features">
        <div className="app-sidebar-brand">
          <Link href="/app" className="app-sidebar-logo-link">
            <span className="app-sidebar-logo-badge">
              <span className="logo-spark" />
              <span className="app-sidebar-logo">Stackfox</span>
            </span>
            <span className="app-sidebar-badge">PROD</span>
          </Link>
        </div>

        <nav className="app-sidebar-nav">
          <div className="sidebar-group-label">STUDIO & INTELLIGENCE</div>
          {coreNav.map((item) => {
            const active = item.id === activeId || pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`app-sidebar-item ${active ? "app-sidebar-item--active" : ""}`}
                title={item.description}
              >
                <span className="app-sidebar-icon" aria-hidden>{item.icon}</span>
                <span className="app-sidebar-label">{item.label}</span>
                {item.id === "conflicts" ? <span className="nav-bubble">Active</span> : null}
              </Link>
            );
          })}

          <div className="sidebar-group-label" style={{ marginTop: "16px" }}>PIPELINE & SYNC</div>
          {integrationNav.map((item) => {
            const active = item.id === activeId || pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`app-sidebar-item ${active ? "app-sidebar-item--active" : ""}`}
                title={item.description}
              >
                <span className="app-sidebar-icon" aria-hidden>{item.icon}</span>
                <span className="app-sidebar-label">{item.label}</span>
              </Link>
            );
          })}

          <div className="sidebar-group-label" style={{ marginTop: "16px" }}>ADMINISTRATION</div>
          {adminNav.map((item) => {
            const active = item.id === activeId || pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`app-sidebar-item ${active ? "app-sidebar-item--active" : ""}`}
                title={item.description}
              >
                <span className="app-sidebar-icon" aria-hidden>{item.icon}</span>
                <span className="app-sidebar-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-sidebar-user-block">
            <div className="user-avatar-circle">{initials}</div>
            <div className="user-details">
              <p className="app-sidebar-user">{userName}</p>
              <p className="app-sidebar-email">{userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            className="app-btn-ghost app-btn-small app-sidebar-logout"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-main-header">
          <div className="header-meta">
            <div className="header-breadcrumbs">
              <span className="breadcrumb-root">Workspace</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">{feature.label}</span>
            </div>
            <h1 className="app-main-title">{feature.label}</h1>
            <p className="app-muted">{feature.description}</p>
          </div>

          <div className="header-status-strip">
            <div className="status-pill status-pill--healthy">
              <span className="pulse-dot" />
              <span>Neon PostgreSQL: Online</span>
            </div>
            <div className="status-pill status-pill--graph">
              <span className="graph-dot" />
              <span>FalkorDB Graph Layer: Active</span>
            </div>
          </div>
        </header>

        <div className="app-main-body">{children}</div>
      </main>
    </div>
  );
}
