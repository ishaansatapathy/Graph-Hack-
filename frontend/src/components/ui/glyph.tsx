import { glyphD } from "@/lib/glyphs";
import type { NodeKind } from "@/lib/types";
import { cn } from "@/lib/cn";

export function Glyph({ kind, size = 12, className, filled }: { kind: NodeKind; size?: number; className?: string; filled?: boolean }) {
  const r = 5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-8 -8 16 16"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path
        d={glyphD(kind, r)}
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.85 : undefined}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
