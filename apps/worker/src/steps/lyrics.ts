import { env } from "../env.js";

export interface LrcLibResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  source: "lrclib" | "lrclib_plain" | "ovh" | "none";
}

export async function fetchLyrics(params: {
  title: string;
  artist: string;
  durationSeconds: number;
}): Promise<LrcLibResult> {
  const lrcResult = await fetchFromLrclib(params);
  if (lrcResult) return lrcResult;

  const ovhResult = await fetchFromOvh(params.artist, params.title);
  if (ovhResult) return ovhResult;

  return { syncedLyrics: null, plainLyrics: null, source: "none" };
}

async function fetchFromLrclib(params: {
  title: string;
  artist: string;
  durationSeconds: number;
}): Promise<LrcLibResult | null> {
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
    if (!res.ok) return null;
    const body = (await res.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    };
    if (body.syncedLyrics?.trim()) {
      return { syncedLyrics: body.syncedLyrics, plainLyrics: null, source: "lrclib" };
    }
    if (body.plainLyrics?.trim()) {
      return { syncedLyrics: null, plainLyrics: body.plainLyrics, source: "lrclib_plain" };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFromOvh(
  artist: string,
  title: string,
): Promise<LrcLibResult | null> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), env.LRCLIB_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "karaoke-worker/0.1" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lyrics?: string };
    if (data.lyrics?.trim()) {
      return { syncedLyrics: null, plainLyrics: data.lyrics, source: "ovh" };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
