import { sanitizeRedirectPath } from "@stackfox/services/auth/safe-redirect";

type AuthCardProps = {
  errorMessage?: string;
  nextPath?: string;
};

export function AuthCard({ errorMessage, nextPath }: AuthCardProps) {
  const returnTo = sanitizeRedirectPath(nextPath ?? "/app");
  const googleHref = `/api-auth/google?state=${encodeURIComponent(returnTo)}`;

  return (
    <div className="thread-auth-card">
      <div className="thread-auth-logo">Stackfox</div>
      <h1 className="thread-auth-title">Sign in to continue</h1>
      {errorMessage ? <p className="thread-auth-error">{errorMessage}</p> : null}
      <a href={googleHref} className="thread-auth-google-wide">
        <GoogleIcon />
        Continue with Google
      </a>
      <p className="thread-auth-hint">Graph Hacks · FalkorDB context layer</p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.78-.07-1.53-.2-2.25H12v4.26h6.44c-.28 1.48-1.12 2.72-2.38 3.56l3.77 2.92C21.98 18.98 23.49 15.87 23.49 12.27z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.24 0 5.95-1.08 7.93-2.95l-3.77-2.92c-1.08.72-2.45 1.16-4.16 1.16-2.86 0-5.29-1.93-6.16-4.53l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
      />
    </svg>
  );
}
