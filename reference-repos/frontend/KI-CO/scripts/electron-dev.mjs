import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverUrl = process.env.ELECTRON_START_URL || "http://127.0.0.1:5177";
const viteBin = path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const electronBin = path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

function spawnChild(command, args, extraEnv = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    windowsHide: true,
  });
}

async function isReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(url, startedProcess) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (startedProcess?.exitCode !== null) {
      throw new Error("Vite dev server exited before Electron could start.");
    }
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let viteProcess = null;

if (!(await isReachable(serverUrl))) {
  viteProcess = spawnChild(viteBin, ["--host", "127.0.0.1", "--port", "5177", "--strictPort"]);
  await waitForServer(serverUrl, viteProcess);
}

const electronProcess = spawnChild(electronBin, ["."], {
  ELECTRON_START_URL: serverUrl,
});

const stop = (code = 0) => {
  if (viteProcess && viteProcess.exitCode === null) {
    viteProcess.kill();
  }
  process.exit(code ?? 0);
};

electronProcess.on("exit", (code) => stop(code));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
