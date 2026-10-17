"use client";

import dynamic from "next/dynamic";
import { Glyph } from "@/components/ui/glyph";
import { NODE_KIND_LABEL } from "@/lib/glyphs";
import type { NodeKind } from "@/lib/types";
import type { GraphCanvasProps } from "./GraphCanvasInner";

const Inner = dynamic(() => import("./GraphCanvasInner"), {
  ssr: false,
  loading: () => <GraphSkeleton />,
});

export function GraphSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-fg-3">
        <svg width="72" height="40" viewBox="0 0 72 40" aria-hidden className="opacity-70">
          <g stroke="currentColor" strokeWidth="1" fill="none">
            <path d="M8 30 L30 10 L52 26 L66 8" />
            <circle cx="8" cy="30" r="3" className="pulse-ring origin-center [transform-box:fill-box]" />
            <circle cx="30" cy="10" r="3" />
            <circle cx="52" cy="26" r="3" />
            <circle cx="66" cy="8" r="3" />
          </g>
        </svg>
        <span className="eyebrow">Loading graph</span>
      </div>
    </div>
  );
}

const LEGEND: NodeKind[] = ["endpoint", "schema", "field", "function", "test", "change", "incident"];

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <div className="absolute inset-0">
      <Inner {...props} />
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1.5 rounded-[var(--radius-control)] border border-line bg-surface-1/90 px-2.5 py-2">
        {LEGEND.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px] text-fg-3">
            <Glyph kind={k} size={11} className="text-fg-2" />
            {NODE_KIND_LABEL[k]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
          <span className="size-2.5 rounded-full border border-risk" /> Risk ring
        </span>
      </div>
    </div>
  );
}
