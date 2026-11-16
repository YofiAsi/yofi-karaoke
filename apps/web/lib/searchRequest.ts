// Abortable YouTube search request that reports rate limiting separately from failures.
import type { SearchResultItem } from "@karaoke/shared";

export type SearchOutcome =
  | { kind: "ok"; results: SearchResultItem[] }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "unavailable" }
  | { kind: "failed" };

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_RETRY_SECONDS = 30;

function retryAfterOf(res: Response): number {
  const header = Number(res.headers.get("Retry-After"));
  return Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_SECONDS;
}

async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? null;
  } catch {
    return null;
  }
}

async function outcomeOf(res: Response): Promise<SearchOutcome> {
  if (res.ok) return { kind: "ok", results: (await res.json()) as SearchResultItem[] };
  if (res.status === 429) return { kind: "rate_limited", retryAfterSeconds: retryAfterOf(res) };
  if ((await errorCodeOf(res)) === "video_unavailable") return { kind: "unavailable" };
  return { kind: "failed" };
}

export async function searchYoutube(
  query: string,
  signal: AbortSignal,
  fetchFn: FetchFn = fetch,
): Promise<SearchOutcome> {
  const res = await fetchFn(`/api/search?q=${encodeURIComponent(query)}`, {
    credentials: "include",
    signal,
  });
  return outcomeOf(res);
}
