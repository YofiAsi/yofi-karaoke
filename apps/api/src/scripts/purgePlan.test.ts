import { describe, expect, it } from "vitest";
import { planPurge } from "./purgePlan.js";

const NOW = new Date("2026-11-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("planPurge", () => {
  it("deletes only old objects that no song references", () => {
    const objects = [
      { key: "instrumentals/live.mp3", lastModified: hoursAgo(48) },
      { key: "vocals/live.mp3", lastModified: hoursAgo(48) },
      { key: "instrumentals/old.mp3", lastModified: hoursAgo(48) },
      { key: "vocals/old.mp3", lastModified: hoursAgo(2) },
      { key: "vocals/uploading.mp3", lastModified: hoursAgo(0.1) },
    ];
    const referenced = new Set(["instrumentals/live.mp3", "vocals/live.mp3"]);
    expect(planPurge(objects, referenced, NOW)).toEqual({
      deleteKeys: ["instrumentals/old.mp3", "vocals/old.mp3"],
      keptReferenced: 2,
      keptRecent: 1,
    });
  });

  it("treats an object without a timestamp as old", () => {
    const plan = planPurge([{ key: "vocals/x.mp3", lastModified: null }], new Set(), NOW);
    expect(plan.deleteKeys).toEqual(["vocals/x.mp3"]);
  });

  it("deletes nothing when every object is referenced", () => {
    const plan = planPurge([{ key: "vocals/x.mp3", lastModified: hoursAgo(5) }], new Set(["vocals/x.mp3"]), NOW);
    expect(plan).toEqual({ deleteKeys: [], keptReferenced: 1, keptRecent: 0 });
  });
});
