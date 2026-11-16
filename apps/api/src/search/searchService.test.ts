import { describe, expect, it, vi } from "vitest";
import type { SearchResultItem } from "@karaoke/shared";
import { createSearchService, SearchBusyError, type SearchFn } from "./searchService.js";

function result(id: string): SearchResultItem {
  return { youtubeVideoId: id, title: id, channel: "c", durationSeconds: 1, thumbnailUrl: "https://x/y.jpg" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("search service", () => {
  it("serves a repeated normalized query from the cache until the ttl passes", async () => {
    const time = clock();
    const search = vi.fn<SearchFn>(async (q) => [result(q)]);
    const service = createSearchService({ search, now: time.now });

    await service.search("u", "Shalom  Olam");
    const second = await service.search("u", "  shalom olam ");
    expect(search).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ kind: "ok", results: [result("shalom olam")] });

    time.advance(10 * 60_000);
    await service.search("u", "shalom olam");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("shares one search between identical in flight queries", async () => {
    const pending = deferred<SearchResultItem[]>();
    const search = vi.fn<SearchFn>(() => pending.promise);
    const service = createSearchService({ search });

    const first = service.search("a", "song");
    const second = service.search("b", "SONG");
    pending.resolve([result("x")]);

    expect(await first).toEqual(await second);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("runs at most two searches at once", async () => {
    const gates = [deferred<SearchResultItem[]>(), deferred<SearchResultItem[]>(), deferred<SearchResultItem[]>()];
    let call = 0;
    const search = vi.fn<SearchFn>(() => gates[call++].promise);
    const service = createSearchService({ search });

    const runs = ["a", "b", "c"].map((q) => service.search("u", q));
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(2);

    gates[0].resolve([]);
    await runs[0];
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(3);
    gates[1].resolve([]);
    gates[2].resolve([]);
    await Promise.all(runs);
  });

  it("rate limits cache misses per user and recovers after the window", async () => {
    const time = clock();
    const search = vi.fn<SearchFn>(async () => []);
    const service = createSearchService({ search, now: time.now, perUserLimit: 2 });

    await service.search("u", "one");
    await service.search("u", "two");
    expect(await service.search("u", "three")).toEqual({ kind: "rate_limited", retryAfterSeconds: 60 });
    expect(await service.search("u", "one")).toMatchObject({ kind: "ok" });
    expect(await service.search("other", "three")).toMatchObject({ kind: "ok" });

    time.advance(60_000);
    expect(await service.search("u", "four")).toMatchObject({ kind: "ok" });
  });

  it("reports busy when too many distinct searches are waiting", async () => {
    const pending = deferred<SearchResultItem[]>();
    const search = vi.fn<SearchFn>(() => pending.promise);
    const service = createSearchService({ search, maxConcurrent: 1, maxWaiting: 1 });

    const running = service.search("u", "a");
    const waiting = service.search("u", "b");
    await expect(service.search("u", "c")).rejects.toBeInstanceOf(SearchBusyError);
    pending.resolve([]);
    await Promise.all([running, waiting]);
  });

  it("does not cache failures", async () => {
    const search = vi.fn<SearchFn>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    const service = createSearchService({ search });

    await expect(service.search("u", "q")).rejects.toThrow("boom");
    expect(await service.search("u", "q")).toEqual({ kind: "ok", results: [] });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
