import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../env.js";

export interface SeparateResult {
  instrumentalPath: string;
  wallMs: number;
}

export async function separateVocals(
  songId: string,
  inputAudio: string,
): Promise<SeparateResult> {
  const outputDir = path.join(env.WORKER_TMP_DIR, songId, "sep");
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
  ]);
  const wallMs = Date.now() - started;

  const lastLine = result.stdout.trim().split(/\r?\n/).pop() ?? "";
  let parsed: { instrumentalPath?: string };
  try {
    parsed = JSON.parse(lastLine);
  } catch (err) {
    throw new Error(
      `separate.py did not emit JSON on last stdout line. last="${lastLine}" stderr=${result.stderr}`,
    );
  }
  if (!parsed.instrumentalPath) {
    throw new Error(`separate.py output missing instrumentalPath: ${lastLine}`);
  }

  return { instrumentalPath: parsed.instrumentalPath, wallMs };
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
