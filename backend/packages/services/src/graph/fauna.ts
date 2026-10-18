/** Minimal server-side client for Fauna's Core Query API. */

const FAUNA_QUERY_URL = "https://db.fauna.com/query/1";
const QUERY_TIMEOUT_MS = 8_000;

type FaunaResponse<T> = {
  data?: T;
  summary?: string;
  error?: { code?: string; message?: string };
};

function getFaunaSecret() {
  const secret = process.env.FAUNA_SECRET?.trim();
  if (!secret) throw new Error("FAUNA_SECRET is not configured");
  return secret;
}

/**
 * Send parameterized FQL through Fauna's Core API. Query text is owned by the
 * application; caller data is passed separately so values cannot alter FQL.
 */
export async function faunaQuery<T>(fql: string, args: Record<string, unknown> = {}): Promise<T> {
  const secret = getFaunaSecret();
  const response = await fetch(FAUNA_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Format": "simple",
      "X-Query-Timeout-Ms": String(QUERY_TIMEOUT_MS),
    },
    body: JSON.stringify({ query: fql, arguments: args }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS + 1_000),
  });

  const result = (await response.json().catch(() => ({}))) as FaunaResponse<T>;
  if (!response.ok) {
    // Do not include request bodies or authentication material in thrown errors.
    const detail = result.error?.code ?? `HTTP ${response.status}`;
    throw new Error(`Fauna query failed (${detail})`);
  }
  if (!("data" in result)) throw new Error("Fauna returned an invalid query response");
  return result.data as T;
}

export async function checkFaunaConnection(): Promise<boolean> {
  try {
    return (await faunaQuery<number>("1 + 1")) === 2;
  } catch {
    return false;
  }
}
