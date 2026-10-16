"use client";

import { useState } from "react";

import { trpc } from "~/lib/trpc";

export default function GraphAgentPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cypher, setCypher] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    setCypher([]);
    try {
      const result = await trpc.graph.ask.mutate({ question: question.trim() });
      setAnswer(result.answer);
      setCypher(result.cypher);
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="app-section app-section--flat">
      <form onSubmit={(e) => void onAsk(e)} className="app-ask-form">
        <input
          className="app-input"
          placeholder="Ask something about the graph…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="app-btn" disabled={asking}>
          {asking ? "Thinking…" : "Ask"}
        </button>
      </form>
      {answer ? (
        <div className="app-answer">
          <strong>Answer</strong>
          <p>{answer}</p>
          {cypher.length > 0 ? <pre className="app-cypher">{cypher.join("\n\n")}</pre> : null}
        </div>
      ) : null}
    </section>
  );
}
