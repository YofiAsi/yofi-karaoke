import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../env.js";
import { runProcess } from "./runProcess.js";

const PYTHON_UTF8_ENV = { ...process.env, PYTHONIOENCODING: "utf-8" };

export interface SeparatedStems {
  instrumentalPath: string;
  vocalsPath: string | null;
}

export interface SeparateResult extends SeparatedStems {
  wallMs: number;
}

export async function separateVocals(
  workDir: string,
  inputAudio: string,
): Promise<SeparateResult> {
  const outputDir = path.join(workDir, "sep");
  await mkdir(outputDir, { recursive: true });

  const started = Date.now();
  const result = await runProcess(env.PYTHON_BIN, [
    env.SEPARATE_PY_PATH,
    "--input",
    inputAudio,
    "--output-dir",
    outputDir,
    "--model",
    env.AUDIO_SEP_MODEL,
    "--backend",
    env.SEPARATOR_BACKEND,
    "--model-dir",
    env.AUDIO_SEP_MODEL_DIR,
    "--bitrate",
    env.STEM_BITRATE,
  ], { timeoutMs: env.SEPARATE_TIMEOUT_MS, label: "separate.py", env: PYTHON_UTF8_ENV });
  const wallMs = Date.now() - started;

  return { ...parseSeparateOutput(result.stdout, result.stderr), wallMs };
}

export function parseSeparateOutput(stdout: string, stderr: string): SeparatedStems {
  const lastLine = stdout.trim().split(/\r?\n/).pop() ?? "";
  let parsed: { instrumentalPath?: unknown; vocalsPath?: unknown };
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(
      `separate.py did not emit JSON on last stdout line. last="${lastLine}" stderr=${stderr}`,
    );
  }
  if (typeof parsed.instrumentalPath !== "string" || !parsed.instrumentalPath) {
    throw new Error(`separate.py output missing instrumentalPath: ${lastLine}`);
  }
  const vocalsPath = typeof parsed.vocalsPath === "string" && parsed.vocalsPath ? parsed.vocalsPath : null;
  return { instrumentalPath: parsed.instrumentalPath, vocalsPath };
}
