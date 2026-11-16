// Runs transcribe.py on a vocals stem and returns its timed words.
import { env } from "../env.js";
import type { TranscriptWord } from "../lyrics/tokens.js";
import { runProcess } from "./runProcess.js";

const PYTHON_UTF8_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
const HEBREW_LETTER = /[א-ת]/;

export interface Transcript {
  language: string;
  device: string;
  words: TranscriptWord[];
  wallMs: number;
}

export function languageHint(...texts: (string | null | undefined)[]): "he" | "auto" {
  return texts.some((text) => text && HEBREW_LETTER.test(text)) ? "he" : "auto";
}

export async function transcribeVocals(vocalsPath: string, language: "he" | "auto"): Promise<Transcript> {
  const started = Date.now();
  const result = await runProcess(env.PYTHON_BIN, [
    env.TRANSCRIBE_PY_PATH,
    "--input",
    vocalsPath,
    "--language",
    language,
    "--model-dir",
    env.WHISPER_MODEL_DIR ?? env.AUDIO_SEP_MODEL_DIR,
    "--device",
    "cuda",
  ], { timeoutMs: env.TRANSCRIBE_TIMEOUT_MS, label: "transcribe.py", env: PYTHON_UTF8_ENV });
  return { ...parseTranscribeOutput(result.stdout), wallMs: Date.now() - started };
}

function isWord(value: unknown): value is TranscriptWord {
  const word = value as TranscriptWord;
  return typeof word?.text === "string" && typeof word.start === "number" && typeof word.end === "number";
}

export function parseTranscribeOutput(stdout: string): Omit<Transcript, "wallMs"> {
  const lastLine = stdout.trim().split(/\r?\n/).pop() ?? "";
  let parsed: { language?: unknown; device?: unknown; words?: unknown };
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(`transcribe.py did not emit JSON on its last stdout line: "${lastLine.slice(0, 200)}"`);
  }
  if (!Array.isArray(parsed.words)) throw new Error("transcribe.py output has no words list");
  return {
    language: typeof parsed.language === "string" ? parsed.language : "unknown",
    device: typeof parsed.device === "string" ? parsed.device : "unknown",
    words: parsed.words.filter(isWord).map((w) => ({ ...w, probability: typeof w.probability === "number" ? w.probability : 1 })),
  };
}
