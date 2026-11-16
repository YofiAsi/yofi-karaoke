import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { languageHint, toTranscript } from "./transcribe.js";

describe("languageHint", () => {
  it("hints Hebrew from Hebrew letters in the title", () => {
    expect(languageHint("נופיה - פרח")).toBe("he");
    expect(languageHint("Drake - Hotline Bling", "Hotline Bling")).toBe("auto");
    expect(languageHint("Miki Matsubara - Stay With Me", null)).toBe("auto");
  });
});

describe("toTranscript", () => {
  it("keeps only well formed words from the sidecar result", () => {
    const result = { language: "he", device: "cuda", words: [{ text: " שלום", start: 1.2, end: 1.6, probability: 0.9 }, { bad: 1 }] };
    expect(toTranscript(result)).toEqual({
      language: "he",
      device: "cuda",
      words: [{ text: " שלום", start: 1.2, end: 1.6, probability: 0.9 }],
    });
  });

  it("rejects a result without a words list", () => {
    expect(() => toTranscript({ language: "he" })).toThrow(/no words list/);
  });
});
