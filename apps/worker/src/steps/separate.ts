import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../env.js";

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
  const result = await runPython([
    env.SEPARATE_PY_PATH,
    "--input",
    inputAudio,
    "--output-dir",
    outputDir,
    "--model",
    env.AUDIO_SEP_MODEL,
    "--backend",
    env.SEPARATOR_BACKEND,
    "--bitrate",
    env.STEM_BITRATE,
  ]);
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

function runPython(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.PYTHON_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `separate.py timed out after ${env.SEPARATE_TIMEOUT_MS}ms\nstderr: ${stderr}`,
        ),
      );
    }, env.SEPARATE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `separate.py exited with code ${code}\nstderr: ${stderr}`,
          ),
        );
      }
    });
  });
}
