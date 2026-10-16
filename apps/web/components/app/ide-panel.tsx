"use client";

import { useState } from "react";

const VSCODE_URL = process.env.NEXT_PUBLIC_VSCODE_URL ?? "http://localhost:3002/?folder=/home/workspace";

/** Embeds a full VS Code (OpenVSCode Server fork) in the browser. */
export function IdePanel() {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="app-vscode">
      <div className="app-vscode-bar">
        <span className="app-vscode-title">VS Code · Web</span>
        <span className="app-muted">{loaded ? "Connected" : "Connecting…"}</span>
        <a className="app-btn-ghost app-btn-small app-vscode-open" href={VSCODE_URL} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      </div>
      <iframe
        title="VS Code"
        src={VSCODE_URL}
        className="app-vscode-frame"
        onLoad={() => setLoaded(true)}
        allow="clipboard-read; clipboard-write"
      />
      {!loaded ? (
        <p className="app-muted app-vscode-hint">
          Editor not loading? Start it with <code>npm run db:up</code> (Docker) and open port 3002.
        </p>
      ) : null}
    </div>
  );
}
