import { describe, expect, it, vi } from "vitest";
import { searchYoutube } from "./searchRequest";
import { addSongErrorMessage, isAlreadyQueued } from "./addSongError";
import { ApiError } from "./api";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
}

const signal = new AbortController().signal;

describe("searchYoutube", () => {
  it("returns results and passes the abort signal", async () => {
    const fetchFn = respond(200, [{ youtubeVideoId: "x" }]);
    expect(await searchYoutube("שיר שמח", signal, fetchFn)).toEqual({ kind: "ok", results: [{ youtubeVideoId: "x" }] });
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/search?q=${encodeURIComponent("שיר שמח")}`,
      expect.objectContaining({ signal }),
    );
  });

  it("reports rate limiting with the retry delay", async () => {
    const fetchFn = respond(429, { error: "rate_limited" }, { "Retry-After": "12" });
    expect(await searchYoutube("q", signal, fetchFn)).toEqual({ kind: "rate_limited", retryAfterSeconds: 12 });
  });

  it("separates unavailable videos from other failures", async () => {
    expect(await searchYoutube("q", signal, respond(422, { error: "video_unavailable" }))).toEqual({ kind: "unavailable" });
    expect(await searchYoutube("q", signal, respond(502, { error: "search_failed" }))).toEqual({ kind: "failed" });
  });

  it("reports a busy server separately", async () => {
    expect(await searchYoutube("q", signal, respond(503, { error: "search_busy" }))).toEqual({ kind: "busy" });
  });
});

describe("addSongErrorMessage", () => {
  it("explains the queue limit and falls back for unknown errors", () => {
    expect(addSongErrorMessage(new ApiError(409, "queue_limit"))).toMatch(/song limit/);
    expect(addSongErrorMessage(new Error("network"))).toBe("Could not add to queue.");
    expect(isAlreadyQueued(new ApiError(409, "already_queued"))).toBe(true);
    expect(isAlreadyQueued(new ApiError(409, "queue_limit"))).toBe(false);
  });
});
