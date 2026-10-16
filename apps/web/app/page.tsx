import Link from "next/link";

export default function HomePage() {
  return (
    <div className="app-shell">
      <div className="app-card">
        <h1>Graph Hack</h1>
        <p>
          FalkorDB + GraphRAG agent.{" "}
          <Link href="/sign-in">Sign in</Link> or <Link href="/app">open app</Link>.
        </p>
      </div>
    </div>
  );
}
