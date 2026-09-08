import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const electronDirectory = path.join(process.cwd(), "node_modules", "electron", "dist");
const hasElectronBinary = existsSync(electronDirectory) && readdirSync(electronDirectory).some((entry) => entry === "Electron.app" || entry === "electron" || entry === "electron.exe");
if (!hasElectronBinary) {
  console.error("BLOCKED: Electron platform binary is unavailable at node_modules/electron/dist.");
  console.error("Run npm install with Electron install scripts enabled, then retry.");
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, ["node_modules/electron/cli.js", ".", "--smoke"], { stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (signal === "SIGTERM" || code === 0) process.exitCode = 0;
    else process.exitCode = code ?? 1;
  });
}
