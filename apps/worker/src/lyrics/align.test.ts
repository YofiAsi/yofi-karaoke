import { describe, expect, it } from "vitest";
import { alignLyrics, referenceLines } from "./align.js";
import type { TranscriptWord } from "./tokens.js";

function sung(text: string, start: number, step = 0.4): TranscriptWord[] {
  return text.split(" ").map((word, i) => ({
    text: ` ${word}`,
    start: start + i * step,
    end: start + i * step + step * 0.8,
    probability: 0.9,
  }));
}

function startsOf(result: ReturnType<typeof alignLyrics>): number[] {
  if (!result.ok) throw new Error(result.reason);
  return result.lines.map((line) => Math.round(line.start * 100) / 100);
}

describe("alignLyrics", () => {
  it("keeps the reference text and takes timing from the transcript", () => {
    const reference = "You used to call me on my cell phone\nLate night when you need my love";
    const words = [...sung("you used to call me on my cellphone", 11), ...sung("late night when you need my love", 16)];
    const result = alignLyrics(reference, words);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((l) => l.text)).toEqual(reference.split("\n"));
    expect(startsOf(result)).toEqual([11, 16]);
  });

  it("aligns Hebrew lines with misheard words", () => {
    const reference = "מאמי, איך את מרגישה\nשאת לבד בבית\nומי זה שאיתך שותה קפה שם במקומי";
    const words = [
      ...sung("מה מי איך את מרגישה", 5),
      ...sung("שאת לבד בבית", 9),
      ...sung("ומי זה שאיתך שותה קפה שם במקומי", 12),
    ];
    const starts = startsOf(alignLyrics(reference, words));
    expect(Math.abs(starts[0] - 5)).toBeLessThan(0.6);
    expect(starts.slice(1)).toEqual([9, 12]);
  });

  it("ignores niqqud and final letter forms", () => {
    const words = sung("שלום עולם ומלואו", 3);
    expect(startsOf(alignLyrics("שָׁלוֹם עוֹלָם וּמְלוֹאוֹ", words))).toEqual([3]);
  });

  it("places repeated choruses in order", () => {
    const chorus = "hotline bling that can only mean one thing";
    const reference = [chorus, "ever since I left the city", chorus].join("\n");
    const words = [...sung(chorus, 20), ...sung("ever since I left the city", 30), ...sung(chorus, 60)];
    expect(startsOf(alignLyrics(reference, words))).toEqual([20, 30, 60]);
  });

  it("interpolates lines the transcript missed between matched neighbours", () => {
    const reference = ["first line is here now", "second line nobody heard", "third line is here too", "fourth line comes last"].join("\n");
    const words = [...sung("first line is here now", 10), ...sung("third line is here too", 20), ...sung("fourth line comes last", 30)];
    const starts = startsOf(alignLyrics(reference, words));
    expect(starts[0]).toBe(10);
    expect(starts[1]).toBeGreaterThan(10);
    expect(starts[1]).toBeLessThan(20);
    expect(starts.slice(2)).toEqual([20, 30]);
  });

  it("estimates the start when only later words of a line were heard", () => {
    const reference = "someone said goodbye to me\nand then the night was over";
    const words = [...sung("goodbye to me", 10.8), ...sung("and then the night was over", 15)];
    const [first] = startsOf(alignLyrics(reference, words));
    expect(first).toBeGreaterThan(9.5);
    expect(first).toBeLessThan(10.8);
  });

  it("aligns Japanese text character by character", () => {
    const reference = "私は私 貴方は貴方と\n昨夜言ってたそんな気もするわ";
    const words: TranscriptWord[] = [
      ...["私", "は", "私", " あなた", "は", "あなた", "と"].map((text, i) => ({ text, start: 23 + i * 0.4, end: 23 + i * 0.4 + 0.3, probability: 0.9 })),
      ...["ゆうべ", "言って", "た", " そんな", "気", "も", "する", "わ"].map((text, i) => ({ text, start: 31 + i * 0.4, end: 31 + i * 0.4 + 0.3, probability: 0.9 })),
    ];
    const starts = startsOf(alignLyrics(reference, words));
    expect(starts[0]).toBe(23);
    expect(Math.abs(starts[1] - 31)).toBeLessThan(1.5);
  });

  it("rejects the result when too few words match", () => {
    const reference = "completely different words\nnothing in common at all\nanother unrelated line";
    const result = alignLyrics(reference, sung("hotline bling that can only mean one thing", 5));
    expect(result.ok).toBe(false);
  });

  it("rejects an empty transcript", () => {
    expect(alignLyrics("some lyrics", []).ok).toBe(false);
  });

  it("always returns strictly increasing starts", () => {
    const reference = "la la la\nla la la\nla la la";
    const result = alignLyrics(reference, sung("la la la", 4));
    if (!result.ok) return;
    for (let i = 1; i < result.lines.length; i += 1) expect(result.lines[i].start).toBeGreaterThan(result.lines[i - 1].start);
  });
});

describe("referenceLines", () => {
  it("drops blank lines, section labels, repeat markers and LRC timestamps", () => {
    const text = "[Chorus]\n[00:12.34]Hello there (x2)\n\nפזמון:\nשלום לך\n...";
    expect(referenceLines(text)).toEqual(["Hello there", "שלום לך"]);
  });
});
