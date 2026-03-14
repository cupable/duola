import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { runtimeDir, ensureAppDirs } from "../config/paths.js";

function pidPath(alias: string): string {
  return path.join(runtimeDir, `${alias}.pid`);
}

function outPath(alias: string): string {
  return path.join(runtimeDir, `${alias}.log`);
}

export function startDetachedProcess(alias: string, confirmation: string, maxCycles?: number): Record<string, unknown> {
  ensureAppDirs();
  const currentPid = readPid(alias);
  if (currentPid) {
    if (isProcessRunning(currentPid)) {
      throw new Error(`Background runner already active for ${alias} (pid ${currentPid})`);
    }
    clearBackgroundState(alias);
  }

  const node = process.execPath;
  const entrypoint = process.argv[1];
  const args = [
    entrypoint,
    "follow",
    "start",
    alias,
    "--confirm-live",
    confirmation
  ];

  if (maxCycles && maxCycles > 0) {
    args.push("--max-cycles", String(maxCycles));
  }

  const logFd = fs.openSync(outPath(alias), "a");
  const child = spawn(node, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env
  });

  child.unref();
  fs.writeFileSync(pidPath(alias), `${child.pid}\n`, "utf8");

  return {
    alias,
    detached: true,
    pid: child.pid,
    logPath: outPath(alias)
  };
}

export function getBackgroundState(alias: string): { pid: number | null; running: boolean; logPath: string } {
  const pid = readPid(alias);
  const running = pid ? isProcessRunning(pid) : false;

  if (pid && !running) {
    clearBackgroundState(alias);
  }

  return {
    pid: running ? pid : null,
    running,
    logPath: outPath(alias)
  };
}

export function clearBackgroundState(alias: string): void {
  const file = pidPath(alias);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function stopDetachedProcess(alias: string): { pid: number | null; stopped: boolean } {
  const pid = readPid(alias);
  if (!pid) {
    return { pid: null, stopped: false };
  }

  let stopped = false;
  try {
    process.kill(pid, "SIGTERM");
    stopped = true;
  } catch {
    stopped = false;
  }

  clearBackgroundState(alias);
  return { pid, stopped };
}

function readPid(alias: string): number | null {
  const file = pidPath(alias);
  if (!fs.existsSync(file)) {
    return null;
  }

  const raw = fs.readFileSync(file, "utf8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
