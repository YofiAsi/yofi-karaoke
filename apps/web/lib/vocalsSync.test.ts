import { describe, expect, it } from "vitest";
import {
  decideVocals,
  instrumentalSnapshot,
  vocalsActive,
  vocalsSnapshot,
  type InstrumentalSnapshot,
  type VocalsSnapshot,
} from "./vocalsSync";

const PLAYING: InstrumentalSnapshot = { paused: false, currentTime: 30 };
const PAUSED: InstrumentalSnapshot = { paused: true, currentTime: 30 };

function vocals(overrides: Partial<VocalsSnapshot> = {}): VocalsSnapshot {
  return { paused: false, buffering: false, currentTime: 30, duration: 200, ...overrides };
}

describe("vocalsActive", () => {
  it("needs a vocals stem and a gain above zero", () => {
    expect(vocalsActive(0.5, true)).toBe(true);
    expect(vocalsActive(0, true)).toBe(false);
    expect(vocalsActive(0.5, false)).toBe(false);
  });
});

describe("decideVocals", () => {
  it("starts the vocals when the gain rises while the instrumental plays", () => {
    expect(decideVocals(true, PLAYING, vocals({ paused: true, currentTime: 0 }))).toBe("start");
  });

  it("pauses the vocals at gain zero so they cost no bandwidth", () => {
    expect(decideVocals(false, PLAYING, vocals())).toBe("pause");
    expect(decideVocals(false, PLAYING, vocals({ paused: true }))).toBe("none");
  });

  it("mirrors a paused instrumental", () => {
    expect(decideVocals(true, PAUSED, vocals())).toBe("pause");
    expect(decideVocals(true, PAUSED, vocals({ paused: true }))).toBe("none");
  });

  it("leaves small drift alone", () => {
    expect(decideVocals(true, PLAYING, vocals({ currentTime: 30.05 }))).toBe("none");
    expect(decideVocals(true, PLAYING, vocals({ currentTime: 29.95 }))).toBe("none");
  });

  it("resyncs when the drift passes about 60 ms either way", () => {
    expect(decideVocals(true, PLAYING, vocals({ currentTime: 30.08 }))).toBe("resync");
    expect(decideVocals(true, PLAYING, vocals({ currentTime: 29.9 }))).toBe("resync");
  });

  it("waits while the vocals seek or buffer before judging drift", () => {
    expect(decideVocals(true, PLAYING, vocals({ buffering: true, currentTime: 12 }))).toBe("none");
  });

  it("does not restart vocals that ended at the end of the song", () => {
    const nearEnd = { paused: false, currentTime: 199.95 };
    expect(decideVocals(true, nearEnd, vocals({ paused: true, currentTime: 200 }))).toBe("none");
  });

  it("restarts after a seek back from the end", () => {
    expect(decideVocals(true, PLAYING, vocals({ paused: true, currentTime: 200 }))).toBe("start");
  });

  it("starts when the vocals duration is not known yet", () => {
    expect(decideVocals(true, PLAYING, vocals({ paused: true, duration: Number.NaN }))).toBe("start");
  });
});

describe("snapshots", () => {
  const media = { paused: false, seeking: false, readyState: 4, currentTime: 10, duration: 200 };

  it("treats a stalled instrumental as paused so the vocals wait for it", () => {
    expect(instrumentalSnapshot(media).paused).toBe(false);
    expect(instrumentalSnapshot({ ...media, readyState: 2 }).paused).toBe(true);
    expect(instrumentalSnapshot({ ...media, seeking: true }).paused).toBe(true);
  });

  it("marks vocals that seek or lack data as buffering", () => {
    expect(vocalsSnapshot(media).buffering).toBe(false);
    expect(vocalsSnapshot({ ...media, readyState: 1 }).buffering).toBe(true);
  });
});
