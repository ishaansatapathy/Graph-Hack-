import type { NodeKind } from "./types";

/** One shape per node type, shared by the canvas renderer and SVG legend.
    Returns an SVG path centred on (0,0) with nominal radius r. */
export function glyphD(kind: NodeKind, r: number): string {
  const f = (n: number) => +n.toFixed(2);
  const poly = (n: number, rot = 0, rr = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${i ? "L" : "M"}${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)}`;
    }).join("") + "Z";

  switch (kind) {
    case "endpoint": // hexagon
      return poly(6, Math.PI / 6, r * 1.08);
    case "schema": {
      // rounded square
      const s = r * 0.88, c = r * 0.3;
      return `M${f(-s + c)} ${f(-s)}H${f(s - c)}Q${f(s)} ${f(-s)} ${f(s)} ${f(-s + c)}V${f(s - c)}Q${f(s)} ${f(s)} ${f(s - c)} ${f(s)}H${f(-s + c)}Q${f(-s)} ${f(s)} ${f(-s)} ${f(s - c)}V${f(-s + c)}Q${f(-s)} ${f(-s)} ${f(-s + c)} ${f(-s)}Z`;
    }
    case "field": // small circle
      return `M${f(r * 0.72)} 0A${f(r * 0.72)} ${f(r * 0.72)} 0 1 1 ${f(-r * 0.72)} 0A${f(r * 0.72)} ${f(r * 0.72)} 0 1 1 ${f(r * 0.72)} 0Z`;
    case "function": // diamond
      return poly(4, 0, r * 1.15);
    case "test": // triangle
      return poly(3, -Math.PI / 2, r * 1.15);
    case "change": {
      // capsule
      const w = r * 1.35, h = r * 0.82;
      return `M${f(-w + h)} ${f(-h)}H${f(w - h)}A${f(h)} ${f(h)} 0 0 1 ${f(w - h)} ${f(h)}H${f(-w + h)}A${f(h)} ${f(h)} 0 0 1 ${f(-w + h)} ${f(-h)}Z`;
    }
    case "incident": // octagon
      return poly(8, Math.PI / 8, r * 1.05);
    case "file": {
      // page with a folded corner
      const w = r * 0.78, h = r, k = r * 0.42;
      return `M${f(-w)} ${f(-h)}H${f(w - k)}L${f(w)} ${f(-h + k)}V${f(h)}H${f(-w)}Z`;
    }
    case "issue": // pentagon
      return poly(5, -Math.PI / 2, r * 1.05);
  }
}

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  endpoint: "Endpoint",
  schema: "Schema",
  field: "Field",
  function: "Function",
  test: "Test",
  change: "Change",
  incident: "Conflict",
  file: "File",
  issue: "Issue",
};
