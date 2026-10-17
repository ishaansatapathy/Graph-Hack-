/** Reads design tokens from CSS custom properties so canvas + Monaco
    stay in lockstep with globals.css. */
export const TOKEN_NAMES = [
  "bg", "surface-1", "surface-2", "surface-3", "surface-4",
  "line", "line-strong", "fg", "fg-2", "fg-3",
  "accent", "conflict", "risk", "pass", "agent-a", "agent-b", "agent-c", "synk",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;

export function readTokens(el: Element = document.documentElement): Tokens {
  const cs = getComputedStyle(el);
  return Object.fromEntries(
    TOKEN_NAMES.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]),
  ) as Tokens;
}

/** "#rrggbb" + alpha 0..1 -> "#rrggbbaa" */
export function alpha(hex: string, a: number) {
  const base = hex.length === 9 ? hex.slice(0, 7) : hex;
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
  return `${base}${v}`;
}
