// Transcribes a vocals stem on the GPU lane and returns its timed words.
import { env } from "../env.js";
import { runOnGpu, type GpuPriority } from "../gpu/index.js";
import type { TranscriptWord } from "../lyrics/tokens.js";

const HEBREW_LETTER = /[א-ת]/;

export interface Transcript {
  language: string;
  device: string;
  words: TranscriptWord[];
  wallMs: number;
  queuedMs: number;
}

export function languageHint(...texts: (string | null | undefined)[]): "he" | "auto" {
  return texts.some((text) => text && HEBREW_LETTER.test(text)) ? "he" : "auto";
}

export async function transcribeVocals(
  vocalsPath: string,
  language: "he" | "auto",
  priority: GpuPriority,
  timeoutMs: number = env.TRANSCRIBE_TIMEOUT_MS,
): Promise<Transcript> {
  const { result, queuedMs, runMs } = await runOnGpu<unknown>(
    "transcribe",
    { input: vocalsPath, language, modelDir: env.WHISPER_MODEL_DIR ?? env.AUDIO_SEP_MODEL_DIR, device: "cuda" },
    { timeoutMs, priority },
  );
  return { ...toTranscript(result), wallMs: runMs, queuedMs };
}

function isWord(value: unknown): value is TranscriptWord {
  const word = value as TranscriptWord;
  return typeof word?.text === "string" && typeof word.start === "number" && typeof word.end === "number";
}

export function toTranscript(value: unknown): Omit<Transcript, "wallMs" | "queuedMs"> {
  const parsed = (value ?? {}) as { language?: unknown; device?: unknown; words?: unknown };
  if (!Array.isArray(parsed.words)) throw new Error("transcription result has no words list");
  return {
    language: typeof parsed.language === "string" ? parsed.language : "unknown",
    device: typeof parsed.device === "string" ? parsed.device : "unknown",
    words: parsed.words.filter(isWord).map((w) => ({ ...w, probability: typeof w.probability === "number" ? w.probability : 1 })),
  };
}
