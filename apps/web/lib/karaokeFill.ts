// Progressive word fill: text direction from the first strong character, fill fraction per word, and the CSS that paints it.
import type { KaraokeLine, KaraokeWord } from "./karaokeLines";

export type TextDirection = "rtl" | "ltr";

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const ANY_LETTER = /\p{L}/u;

export function firstStrongDirection(text: string): TextDirection | null {
  for (const char of text) {
    if (RTL_LETTER.test(char)) return "rtl";
    if (ANY_LETTER.test(char)) return "ltr";
  }
  return null;
}

export function lineDirection(text: string): TextDirection {
  return firstStrongDirection(text) ?? "ltr";
}

export function wordDirection(word: string, line: TextDirection): TextDirection {
  return firstStrongDirection(word) ?? line;
}

export function wordFill(word: KaraokeWord, time: number): number {
  if (time >= word.end) return 1;
  if (time < word.start) return 0;
  return (time - word.start) / (word.end - word.start);
}

export function lineFills(line: KaraokeLine, time: number): number[] {
  return line.words.map((word) => wordFill(word, time));
}

export interface FillStyle {
  color: string;
  backgroundImage?: string;
  backgroundClip?: string;
  WebkitBackgroundClip?: string;
  WebkitTextFillColor?: string;
}

export function fillStyle(fraction: number, direction: TextDirection, sung: string, unsung: string): FillStyle {
  if (fraction >= 1) return { color: sung };
  if (fraction <= 0) return { color: unsung };
  const edge = `${(fraction * 100).toFixed(2)}%`;
  const towards = direction === "rtl" ? "left" : "right";
  return {
    color: "transparent",
    backgroundImage: `linear-gradient(to ${towards}, ${sung} ${edge}, ${unsung} ${edge})`,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };
}
