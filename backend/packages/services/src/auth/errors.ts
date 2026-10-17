export type AuthErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function toAuthError(error: unknown, fallbackMessage: string): AuthError {
  if (error instanceof AuthError) return error;

  if (error instanceof Error) {
    return new AuthError("INTERNAL", error.message || fallbackMessage);
  }

  return new AuthError("INTERNAL", fallbackMessage);
}
