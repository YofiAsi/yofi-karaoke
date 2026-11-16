import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess, treeKillCommand } from "./runProcess.js";

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isAlive(pid);
}

const PARENT_SCRIPT = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(process.argv[1], String(child.pid));
setInterval(() => {}, 1000);
`;

describe("treeKillCommand", () => {
  it("uses taskkill for the whole tree on Windows", () => {
    expect(treeKillCommand("win32", 42)).toEqual(["taskkill", ["/pid", "42", "/T", "/F"]]);
  });

  it("falls back to a plain signal elsewhere", () => {
    expect(treeKillCommand("linux", 42)).toBeNull();
  });
});

describe("runProcess", () => {
  it("resolves with the captured output", async () => {
    const out = await runProcess(process.execPath, ["-e", "console.log('hi'); console.error('warn')"], { timeoutMs: 10_000 });
    expect(out.stdout.trim()).toBe("hi");
    expect(out.stderr.trim()).toBe("warn");
  });

  it("writes the given input to stdin as UTF-8", async () => {
    const echo = "let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => process.stdout.write(JSON.stringify(s)));";
    const out = await runProcess(process.execPath, ["-e", echo], { timeoutMs: 10_000, input: "ゆめ line" });
    expect(JSON.parse(out.stdout)).toBe("ゆめ line");
  });

  it("rejects with the exit code and stderr", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "console.error('boom'); process.exit(3)"], { timeoutMs: 10_000, label: "probe" }),
    ).rejects.toThrow(/probe exited with code 3[\s\S]*boom/);
  });

  it("kills the child and its own children on timeout", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "run-process-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const run = runProcess(process.execPath, ["-e", PARENT_SCRIPT, pidFile], { timeoutMs: 1_500, label: "sleeper" });
    await expect(run).rejects.toThrow(/sleeper timed out after 1500ms/);
    const grandchild = Number(await readFile(pidFile, "utf8"));
    expect(await waitUntilDead(grandchild, 5_000)).toBe(true);
  }, 15_000);
});
