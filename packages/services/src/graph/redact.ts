/** Strip obvious credentials before any text is stored in the graph, memory or sent to a model. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk_stackfox_[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"]?[^\s'"]{6,}/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const key = match.match(/^(password|passwd|secret|api[_-]?key|token)\s*[:=]/i);
      return key ? `${key[0]} [REDACTED]` : "[REDACTED]";
    });
  }
  return out;
}

export function clip(text: string, max: number): string {
  const clean = redactSecrets(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
