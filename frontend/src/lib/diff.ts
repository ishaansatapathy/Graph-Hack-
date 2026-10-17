export type DiffLine = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

/** Small LCS line diff for inline patch previews (files are tiny). */
export function lineDiff(original: string, modified: string): DiffLine[] {
  const a = original.replace(/\n$/, "").split("\n");
  const b = modified.replace(/\n$/, "").split("\n");
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ type: "same", text: a[i], a: ++i, b: ++j });
    else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) out.push({ type: "del", text: a[i], a: ++i });
    else out.push({ type: "add", text: b[j], b: ++j });
  }
  return out;
}

/** Keep only changed lines plus `ctx` lines of context around them. */
export function hunk(lines: DiffLine[], ctx = 2): (DiffLine | null)[] {
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = i - ctx; k <= i + ctx; k++) keep.add(k);
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (gap && out.length) out.push(null);
      out.push(l);
      gap = false;
    } else gap = true;
  });
  return out;
}
