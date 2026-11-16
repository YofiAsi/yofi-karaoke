// Turns raw yt-dlp search entries into the short list of karaoke friendly results shown to guests.
import type { SearchResultItem } from "@karaoke/shared";
import type { YtDlpSearchEntry } from "../ytdlp.js";

const MAX_DURATION_SEC = 600;
const MAX_RESULTS = 6;

export function normalizeQuery(query: string): string {
  return query.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function pickThumbnail(entry: YtDlpSearchEntry): string {
  if (entry.thumbnail) return entry.thumbnail;
  const list = entry.thumbnails ?? [];
  if (list.length === 0) return `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
  const sorted = [...list].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  );
  return sorted[0].url;
}

function isSingable(entry: YtDlpSearchEntry): boolean {
  return (
    !entry.is_live &&
    typeof entry.duration === "number" &&
    entry.duration > 0 &&
    entry.duration < MAX_DURATION_SEC
  );
}

function toResult(entry: YtDlpSearchEntry): SearchResultItem {
  return {
    youtubeVideoId: entry.id,
    title: entry.title,
    channel: entry.channel ?? entry.uploader ?? "Unknown",
    durationSeconds: Math.round(entry.duration ?? 0),
    thumbnailUrl: pickThumbnail(entry),
  };
}

export function toSearchResults(entries: YtDlpSearchEntry[]): SearchResultItem[] {
  return entries.filter(isSingable).slice(0, MAX_RESULTS).map(toResult);
}
