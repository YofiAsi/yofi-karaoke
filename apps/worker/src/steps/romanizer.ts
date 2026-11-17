// Runs python/romanize.py once per song: lyric lines in on stdin, Hepburn romaji lines out on stdout.
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import { runProcess } from "./runProcess.js";

const ROMANIZE_PY = fileURLToPath(new URL("../../python/romanize.py", import.meta.url));
const ROMANIZE_TIMEOUT_MS = 30_000;
const PYTHON_UTF8_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

export interface RomanizerOutput {
  lines: string[];
  failed: number;
  fallback?: string | null;
}

function lastJsonLine(stdout: string): unknown {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`romanize.py printed no JSON result: ${line.slice(0, 200)}`);
  }
}

function isStringList(value: unknown, length: number): value is string[] {
  return Array.isArray(value) && value.length === length && value.every((line) => typeof line === "string");
}

export function parseRomanizerOutput(stdout: string, expectedLines: number): RomanizerOutput {
  const parsed = (lastJsonLine(stdout) ?? {}) as { lines?: unknown; failed?: unknown; unavailable?: unknown; fallback?: unknown };
  if (typeof parsed.unavailable === "string") throw new Error(`romanizer unavailable: ${parsed.unavailable}`);
  if (!isStringList(parsed.lines, expectedLines)) throw new Error(`romanize.py returned a wrong line list for ${expectedLines} lines`);
  return {
    lines: parsed.lines,
    failed: typeof parsed.failed === "number" ? parsed.failed : 0,
    fallback: typeof parsed.fallback === "string" ? parsed.fallback : null,
  };
}

export async function runRomanizer(lines: string[]): Promise<RomanizerOutput> {
  const { stdout } = await runProcess(env.PYTHON_BIN, [ROMANIZE_PY], {
    timeoutMs: ROMANIZE_TIMEOUT_MS,
    label: "romanize.py",
    input: JSON.stringify({ lines }),
    env: PYTHON_UTF8_ENV,
  });
  return parseRomanizerOutput(stdout, lines.length);
}
