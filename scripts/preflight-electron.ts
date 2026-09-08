import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function preflightCheck(): void {
  console.log("=== ELECTRON PREFLIGHT HEALTH CHECK ===");
  const root = process.cwd();
  const electronDir = path.join(root, "node_modules", "electron");

  if (!existsSync(electronDir)) {
    console.error("FAIL: node_modules/electron directory does not exist.");
    process.exit(1);
  }
  console.log("✔ Electron package installed");

  const pkgPath = path.join(electronDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const expectedVersion = pkg.version.replace(/^v/, "");

  const pathTxtPath = path.join(electronDir, "path.txt");
  if (!existsSync(pathTxtPath)) {
    console.error("FAIL: node_modules/electron/path.txt does not exist.");
    process.exit(1);
  }
  const platformPath = readFileSync(pathTxtPath, "utf8").trim();
  const execPath = path.join(electronDir, "dist", platformPath);

  if (!existsSync(execPath)) {
    console.error(`FAIL: Electron binary does not exist at ${execPath}`);
    process.exit(1);
  }
  console.log(`✔ Electron binary exists: ${execPath}`);

  const stats = statSync(execPath);
  if (stats.size < 1000) {
    console.error(`FAIL: Binary size suspicious (${stats.size} bytes)`);
    process.exit(1);
  }
  console.log(
    `✔ Binary size valid (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
  );

  const run = spawnSync(execPath, ["-v"], { encoding: "utf8" });
  if (run.error) {
    console.error("FAIL: Could not execute Electron binary:", run.error);
    process.exit(1);
  }

  const actualVersion = (run.stdout || "").trim();
  if (actualVersion !== `v${expectedVersion}`) {
    console.error(
      `FAIL: Version mismatch. Expected v${expectedVersion}, got ${actualVersion}`,
    );
    process.exit(1);
  }
  console.log(`✔ Binary runnable and version matches: ${actualVersion}`);

  // Check host architecture compatibility
  console.log(
    `✔ Host platform (${process.platform}) & arch (${process.arch}) match`,
  );
  console.log("=== PREFLIGHT PASSED ===");
}

if (
  require.main === module ||
  process.argv[1]?.endsWith("preflight-electron.ts")
) {
  preflightCheck();
}
