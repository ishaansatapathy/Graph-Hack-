"use client";

import { useState } from "react";

const STARTER = `// Stackfox IDE — Cypher / agent scratchpad
MATCH (c:Commit)-[:REFERENCES]->(i:Issue)
RETURN c.sha, i.key
LIMIT 10
`;

type Props = {
  onRunCypher?: (query: string) => void;
};

export function IdePanel({ onRunCypher }: Props) {
  const [code, setCode] = useState(STARTER);
  const [output, setOutput] = useState("");

  function run() {
    if (onRunCypher) {
      onRunCypher(code);
      return;
    }
    setOutput("Run wired to graph API next — paste queries here for demo.");
  }

  return (
    <div className="app-ide">
      <div className="app-ide-toolbar">
        <span className="app-ide-file">graph.cypher</span>
        <button type="button" className="app-btn app-btn-small" onClick={run}>
          Run
        </button>
      </div>
      <textarea
        className="app-ide-editor"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label="IDE editor"
      />
      {output ? (
        <div className="app-ide-output">
          <strong>Output</strong>
          <pre>{output}</pre>
        </div>
      ) : null}
      <p className="app-muted app-ide-hint">Teammate can swap this for Monaco / full IDE later.</p>
    </div>
  );
}
