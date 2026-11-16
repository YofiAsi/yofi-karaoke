import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { GpuSidecar } from "./sidecar.js";

interface Request {
  id: number;
  op: string;
  params: Record<string, unknown>;
}

class FakeSidecar extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  requests: Request[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    let buffered = "";
    this.stdin.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) this.requests.push(JSON.parse(line) as Request);
    });
    this.stdin.on("end", () => this.exit(0));
  }

  reply(body: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(body)}\n`);
  }

  exit(code: number | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code ?? 1;
    this.emit("exit", code, null);
  }
}

function setup(options: { exitGraceMs?: number } = {}) {
  const spawned: FakeSidecar[] = [];
  const sidecar = new GpuSidecar({
    spawn: () => {
      const child = new FakeSidecar();
      spawned.push(child);
      return child as unknown as ChildProcess;
    },
    kill: (child) => {
      const fake = child as unknown as FakeSidecar;
      fake.killed = true;
      fake.exit(null);
    },
    exitGraceMs: options.exitGraceMs ?? 200,
  });
  return { sidecar, spawned };
}

async function nextRequest(child: FakeSidecar, count = 1): Promise<Request> {
  await vi.waitFor(() => expect(child.requests).toHaveLength(count));
  return child.requests[count - 1];
}

describe("GpuSidecar", () => {
  it("spawns lazily, writes one JSON line per request and reuses the process", async () => {
    const { sidecar, spawned } = setup();
    expect(spawned).toHaveLength(0);
    expect(sidecar.running).toBe(false);

    const first = sidecar.request("separate", { input: "/w/source.wav" }, 1_000);
    const child = spawned[0];
    const request = await nextRequest(child);
    expect(request).toEqual({ id: 1, op: "separate", params: { input: "/w/source.wav" } });
    child.reply({ id: 1, ok: true, result: { instrumentalPath: "/w/i.mp3" } });
    await expect(first).resolves.toEqual({ instrumentalPath: "/w/i.mp3" });

    const second = sidecar.request("transcribe", { input: "/w/v.mp3" }, 1_000);
    child.reply({ id: (await nextRequest(child, 2)).id, ok: true, result: { words: [] } });
    await expect(second).resolves.toEqual({ words: [] });
    expect(spawned).toHaveLength(1);
  });

  it("ignores noise and reassembles responses split across chunks", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("separate", {}, 1_000);
    const child = spawned[0];
    await nextRequest(child);
    child.stdout.write("Skip loading CUDA and cuDNN DLLs since torch is imported.\n");
    child.stdout.write('{"id": 99, "ok": true, "result": "stale"}\n{"id": 1, "ok": tr');
    child.stdout.write('ue, "result": "fresh"}\n');
    await expect(pending).resolves.toBe("fresh");
  });

  it("rejects a failed request but keeps a healthy process", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("separate", {}, 1_000);
    await nextRequest(spawned[0]);
    spawned[0].reply({ id: 1, ok: false, error: "SeparationError: input file does not exist", fatal: false });
    await expect(pending).rejects.toThrow("separate failed in gpu sidecar: SeparationError: input file does not exist");
    expect(spawned[0].killed).toBe(false);
    expect(sidecar.running).toBe(true);
  });

  it("replaces the process after a fatal error", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("separate", {}, 1_000);
    await nextRequest(spawned[0]);
    spawned[0].reply({ id: 1, ok: false, error: "RuntimeError: CUDA error", fatal: true });
    await expect(pending).rejects.toThrow(/CUDA error/);
    expect(spawned[0].exitCode).not.toBeNull();

    const next = sidecar.request("separate", {}, 1_000);
    expect(spawned).toHaveLength(2);
    spawned[1].reply({ id: (await nextRequest(spawned[1])).id, ok: true, result: "ok" });
    await expect(next).resolves.toBe("ok");
  });

  it("reports a crash during a request with the stderr tail and restarts on the next request", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("transcribe", {}, 1_000);
    await nextRequest(spawned[0]);
    spawned[0].stderr.write("Traceback: access violation\n");
    await new Promise((r) => setTimeout(r, 10));
    spawned[0].exit(3221225477);
    await expect(pending).rejects.toThrow(/gpu sidecar exited with 3221225477 during transcribe[\s\S]*access violation/);
    expect(sidecar.running).toBe(false);

    const next = sidecar.request("transcribe", {}, 1_000);
    spawned[1].reply({ id: (await nextRequest(spawned[1])).id, ok: true, result: "ok" });
    await expect(next).resolves.toBe("ok");
  });

  it("kills a stuck process on timeout, waits for it to exit and starts fresh", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("separate", {}, 30);
    await expect(pending).rejects.toThrow("separate timed out after 30ms in gpu sidecar");
    expect(spawned[0].killed).toBe(true);
    expect(spawned[0].exitCode).not.toBeNull();

    spawned[0].reply({ id: 1, ok: true, result: "late" });
    const next = sidecar.request("separate", {}, 1_000);
    expect(spawned).toHaveLength(2);
    spawned[1].reply({ id: (await nextRequest(spawned[1])).id, ok: true, result: "fresh" });
    await expect(next).resolves.toBe("fresh");
  });

  it("refuses a second request while one is in flight", async () => {
    const { sidecar, spawned } = setup();
    const first = sidecar.request("separate", {}, 1_000);
    await expect(sidecar.request("transcribe", {}, 1_000)).rejects.toThrow(/busy with separate/);
    spawned[0].reply({ id: (await nextRequest(spawned[0])).id, ok: true, result: 1 });
    await expect(first).resolves.toBe(1);
  });

  it("rejects when the process cannot be spawned", async () => {
    const { sidecar, spawned } = setup();
    const pending = sidecar.request("separate", {}, 1_000);
    spawned[0].emit("error", new Error("spawn python3 ENOENT"));
    await expect(pending).rejects.toThrow("gpu sidecar failed: spawn python3 ENOENT during separate");
    expect(sidecar.running).toBe(false);
  });

  it("stops by closing stdin and kills a process that does not exit in time", async () => {
    const polite = setup();
    const done = polite.sidecar.request("ping", {}, 1_000);
    polite.spawned[0].reply({ id: (await nextRequest(polite.spawned[0])).id, ok: true, result: {} });
    await done;
    await polite.sidecar.stop();
    expect(polite.spawned[0].exitCode).toBe(0);
    expect(polite.spawned[0].killed).toBe(false);

    const stubborn = setup({ exitGraceMs: 20 });
    const ping = stubborn.sidecar.request("ping", {}, 1_000);
    const child = stubborn.spawned[0];
    child.reply({ id: (await nextRequest(child)).id, ok: true, result: {} });
    await ping;
    child.stdin.removeAllListeners("end");
    await stubborn.sidecar.stop();
    expect(child.killed).toBe(true);
    expect(stubborn.sidecar.running).toBe(false);
  });
});
