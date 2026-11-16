/* Client for python/gpu_sidecar.py: starts it on demand, sends one JSON lines request at a time and replaces it after a crash or timeout. */
import type { ChildProcess } from "node:child_process";
import { killTree } from "../steps/runProcess.js";

export interface SidecarOptions {
  spawn: () => ChildProcess;
  kill?: (child: ChildProcess) => void;
  exitGraceMs?: number;
  stderrTailChars?: number;
}

interface SidecarResponse {
  id: number | null;
  ok: boolean;
  result?: unknown;
  error?: string;
  fatal?: boolean;
}

interface InFlight {
  id: number;
  op: string;
  child: ChildProcess;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_EXIT_GRACE_MS = 5_000;
const DEFAULT_STDERR_TAIL_CHARS = 2_000;

function isResponse(value: unknown): value is SidecarResponse {
  return typeof value === "object" && value !== null && "id" in value && typeof (value as SidecarResponse).ok === "boolean";
}

function parseLine(line: string): SidecarResponse | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export class GpuSidecar {
  private child: ChildProcess | null = null;
  private exits = new Map<ChildProcess, Promise<void>>();
  private inFlight: InFlight | null = null;
  private closed = false;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrTail = "";
  private readonly kill: (child: ChildProcess) => void;
  private readonly exitGraceMs: number;
  private readonly stderrTailChars: number;

  constructor(private readonly options: SidecarOptions) {
    this.kill = options.kill ?? killTree;
    this.exitGraceMs = options.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS;
    this.stderrTailChars = options.stderrTailChars ?? DEFAULT_STDERR_TAIL_CHARS;
  }

  get running(): boolean {
    return this.child !== null;
  }

  request<T>(op: string, params: object, timeoutMs: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`gpu sidecar is shut down; ${op} not started`));
    if (this.inFlight) return Promise.reject(new Error(`gpu sidecar is busy with ${this.inFlight.op}; requests must go through the GPU lane`));
    const child = this.ensureChild();
    const id = this.nextId++;
    this.stderrTail = "";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => void this.timeOut(id, timeoutMs), timeoutMs);
      this.inFlight = { id, op, child, resolve: resolve as (value: unknown) => void, reject, timer };
      child.stdin?.write(`${JSON.stringify({ id, op, params })}\n`);
    });
  }

  async stop(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.stdin?.end();
    if (!(await this.waitForExit(child, this.exitGraceMs))) await this.discard(child);
  }

  killNow(): void {
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (child && !hasExited(child)) this.kill(child);
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child;
    const child = this.options.spawn();
    this.child = child;
    this.stdoutBuffer = "";
    this.exits.set(child, new Promise((resolve) => child.once("exit", () => {
      this.exits.delete(child);
      resolve();
    })));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onStdout(child, chunk));
    child.stderr?.on("data", (chunk: string) => this.onStderr(child, chunk));
    child.stdin?.on("error", () => void 0);
    child.on("exit", (code, signal) => this.onExit(child, `exited with ${code ?? signal}`));
    child.on("error", (err) => this.onSpawnError(child, err));
    return child;
  }

  private isTracked(child: ChildProcess): boolean {
    return child === this.child || child === this.inFlight?.child;
  }

  private onStdout(child: ChildProcess, chunk: string): void {
    if (!this.isTracked(child)) return;
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) this.onLine(child, line.trim());
  }

  private onStderr(child: ChildProcess, chunk: string): void {
    if (!this.isTracked(child)) return;
    this.stderrTail = (this.stderrTail + chunk).slice(-this.stderrTailChars);
  }

  private onLine(child: ChildProcess, line: string): void {
    if (!line) return;
    const response = parseLine(line);
    if (!response || response.id !== this.inFlight?.id) {
      this.onStderr(child, `[stdout] ${line}\n`);
      return;
    }
    void this.settle(response);
  }

  private async settle(response: SidecarResponse): Promise<void> {
    const call = this.takeInFlight();
    if (!call) return;
    if (response.ok) {
      call.resolve(response.result);
      return;
    }
    if (response.fatal) await this.discard(call.child);
    call.reject(new Error(`${call.op} failed in gpu sidecar: ${response.error ?? "unknown error"}`));
  }

  private async timeOut(id: number, timeoutMs: number): Promise<void> {
    if (this.inFlight?.id !== id) return;
    const call = this.takeInFlight();
    if (!call) return;
    const stderr = this.stderrTail;
    await this.discard(call.child);
    call.reject(new Error(`${call.op} timed out after ${timeoutMs}ms in gpu sidecar\nstderr: ${stderr}`));
  }

  private onExit(child: ChildProcess, how: string): void {
    if (child === this.child) this.child = null;
    if (this.inFlight?.child !== child) return;
    const fallback = setTimeout(() => this.failInFlight(child, how), this.exitGraceMs);
    child.once("close", () => {
      clearTimeout(fallback);
      this.failInFlight(child, how);
    });
  }

  private onSpawnError(child: ChildProcess, err: Error): void {
    if (child === this.child) this.child = null;
    this.failInFlight(child, `failed: ${err.message}`);
  }

  private failInFlight(child: ChildProcess, how: string): void {
    if (this.inFlight?.child !== child) return;
    const stderr = this.stderrTail;
    const call = this.takeInFlight();
    call?.reject(new Error(`gpu sidecar ${how} during ${call.op}\nstderr: ${stderr}`));
  }

  private takeInFlight(): InFlight | null {
    const call = this.inFlight;
    if (call) clearTimeout(call.timer);
    this.inFlight = null;
    return call;
  }

  private async discard(child: ChildProcess): Promise<void> {
    if (child === this.child) this.child = null;
    if (hasExited(child)) return;
    this.kill(child);
    await this.waitForExit(child, this.exitGraceMs);
  }

  private async waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (hasExited(child)) return true;
    const exit = this.exits.get(child) ?? Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
    const exited = await Promise.race([exit.then(() => true as const), timedOut]);
    clearTimeout(timer);
    return exited;
  }
}
