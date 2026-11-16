// Reruns the lyrics lookup and the vocals stem fallback for an already processed song, never downgrading stored lyrics.
import type { JobHelpers, Task } from "graphile-worker";
import { pool, notify } from "../db.js";
import { fetchLyrics, TRANSIENT_MISS_REASONS, type LyricsLogger, type LyricsResult, type LyricsSource } from "../steps/lyrics.js";
import { addTimedLyrics, planTimedLyrics, transcriptionEnabled } from "../steps/timedLyrics.js";
import { romanizeLyrics } from "../steps/romaji.js";
import { refetchPriority, type GpuPriority } from "../gpu/index.js";
import { withSongLock } from "../songLock.js";
import { withStemFile } from "../storage/stemFile.js";
import { PgNotifyChannels } from "@karaoke/shared";

interface RefetchLyricsPayload {
  songId: string;
}

interface StoredLyricsRow {
  title: string;
  artist: string;
  track: string | null;
  trackArtist: string | null;
  durationSeconds: number;
  lyricsLrc: string | null;
  lyricsPlain: string | null;
  lyricsSource: string | null;
  vocalsObjectKey: string | null;
}

type StoredLyrics = Pick<StoredLyricsRow, "lyricsLrc" | "lyricsPlain"> & { lyricsSource?: string | null };

export type RefetchDecision = "save" | "keep" | "retry";

export async function saveLyrics(songId: string, lyrics: LyricsResult): Promise<void> {
  await pool.query(
    `UPDATE "Song"
        SET "lyricsLrc" = $2,
            "lyricsPlain" = $3,
            "lyricsSource" = $4,
            "lyricsMissReason" = $5
      WHERE id = $1`,
    [songId, lyrics.syncedLyrics, lyrics.plainLyrics, lyrics.source, lyrics.missReason],
  );
}

async function saveLyricsIfUnchanged(songId: string, lyrics: LyricsResult, stored: StoredLyrics): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE "Song"
        SET "lyricsLrc" = $2,
            "lyricsPlain" = $3,
            "lyricsSource" = $4,
            "lyricsMissReason" = $5
      WHERE id = $1
        AND "lyricsLrc" IS NOT DISTINCT FROM $6
        AND "lyricsPlain" IS NOT DISTINCT FROM $7`,
    [songId, lyrics.syncedLyrics, lyrics.plainLyrics, lyrics.source, lyrics.missReason, stored.lyricsLrc, stored.lyricsPlain],
  );
  return (rowCount ?? 0) > 0;
}

async function saveTextIfUnchanged(songId: string, lyrics: LyricsResult, stored: StoredLyrics): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE "Song"
        SET "lyricsLrc" = $2,
            "lyricsPlain" = $3
      WHERE id = $1
        AND "lyricsLrc" IS NOT DISTINCT FROM $4
        AND "lyricsPlain" IS NOT DISTINCT FROM $5`,
    [songId, lyrics.syncedLyrics, lyrics.plainLyrics, stored.lyricsLrc, stored.lyricsPlain],
  );
  return (rowCount ?? 0) > 0;
}

export function lyricsRank(synced: string | null, plain: string | null, source?: string | null): number {
  if (synced?.trim()) return source === "whisper" ? 2 : source === "lrclib" ? 4 : 3;
  return plain?.trim() ? 1 : 0;
}

export function decideRefetch(stored: StoredLyrics, fresh: LyricsResult): RefetchDecision {
  if (fresh.missReason && TRANSIENT_MISS_REASONS.has(fresh.missReason)) return "retry";
  const freshRank = lyricsRank(fresh.syncedLyrics, fresh.plainLyrics, fresh.source);
  return freshRank >= lyricsRank(stored.lyricsLrc, stored.lyricsPlain, stored.lyricsSource) ? "save" : "keep";
}

export function storedAsResult(stored: StoredLyrics): LyricsResult {
  return {
    syncedLyrics: stored.lyricsLrc,
    plainLyrics: stored.lyricsPlain,
    source: (stored.lyricsSource ?? "none") as LyricsSource,
    missReason: null,
    matchedQuery: null,
  };
}

async function loadStoredLyrics(songId: string): Promise<StoredLyricsRow | null> {
  const { rows } = await pool.query<StoredLyricsRow>(
    `SELECT title, artist, track, "trackArtist", "durationSeconds", "lyricsLrc", "lyricsPlain", "lyricsSource", "vocalsObjectKey"
       FROM "Song" WHERE id = $1`,
    [songId],
  );
  return rows[0] ?? null;
}

async function withVocalsFallback(
  stored: StoredLyricsRow,
  lyrics: LyricsResult,
  log: LyricsLogger,
  priority: GpuPriority,
): Promise<LyricsResult> {
  if (!transcriptionEnabled() || planTimedLyrics(lyrics) === "skip") return lyrics;
  if (!stored.vocalsObjectKey) {
    log("timed lyrics skipped: song has no stored vocals stem");
    return lyrics;
  }
  try {
    return await withStemFile(stored.vocalsObjectKey, (file) => addTimedLyrics(stored, lyrics, file, log, priority));
  } catch (err) {
    log(`timed lyrics skipped: vocals stem unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return lyrics;
  }
}

async function freshLyrics(stored: StoredLyricsRow, log: LyricsLogger): Promise<LyricsResult> {
  if (stored.lyricsSource === "manual") return storedAsResult(stored);
  return fetchLyrics(stored, log);
}

function sameText(lyrics: LyricsResult, stored: StoredLyrics): boolean {
  return lyrics.syncedLyrics === stored.lyricsLrc && lyrics.plainLyrics === stored.lyricsPlain;
}

async function romanizeStored(songId: string, stored: StoredLyricsRow, log: LyricsLogger): Promise<void> {
  const romanized = await romanizeLyrics(storedAsResult(stored), log);
  if (sameText(romanized, stored)) return;
  if (await saveTextIfUnchanged(songId, romanized, stored)) {
    log("stored lyrics rewritten as romaji");
    await notify(PgNotifyChannels.queueUpdated, { reason: "lyrics_refetched", songId });
  }
}

async function refetchLocked(songId: string, helpers: JobHelpers): Promise<void> {
  const log: LyricsLogger = (msg) => helpers.logger.info(`refetchLyrics ${songId} ${msg}`);

  const stored = await loadStoredLyrics(songId);
  if (!stored) {
    helpers.logger.warn(`refetchLyrics ${songId} skipped: song no longer exists`);
    return;
  }
  const looked = await freshLyrics(stored, log);
  if (decideRefetch(stored, looked) === "retry") {
    await romanizeStored(songId, stored, log);
    throw new Error(`lyrics refetch for ${songId} hit a transient failure (${looked.missReason}); retrying later`);
  }
  const lyrics = await withVocalsFallback(stored, looked, log, refetchPriority(helpers.job));
  if (decideRefetch(stored, lyrics) === "keep") {
    log(`kept stored lyrics; new result (${lyrics.source}) is worse`);
    await romanizeStored(songId, stored, log);
    return;
  }
  const romanized = await romanizeLyrics(lyrics, log);
  if (!(await saveLyricsIfUnchanged(songId, romanized, stored))) {
    log("lyrics changed while this job ran; result dropped");
    return;
  }
  await notify(PgNotifyChannels.queueUpdated, { reason: "lyrics_refetched", songId });
}

export const refetchLyrics: Task = async (payload, helpers) => {
  const { songId } = payload as RefetchLyricsPayload;
  if (!songId) throw new Error("songId missing from payload");
  await withSongLock(songId, () => refetchLocked(songId, helpers));
};
