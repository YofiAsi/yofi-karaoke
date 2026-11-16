import { describe, expect, it } from "vitest";
import { buildLines, collapseRepeats, joinWords } from "./lineBuilder.js";
import { lineUnits, type TranscriptWord } from "./tokens.js";

function words(text: string, start: number, step = 0.4, probability = 0.9): TranscriptWord[] {
  return text.split(" ").map((word, i) => ({
    text: ` ${word}`,
    start: start + i * step,
    end: start + i * step + step * 0.8,
    probability,
  }));
}

describe("buildLines", () => {
  it("breaks on pauses and keeps the first word time", () => {
    const lines = buildLines([...words("you used to call me", 10), ...words("on my cell phone", 14)]);
    expect(lines).toEqual([
      { start: 10, text: "you used to call me" },
      { start: 14, text: "on my cell phone" },
    ]);
  });

  it("splits a long run without pauses into karaoke sized lines", () => {
    const run = words("one two three four five six seven eight nine ten eleven twelve thirteen fourteen", 0, 0.3);
    const lines = buildLines(run);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(lineUnits(line.text)).toBeGreaterThanOrEqual(3);
      expect(lineUnits(line.text)).toBeLessThanOrEqual(8);
    }
    expect(lines.map((l) => l.text).join(" ")).toBe(run.map((w) => w.text.trim()).join(" "));
  });

  it("breaks after sentence ends", () => {
    const lines = buildLines(words("I know. When that hotline bling", 0, 0.3));
    expect(lines.map((l) => l.text)).toEqual(["I know. When that hotline bling"]);
    const longer = buildLines(words("I know you know. When that hotline bling rings", 0, 0.3));
    expect(longer.map((l) => l.text)).toEqual(["I know you know.", "When that hotline bling rings"]);
  });

  it("builds Hebrew lines without empty or overlapping entries", () => {
    const lines = buildLines([
      ...words("מאמי איך את מרגישה", 5),
      ...words("שאת לבד בבית", 9),
      ...words("ומי זה שאיתך שותה קפה", 13),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["מאמי איך את מרגישה", "שאת לבד בבית", "ומי זה שאיתך שותה קפה"]);
    for (let i = 1; i < lines.length; i += 1) expect(lines[i].start).toBeGreaterThan(lines[i - 1].start);
  });

  it("merges a short tail into its close neighbour", () => {
    const lines = buildLines([...words("tell me why", 0), ...words("baby", 2.0)]);
    expect(lines.map((l) => l.text)).toEqual(["tell me why baby"]);
  });

  it("drops subtitle credits and thanks for watching", () => {
    const lines = buildLines([
      ...words("you used to call me", 1),
      ...words("Subtitles by the Amara.org community", 200),
      ...words("תודה רבה שצפיתם", 220),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["you used to call me"]);
  });

  it("drops isolated low confidence text in long silent stretches", () => {
    const lines = buildLines([
      ...words("you used to call me", 1),
      ...words("hmm yeah", 60, 0.4, 0.3),
      ...words("on my cell phone", 120),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["you used to call me", "on my cell phone"]);
  });

  it("drops stretched low confidence words", () => {
    const stretched: TranscriptWord[] = [
      { text: " la", start: 30, end: 34, probability: 0.4 },
      { text: " la", start: 34, end: 38, probability: 0.4 },
      { text: " la", start: 38, end: 42, probability: 0.4 },
    ];
    expect(buildLines([...words("you used to call me", 1), ...stretched])).toHaveLength(1);
  });

  it("collapses a phrase repeated many times", () => {
    const loop = Array.from({ length: 8 }, (_, i) => words("I love you so", i * 2, 0.4)).flat();
    const lines = buildLines(loop);
    expect(lines.map((l) => l.text).join(" ")).toBe("I love you so I love you so");
  });

  it("keeps a phrase sung twice", () => {
    const twice = [...words("hotline bling", 0), ...words("hotline bling", 3)];
    expect(collapseRepeats(twice)).toHaveLength(4);
  });

  it("joins Japanese tokens without spaces", () => {
    const japanese: TranscriptWord[] = ["私", "は", "私", " あなた", "は", "あなた", "と"].map((text, i) => ({
      text,
      start: i * 0.3,
      end: i * 0.3 + 0.25,
      probability: 0.9,
    }));
    expect(joinWords(japanese)).toBe("私は私 あなたはあなたと");
  });

  it("returns nothing for an empty transcript", () => {
    expect(buildLines([])).toEqual([]);
  });
});
