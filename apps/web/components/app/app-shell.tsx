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

  return (
    <div className="app-layout">
      <aside className="app-sidebar" aria-label="Features">
        <div className="app-sidebar-brand">
          <Link href="/app" className="app-sidebar-logo-link">
            <span className="app-sidebar-logo">Stackfox</span>
          </Link>
        </div>

        <nav className="app-sidebar-nav">
          {APP_FEATURES.map((item) => {
            const active = item.id === activeId || pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`app-sidebar-item ${active ? "app-sidebar-item--active" : ""}`}
                title={item.description}
              >
                <span className="app-sidebar-icon" aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <p className="app-sidebar-user">{userName}</p>
          <p className="app-sidebar-email">{userEmail}</p>
          <button type="button" className="app-btn-ghost app-btn-small app-sidebar-logout" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-main-header">
          <div>
            <p className="app-main-kicker">Workspace</p>
            <h1 className="app-main-title">{feature.label}</h1>
            <p className="app-muted">{feature.description}</p>
          </div>
        </header>
        <div className="app-main-body">{children}</div>
      </main>
    </div>
  );
}
