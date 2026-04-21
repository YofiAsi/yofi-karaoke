import { env } from "../env.js";

export interface LrcLibResult {
  syncedLyrics: string | null;
  source: "lrclib" | "none";
}

export async function fetchLyrics(params: {
  title: string;
  artist: string;
  durationSeconds: number;
}): Promise<LrcLibResult> {
  const url = new URL("/api/get", env.LRCLIB_BASE_URL);
  url.searchParams.set("track_name", params.title);
  url.searchParams.set("artist_name", params.artist);
  url.searchParams.set("duration", String(params.durationSeconds));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), env.LRCLIB_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "karaoke-worker/0.1" },
    });
    if (res.status === 404) {
      return { syncedLyrics: null, source: "none" };
    }
    if (!res.ok) {
      return { syncedLyrics: null, source: "none" };
    }
    const body = (await res.json()) as { syncedLyrics?: string | null };
    if (body.syncedLyrics && body.syncedLyrics.trim().length > 0) {
      return { syncedLyrics: body.syncedLyrics, source: "lrclib" };
    }
    return { syncedLyrics: null, source: "none" };
  } catch {
    return { syncedLyrics: null, source: "none" };
  } finally {
    clearTimeout(t);
  }
}
