const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const script = path.join(__dirname, "..", "build.sh");
const args = process.argv.slice(2);

if (process.platform === "win32") {
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const gitBash86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
  const bashBin = fs.existsSync(gitBash)
    ? gitBash
    : fs.existsSync(gitBash86)
      ? gitBash86
      : "bash";
  const res = spawnSync(bashBin, [script, ...args], { stdio: "inherit" });
  process.exit(res.status ?? 0);
} else {
  const res = spawnSync("bash", [script, ...args], { stdio: "inherit" });
  process.exit(res.status ?? 0);
}
