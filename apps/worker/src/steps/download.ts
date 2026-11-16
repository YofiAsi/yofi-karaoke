import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";
import { runProcess } from "./runProcess.js";

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

  await runProcess(env.YTDLP_BIN, ytdlpArgs(url, outputTemplate, env.YTDLP_JS_RUNTIMES), {
    timeoutMs: env.DOWNLOAD_TIMEOUT_MS,
    label: "yt-dlp",
  });

  return { filePath: targetPath };
}

export function ytdlpArgs(url: string, outputTemplate: string, jsRuntimes?: string): string[] {
  const runtimeArgs = jsRuntimes ? ["--js-runtimes", jsRuntimes] : [];
  return [
    ...runtimeArgs,
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
  ];
}
