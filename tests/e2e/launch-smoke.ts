import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const electronDirectory = path.join(
  process.cwd(),
  "node_modules",
  "electron",
  "dist",
);
const pathFile = path.join(
  process.cwd(),
  "node_modules",
  "electron",
  "path.txt",
);
const platformPath = existsSync(pathFile)
  ? readFileSync(pathFile, "utf8").trim()
  : "";
const electronBinary = path.join(electronDirectory, platformPath);

if (
  !platformPath ||
  !existsSync(electronBinary) ||
  statSync(electronBinary).size <= 1000
) {
  console.error(
    "BLOCKED: Electron platform binary is unavailable at node_modules/electron/dist.",
  );
  console.error(
    "Run npm install with Electron install scripts enabled, then retry.",
  );
  process.exitCode = 2;
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.platform === "linux" ? [".", "--smoke", "--no-sandbox"] : [".", "--smoke"];
  const child = spawn(electronBinary, args, {
    stdio: "inherit",
    env,
  });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, 10_000);
  child.on("exit", (code, signal) => {
    clearTimeout(deadline);
    if (!timedOut && signal === null && code === 0) process.exitCode = 0;
    else {
      console.error(
        `Electron smoke test failed: code=${code ?? "null"} signal=${signal ?? "none"} timedOut=${timedOut}`,
      );
      process.exitCode = code ?? 1;
    }
  });
}
