import { describe, expect, it } from "vitest";
import { acceptsServerGain, vocalsUnavailableText, vocalsValueText } from "./vocalsSlider";

describe("vocalsValueText", () => {
  it("names zero as muted and the rest as percent", () => {
    expect(vocalsValueText(0)).toBe("Muted");
    expect(vocalsValueText(0.4)).toBe("40 percent");
    expect(vocalsValueText(0.35)).toBe("35 percent");
    expect(vocalsValueText(1)).toBe("100 percent");
  });
});

describe("acceptsServerGain", () => {
  it("never overwrites the slider while the user drags", () => {
    expect(acceptsServerGain(0.2, true, null, 0)).toBe(false);
  });

  it("follows other users when this user has not sent anything", () => {
    expect(acceptsServerGain(0.2, false, null, 0)).toBe(true);
  });

  it("ignores late echoes of intermediate values right after release", () => {
    expect(acceptsServerGain(0.3, false, { gain: 0.5, atMs: 1000 }, 1200)).toBe(false);
  });

  it("accepts the echo of the final value", () => {
    expect(acceptsServerGain(0.5, false, { gain: 0.5, atMs: 1000 }, 1100)).toBe(true);
  });

  it("accepts any value once the settle window has passed", () => {
    expect(acceptsServerGain(0.3, false, { gain: 0.5, atMs: 1000 }, 2500)).toBe(true);
  });
});

describe("vocalsUnavailableText", () => {
  it("explains a missing or failed vocals track and stays empty otherwise", () => {
    expect(vocalsUnavailableText(false, false)).toMatch(/no separate vocals track/);
    expect(vocalsUnavailableText(true, true)).toMatch(/failed to load/);
    expect(vocalsUnavailableText(true, false)).toBeNull();
  });
});
