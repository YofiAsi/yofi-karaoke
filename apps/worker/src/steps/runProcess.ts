/* Runs a child process with captured output and kills its whole process tree on timeout. */
import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs: number;
  label?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export function treeKillCommand(platform: NodeJS.Platform, pid: number): [string, string[]] | null {
  if (platform !== "win32") return null;
  return ["taskkill", ["/pid", String(pid), "/T", "/F"]];
}

export function killTree(child: ChildProcess): void {
  const command = child.pid ? treeKillCommand(process.platform, child.pid) : null;
  if (!command) {
    child.kill("SIGKILL");
    return;
  }
  spawn(command[0], command[1], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
}

export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<ProcessOutput> {
  const label = opts.label ?? cmd;
  return new Promise((resolve, reject) => {
    const stdin = opts.input === undefined ? "ignore" : "pipe";
    const child = spawn(cmd, args, { stdio: [stdin, "pipe", "pipe"], windowsHide: true, env: opts.env ?? process.env });
    child.stdin?.on("error", () => void 0);
    child.stdin?.end(opts.input, "utf8");
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));

    const killTimer = setTimeout(() => {
      killTree(child);
      reject(new Error(`${label} timed out after ${opts.timeoutMs}ms\nstderr: ${stderr}`));
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label} exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}
