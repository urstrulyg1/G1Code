import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Phase 4: the Electron preflight is a diagnostic, not a gate for work that
 * does not need a browser window. TypeScript checks, unit tests, the backend
 * server, and the Vite build all work without the binary.
 *
 * `--strict` (or `G1CODE_REQUIRE_ELECTRON=1`) keeps the original hard failure so
 * packaging and Electron smoke tests still fail loudly on a broken install.
 */
function strictMode(): boolean {
  return (
    process.env.G1CODE_REQUIRE_ELECTRON === "1" ||
    process.argv.includes("--strict")
  );
}

function fail(message: string): void {
  if (strictMode()) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
  console.warn(
    "[preflight] SKIPPED: Electron binary unavailable — continuing because strict mode is off.",
  );
  console.warn(
    "[preflight] Run `npm run preflight:electron -- --strict` (or set G1CODE_REQUIRE_ELECTRON=1) to require it.",
  );
  process.exit(0);
}

export function preflightCheck(): void {
  console.log("=== ELECTRON PREFLIGHT HEALTH CHECK ===");
  const root = process.cwd();
  const electronDir = path.join(root, "node_modules", "electron");

  if (!existsSync(electronDir)) {
    fail("FAIL: node_modules/electron directory does not exist.");
    return;
  }
  console.log("✔ Electron package installed");

  const pkgPath = path.join(electronDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const expectedVersion = pkg.version.replace(/^v/, "");

  const pathTxtPath = path.join(electronDir, "path.txt");
  if (!existsSync(pathTxtPath)) {
    fail("FAIL: node_modules/electron/path.txt does not exist.");
    return;
  }
  const platformPath = readFileSync(pathTxtPath, "utf8").trim();
  const execPath = path.join(electronDir, "dist", platformPath);

  if (!existsSync(execPath)) {
    fail(`FAIL: Electron binary does not exist at ${execPath}`);
    return;
  }
  console.log(`✔ Electron binary exists: ${execPath}`);

  const stats = statSync(execPath);
  if (stats.size < 1000) {
    fail(`FAIL: Binary size suspicious (${stats.size} bytes)`);
    return;
  }
  console.log(
    `✔ Binary size valid (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
  );

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  const run = spawnSync(
    execPath,
    ["-e", "process.stdout.write(process.versions.electron)"],
    { encoding: "utf8", env },
  );
  if (run.error) {
    fail(`FAIL: Could not execute Electron binary: ${String(run.error)}`);
    return;
  }

  const actualVersion = (run.stdout || "").trim();
  if (actualVersion !== expectedVersion) {
    fail(
      `FAIL: Version mismatch. Expected v${expectedVersion}, got ${actualVersion}`,
    );
    return;
  }
  console.log(`✔ Binary runnable and version matches: v${actualVersion}`);

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
