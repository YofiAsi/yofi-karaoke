// Manual QA for lyrics lookup: runs the worker's real search against LRCLIB for given YouTube metadata.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

interface SongInput {
  title: string;
  channel: string;
  durationSeconds: number;
  track?: string;
  trackArtist?: string;
}

const FIELD_SEPARATOR = ";;";
const PREVIEW_LINES = 6;

function setPlaceholderEnv(): void {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.MINIO_ENDPOINT ??= "unused";
  process.env.MINIO_ACCESS_KEY ??= "unused";
  process.env.MINIO_SECRET_KEY ??= "unused";
}

function parseDuration(raw: string): number {
  const parts = raw.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) throw new Error(`bad duration: ${raw}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseFileLine(line: string): SongInput {
  const [title, channel, duration] = line.split(FIELD_SEPARATOR).map((field) => field.trim());
  if (!title || !channel || !duration) throw new Error(`expected "title ;; channel ;; duration" but got: ${line}`);
  return { title, channel, durationSeconds: parseDuration(duration) };
}

async function songsFromFile(path: string): Promise<SongInput[]> {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseFileLine);
}

function songFromFlags(values: Record<string, string | undefined>): SongInput {
  if (!values.title || !values.channel || !values.duration) {
    throw new Error('usage: --title "<video title>" --channel "<channel>" --duration <m:ss> [--track t --artist a] | --file songs.txt');
  }
  return {
    title: values.title,
    channel: values.channel,
    durationSeconds: parseDuration(values.duration),
    track: values.track,
    trackArtist: values.artist,
  };
}

function preview(text: string | null): string {
  if (!text) return "";
  return text.split(/\r?\n/).filter(Boolean).slice(0, PREVIEW_LINES).join("\n    ");
}

async function checkSong(song: SongInput): Promise<boolean> {
  const { fetchLyrics } = await import("../steps/lyrics.js");
  const { buildLyricsCandidates } = await import("../steps/lyricsQuery.js");
  const query = { title: song.title, artist: song.channel, track: song.track, trackArtist: song.trackArtist };

  console.log(`\n=== ${song.title}  [${song.channel}, ${song.durationSeconds}s]`);
  for (const candidate of buildLyricsCandidates(query)) {
    console.log(`  candidate (${candidate.kind}): track="${candidate.track}" artist="${candidate.artist}"`);
  }

  const result = await fetchLyrics({ ...query, durationSeconds: song.durationSeconds }, (message) =>
    console.log(`  log: ${message}`),
  );
  const kind = result.syncedLyrics ? "SYNCED" : result.plainLyrics ? "PLAIN" : "MISS";
  console.log(`  result: ${kind}  source=${result.source}  matched=${result.matchedQuery ?? "none"}  reason=${result.missReason ?? "none"}`);
  const text = preview(result.syncedLyrics ?? result.plainLyrics);
  if (text) console.log(`    ${text}`);
  return kind !== "MISS";
}

async function main(): Promise<void> {
  setPlaceholderEnv();
  const { values } = parseArgs({
    options: {
      title: { type: "string" },
      channel: { type: "string" },
      duration: { type: "string" },
      track: { type: "string" },
      artist: { type: "string" },
      file: { type: "string" },
    },
  });
  const songs = values.file ? await songsFromFile(values.file) : [songFromFlags(values)];
  let hits = 0;
  for (const song of songs) {
    if (await checkSong(song)) hits += 1;
  }
  console.log(`\n${hits} of ${songs.length} songs found lyrics`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
