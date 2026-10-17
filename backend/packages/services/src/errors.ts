/**
 * An error whose message is safe to show to end users
 * (validation, permission and state problems — never internal failures).
 */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "UserError";
  }
}
