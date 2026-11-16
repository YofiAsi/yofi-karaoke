// Word level timings stored beside a song's LRC text: one entry per synced line, in LRC order, times in seconds.
import { z } from "zod";

export const MAX_TIMED_LINES = 2000;
export const MAX_TIMED_WORDS_PER_LINE = 200;
export const MAX_TIMED_WORD_CHARS = 200;

const SecondsSchema = z.number().finite().nonnegative();

export const TimedWordSchema = z
  .object({
    text: z.string().min(1).max(MAX_TIMED_WORD_CHARS),
    start: SecondsSchema,
    end: SecondsSchema,
  })
  .refine((word) => word.end >= word.start, { message: "word ends before it starts" });
export type TimedWord = z.infer<typeof TimedWordSchema>;

export const TimedLineSchema = z
  .object({
    start: SecondsSchema,
    end: SecondsSchema,
    words: z.array(TimedWordSchema).max(MAX_TIMED_WORDS_PER_LINE),
  })
  .refine((line) => line.end >= line.start, { message: "line ends before it starts" });
export type TimedLine = z.infer<typeof TimedLineSchema>;

export const LyricsWordTimingsSchema = z.array(TimedLineSchema).max(MAX_TIMED_LINES);
export type LyricsWordTimings = z.infer<typeof LyricsWordTimingsSchema>;

export function parseWordTimings(value: unknown): LyricsWordTimings | null {
  const parsed = LyricsWordTimingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
