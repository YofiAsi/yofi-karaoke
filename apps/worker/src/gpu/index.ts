/* The worker's single GPU lane: every separation and transcription goes through one warm sidecar, one request at a time. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Job } from "graphile-worker";
import { env } from "../env.js";
import { treeKillCommand } from "../steps/runProcess.js";
import { GpuLane, type GpuPriority } from "./lane.js";
import { GpuSidecar } from "./sidecar.js";

export type { GpuPriority } from "./lane.js";

export interface GpuCall {
  timeoutMs: number;
  priority: GpuPriority;
}

export interface GpuOutcome<T> {
  result: T;
  queuedMs: number;
  runMs: number;
}

const SONG_TIER = 0;
const REFETCH_TIER = 1;
const PYTHON_UTF8_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

const OWN_PROCESS_GROUP = process.platform !== "win32";

function spawnSidecar(): ChildProcess {
  return spawn(env.PYTHON_BIN, [env.GPU_SIDECAR_PY_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: OWN_PROCESS_GROUP,
    env: PYTHON_UTF8_ENV,
  });
}

function killProcessGroup(pid: number): boolean {
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

export function killSidecarTree(child: ChildProcess): void {
  const command = child.pid ? treeKillCommand(process.platform, child.pid) : null;
  if (command) {
    spawnSync(command[0], command[1], { stdio: "ignore", windowsHide: true });
    return;
  }
  if (!(child.pid && OWN_PROCESS_GROUP && killProcessGroup(child.pid))) child.kill("SIGKILL");
}

const sidecar = new GpuSidecar({ spawn: spawnSidecar, kill: killSidecarTree });
const lane = new GpuLane();
let prewarmQueued = false;

function jobOrder(job: Pick<Job, "id">): number {
  const order = Number(job.id);
  return Number.isFinite(order) ? order : Date.now();
}

export function songPriority(job: Pick<Job, "id">): GpuPriority {
  return { tier: SONG_TIER, order: jobOrder(job) };
}

export function refetchPriority(job: Pick<Job, "id">): GpuPriority {
  return { tier: REFETCH_TIER, order: jobOrder(job) };
}

export async function runOnGpu<T>(op: string, params: object, call: GpuCall): Promise<GpuOutcome<T>> {
  const queuedAt = Date.now();
  let startedAt = queuedAt;
  const result = await lane.run(call.priority, () => {
    startedAt = Date.now();
    return sidecar.request<T>(op, params, call.timeoutMs);
  });
  return { result, queuedMs: startedAt - queuedAt, runMs: Date.now() - startedAt };
}

export function prewarmGpu(op: string, params: object, call: GpuCall): void {
  if (sidecar.running || prewarmQueued) return;
  prewarmQueued = true;
  runOnGpu(op, params, call)
    .catch((err) => console.error(JSON.stringify({ msg: "gpu prewarm failed", op, error: String(err).slice(0, 500) })))
    .finally(() => (prewarmQueued = false));
}

export function stopGpu(): Promise<void> {
  return sidecar.stop();
}

export function killGpuNow(): void {
  sidecar.killNow();
}
