import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

export interface DownloadResult {
  filePath: string;
}

export async function downloadYouTubeAudio(
  youtubeVideoId: string,
  workDir: string,
): Promise<DownloadResult> {
  await mkdir(workDir, { recursive: true });

  const outputTemplate = path.join(workDir, "source.%(ext)s");
  const targetPath = path.join(workDir, "source.wav");
  const url = `https://youtu.be/${youtubeVideoId}`;

  await runProcess(
    "yt-dlp",
    [
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "wav",
      "--no-playlist",
      "--no-progress",
      "-o",
      outputTemplate,
      url,
    ],
    { timeoutMs: env.DOWNLOAD_TIMEOUT_MS },
  );

  return { filePath: targetPath };
}

interface RunOpts {
  timeoutMs: number;
}

function runProcess(cmd: string, args: string[], opts: RunOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${cmd} exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }
    });
  });
}
