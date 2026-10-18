const APP_DEFAULT_REDIRECT = "/app";
const SAFE_FALLBACK = "/";

export function sanitizeRedirectPath(
  path: string | null | undefined,
  fallback = APP_DEFAULT_REDIRECT,
): string {
  if (!path || typeof path !== "string") return fallback;

  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return SAFE_FALLBACK;
  if (trimmed.includes("\\") || trimmed.includes("@") || trimmed.includes(":")) {
    return SAFE_FALLBACK;
  }

  return trimmed;
}
