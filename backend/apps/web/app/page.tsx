import Link from "next/link";

export default function HomePage() {
  return (
    <div className="landing-page">
      {/* ── Top Navigation Bar ── */}
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <Link href="/" className="landing-brand">
            <span className="landing-logo-icon">◈</span>
            <span className="landing-brand-text">Stackfox</span>
            <span className="landing-brand-badge">v0.1</span>
          </Link>

          <nav className="landing-nav-links">
            <Link href="#features" className="landing-nav-link">Capabilities</Link>
            <Link href="#architecture" className="landing-nav-link">Graph Architecture</Link>
            <Link href="#workflows" className="landing-nav-link">Workflows</Link>
          </nav>

          <div className="landing-nav-actions">
            <Link href="/sign-in" className="landing-btn-ghost">
              Sign In
            </Link>
            <Link href="/app" className="landing-btn-primary">
              Launch Workspace →
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="landing-hero">
        <div className="landing-container">
          <div className="landing-hero-badge">
            <span className="landing-badge-dot" />
            <span>Graph-Powered AI Engineering Workspace</span>
          </div>

          <h1 className="landing-hero-title">
            Connect the context <br />
            <span className="landing-gradient-text">behind your code.</span>
          </h1>

          <p className="landing-hero-subtitle">
            Stackfox turns disconnected commits, pull requests, Jira issues, Slack threads,
            and MCP tools into a unified knowledge graph. Understand change intent, resolve Git
            conflicts with evidence, and keep engineering work aligned.
          </p>

          <div className="landing-hero-cta">
            <Link href="/app" className="landing-btn-primary landing-btn-large">
              Enter Workspace
            </Link>
            <Link href="/app/conflicts" className="landing-btn-secondary landing-btn-large">
              <span>⚡</span> Try Conflict Studio
            </Link>
          </div>

          {/* ── Hero Mockup Preview ── */}
          <div className="landing-hero-preview">
            <div className="landing-preview-window">
              <div className="landing-window-header">
                <div className="landing-window-dots">
                  <span className="landing-dot dot-red" />
                  <span className="landing-dot dot-yellow" />
                  <span className="landing-dot dot-green" />
                </div>
                <div className="landing-window-title">stackfox-workspace · graph-rag-context.cypher</div>
                <div className="landing-window-status">
                  <span className="landing-status-dot" /> Neon PG + FalkorDB Active
                </div>
              </div>

              <div className="landing-preview-grid">
                <div className="landing-preview-sidebar">
                  <div className="preview-nav-item active">◈ Graph Agent</div>
                  <div className="preview-nav-item">▣ Web IDE</div>
                  <div className="preview-nav-item">⚡ Conflicts (1 Open)</div>
                  <div className="preview-nav-item">⎇ GitHub (Syncing)</div>
                  <div className="preview-nav-item">◆ Jira (Connected)</div>
                  <div className="preview-nav-item"># Slack (Alerts)</div>
                  <div className="preview-nav-item">⊞ Workspace Hub</div>
                </div>

                <div className="landing-preview-content">
                  <div className="preview-graph-card">
                    <div className="preview-graph-header">
                      <span className="preview-kicker">LIVE RETRIEVAL SUBGRAPH</span>
                      <span className="preview-tag">Vectorless GraphRAG</span>
                    </div>

                    <div className="preview-node-diagram">
                      <div className="preview-node node-commit">
                        <span className="node-icon">⎇</span>
                        <div>
                          <strong>Commit 70ba833</strong>
                          <p>feat: update auth token validator</p>
                        </div>
                      </div>
                      <div className="preview-edge-label">REFERENCES</div>
                      <div className="preview-node node-issue">
                        <span className="node-icon">◆</span>
                        <div>
                          <strong>Jira AUTH-142</strong>
                          <p>Enforce strict token verification</p>
                        </div>
                      </div>
                      <div className="preview-edge-label">TESTS</div>
                      <div className="preview-node node-test">
                        <span className="node-icon">✓</span>
                        <div>
                          <strong>tests/auth.test.ts</strong>
                          <p>Passing 14/14 test cases</p>
                        </div>
                      </div>
                    </div>

                    <div className="preview-cypher-box">
                      <code>
                        {`MATCH (c:Commit)-[:REFERENCES]->(i:Issue), (c)-[:MODIFIES]->(f:Function)
RETURN c.sha, i.key, f.name, f.callers`}
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Grid ── */}
      <section id="features" className="landing-features">
        <div className="landing-container">
          <div className="landing-section-header">
            <p className="landing-section-kicker">ENGINEERING PILLARS</p>
            <h2 className="landing-section-title">Built for real engineering rigor.</h2>
            <p className="landing-section-desc">
              No fuzzy vector hallucinations. No disconnected chat bots. Every answer and patch
              is grounded in actual relational graph evidence and test outcomes.
            </p>
          </div>

          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-purple">◈</div>
              <h3>Vectorless GraphRAG</h3>
              <p>
                Query interconnected code entities directly in FalkorDB using Cypher. Trace symbols,
                callers, dependencies, and imports with deterministic precision.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-cyan">⚡</div>
              <h3>AI Conflict Studio</h3>
              <p>
                Differentiate textual conflicts from semantic conflicts. Propose candidate resolutions
                based on the underlying change intent and validate with automated checks.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-emerald">⊞</div>
              <h3>Shared MCP Tools & APIs</h3>
              <p>
                Publish graph query tools and integrations for your workspace. Private by default with
                role-based sharing, least-privilege secrets, and complete audit logging.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-amber">◆</div>
              <h3>GitHub + Jira + Slack Sync</h3>
              <p>
                Connect commits and PRs to Jira issue acceptance criteria and Slack discussions.
                Generate evidence-backed progress updates with full provenance.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-blue">⚖</div>
              <h3>Multi-Model Orchestrator</h3>
              <p>
                Route tasks dynamically to Gemini 2.5 Pro or Flash based on complexity, quota limits,
                and cost policies. Assign distinct roles for investigation and review.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="feature-icon-wrap icon-rose">🛡</div>
              <h3>Production ACID Architecture</h3>
              <p>
                Powered by Neon PostgreSQL with full transactional atomicity, foreign key cascades,
                composite indexes, automatic retry layers, and real-time health checks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="landing-bottom-cta">
        <div className="landing-container">
          <div className="landing-cta-box">
            <h2>Ready to experience connected engineering?</h2>
            <p>Launch your workspace now and start navigating your codebase with real graph intelligence.</p>
            <div className="landing-cta-buttons">
              <Link href="/app" className="landing-btn-primary landing-btn-large">
                Get Started Free →
              </Link>
              <Link href="/sign-in" className="landing-btn-ghost landing-btn-large">
                Sign In With Google
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-logo-icon">◈</span>
            <strong>Stackfox</strong>
            <span className="landing-footer-sep">·</span>
            <span>Production Graph AI Workspace</span>
          </div>
          <div className="landing-footer-right">
            <span className="landing-system-indicator">
              <span className="indicator-dot" /> All Systems Operational
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
