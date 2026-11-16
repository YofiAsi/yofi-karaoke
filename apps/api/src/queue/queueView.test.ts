import { describe, expect, it, vi } from "vitest";
import type { QueueItemWithRelations } from "./queueView.js";

vi.mock("../db.js", () => ({ prisma: {} }));

import { SONG_VIEW_SELECT, buildQueueView } from "./queueView.js";

const USER = { id: "00000000-0000-4000-8000-0000000000f1", name: "Dana" };

function item(
  id: string,
  position: number,
  state: string,
  instrumental = true,
  vocals = false,
): QueueItemWithRelations {
  return {
    id,
    songId: `song-${id}`,
    requestedByUserId: USER.id,
    position,
    state,
    createdAt: new Date(0),
    playedAt: null,
    song: {
      id: `song-${id}`,
      youtubeVideoId: "dQw4w9WgXcQ",
      title: `Title ${id}`,
      artist: "Artist",
      channel: "Channel",
      durationSeconds: 200,
      thumbnailUrl: "",
      instrumentalObjectKey: instrumental ? "key" : null,
      vocalsObjectKey: vocals ? "vocals-key" : null,
      lyricsLrc: null,
      lyricsPlain: null,
    },
    requestedByUser: USER,
  } as unknown as QueueItemWithRelations;
}

describe("buildQueueView", () => {
  it("takes current from the playback pointer, not from the first ready item", () => {
    const view = buildQueueView([item("a", 1, "ready"), item("b", 2, "ready")], "b", []);
    expect(view.current?.id).toBe("b");
    expect(view.upcoming.map((i) => i.id)).toEqual(["a"]);
  });

  it("has no current item when nothing is playing", () => {
    const view = buildQueueView([item("a", 1, "ready")], null, []);
    expect(view.current).toBeNull();
    expect(view.upcoming.map((i) => i.id)).toEqual(["a"]);
  });

  it("ignores a pointer to an item that is not ready", () => {
    const view = buildQueueView([item("a", 1, "failed", false)], "a", []);
    expect(view.current).toBeNull();
    expect(view.upcoming.map((i) => i.id)).toEqual(["a"]);
  });

  it("orders upcoming by position and keeps failed items visible", () => {
    const items = [item("c", 3, "processing", false), item("a", 1, "failed", false), item("b", 2, "ready")];
    const view = buildQueueView(items, "b", []);
    expect(view.upcoming.map((i) => [i.id, i.state])).toEqual([
      ["a", "failed"],
      ["c", "processing"],
    ]);
  });

  it("attaches the newest processing job per song", () => {
    const jobs = [
      { songId: "song-a", step: "separating" as const, progressPct: 40, errorMessage: null },
      { songId: "song-a", step: "error" as const, progressPct: 0, errorMessage: "old" },
    ];
    const view = buildQueueView([item("a", 1, "processing", false)], null, jobs);
    expect(view.upcoming[0]?.progress).toEqual({ step: "separating", progressPct: 40, errorMessage: null });
    expect(view.upcoming[0]?.song.hasInstrumental).toBe(false);
  });

  it("reports whether the song has a vocals stem", () => {
    const view = buildQueueView([item("a", 1, "ready", true, true), item("b", 2, "ready")], "a", []);
    expect(view.current?.song.hasVocals).toBe(true);
    expect(view.upcoming[0]?.song.hasVocals).toBe(false);
  });
});

describe("SONG_VIEW_SELECT", () => {
  it("loads only the song columns the views use, never the word timings", () => {
    expect(SONG_VIEW_SELECT).not.toHaveProperty("lyricsWordTimings");
    expect(SONG_VIEW_SELECT).toMatchObject({ lyricsLrc: true, lyricsPlain: true, instrumentalObjectKey: true });
  });
});
