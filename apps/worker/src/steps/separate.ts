// Splits the downloaded audio into instrumental and vocals stems on the GPU lane.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../env.js";
import { prewarmGpu, runOnGpu, type GpuPriority } from "../gpu/index.js";

export interface SeparatedStems {
  instrumentalPath: string;
  vocalsPath: string | null;
}

export interface SeparationTimings {
  queuedMs: number;
  wallMs: number;
  loadMs: number;
  inferenceMs: number;
  encodeMs: number;
}

export type SeparateResult = SeparatedStems & SeparationTimings;

function separationModel() {
  return {
    model: env.AUDIO_SEP_MODEL,
    backend: env.SEPARATOR_BACKEND,
    modelDir: env.AUDIO_SEP_MODEL_DIR,
    bitrate: env.STEM_BITRATE,
  };
}

export function prewarmSeparation(priority: GpuPriority): void {
  prewarmGpu("prepare_separate", separationModel(), { timeoutMs: env.SEPARATE_TIMEOUT_MS, priority });
}

export async function separateVocals(workDir: string, inputAudio: string, priority: GpuPriority): Promise<SeparateResult> {
  const outputDir = path.join(workDir, "sep");
  await mkdir(outputDir, { recursive: true });
  const { result, queuedMs, runMs } = await runOnGpu<unknown>(
    "separate",
    { input: inputAudio, outputDir, ...separationModel() },
    { timeoutMs: env.SEPARATE_TIMEOUT_MS, priority },
  );
  return { ...toSeparatedStems(result), ...stepTimings(result), queuedMs, wallMs: runMs };
}

function msField(value: unknown, name: string): number {
  const field = (value as Record<string, unknown> | null)?.[name];
  return typeof field === "number" ? field : 0;
}

function stepTimings(value: unknown): Pick<SeparationTimings, "loadMs" | "inferenceMs" | "encodeMs"> {
  return { loadMs: msField(value, "loadMs"), inferenceMs: msField(value, "inferenceMs"), encodeMs: msField(value, "encodeMs") };
}

export function toSeparatedStems(value: unknown): SeparatedStems {
  const parsed = (value ?? {}) as { instrumentalPath?: unknown; vocalsPath?: unknown };
  if (typeof parsed.instrumentalPath !== "string" || !parsed.instrumentalPath) {
    throw new Error(`separation result missing instrumentalPath: ${JSON.stringify(value)}`);
  }
  const vocalsPath = typeof parsed.vocalsPath === "string" && parsed.vocalsPath ? parsed.vocalsPath : null;
  return { instrumentalPath: parsed.instrumentalPath, vocalsPath };
}
