import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({ env: {} }));

import { languageHint, parseTranscribeOutput } from "./transcribe.js";

describe("languageHint", () => {
  it("hints Hebrew from Hebrew letters in the title", () => {
    expect(languageHint("נופיה - פרח")).toBe("he");
    expect(languageHint("Drake - Hotline Bling", "Hotline Bling")).toBe("auto");
    expect(languageHint("Miki Matsubara - Stay With Me", null)).toBe("auto");
  });
});

describe("parseTranscribeOutput", () => {
  it("reads words from the last stdout line", () => {
    const stdout = 'log\n{"language": "he", "device": "cuda", "words": [{"text": " שלום", "start": 1.2, "end": 1.6, "probability": 0.9}, {"bad": 1}]}\n';
    expect(parseTranscribeOutput(stdout)).toEqual({
      language: "he",
      device: "cuda",
      words: [{ text: " שלום", start: 1.2, end: 1.6, probability: 0.9 }],
    });
  });

  it("rejects output that is not JSON", () => {
    expect(() => parseTranscribeOutput("Traceback")).toThrow(/did not emit JSON/);
  });
});
