import { existsSync, readdirSync, readFileSync, writeFileSync, chmodSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

function getPlatformPath(): string {
  const platform = process.platform;
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Unsupported platform for Electron: ${platform}`);
  }
}

function findCachedZip(version: string, platform: string, arch: string): string | null {
  const candidates: string[] = [];
  const home = os.homedir();

  if (platform === "darwin") {
    candidates.push(path.join(home, "Library", "Caches", "electron"));
  } else if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    candidates.push(path.join(localAppData, "electron", "Cache"));
  } else {
    candidates.push(path.join(home, ".cache", "electron"));
  }

  const expectedFileName = `electron-v${version}-${platform}-${arch}.zip`;

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      // Electron cache often puts zips in hash subdirectories
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name === expectedFileName) {
          return path.join(dir, entry.name);
        }
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          const subEntries = readdirSync(subDir);
          for (const sub of subEntries) {
            if (sub === expectedFileName) {
              return path.join(subDir, sub);
            }
          }
        }
      }
    } catch {
      // Continue searching
    }
  }

  return null;
}

export function ensureElectron(): void {
  const root = process.cwd();
  const electronDir = path.join(root, "node_modules", "electron");
  if (!existsSync(electronDir)) {
    console.error("ensure-electron: node_modules/electron is not installed.");
    process.exit(1);
  }

  const pkgPath = path.join(electronDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version = pkg.version.replace(/^v/, "");
  const platform = process.platform;
  const arch = process.arch;
  const platformPath = getPlatformPath();

  const distDir = path.join(electronDir, "dist");
  const execPath = path.join(distDir, platformPath);
  const pathTxtPath = path.join(electronDir, "path.txt");
  const versionPath = path.join(distDir, "version");

  // Check if binary is already installed and valid
  if (existsSync(execPath)) {
    try {
      const stats = statSync(execPath);
      if (stats.size > 1000) {
        // Ensure path.txt and version file exist
        if (!existsSync(pathTxtPath) || readFileSync(pathTxtPath, "utf8") !== platformPath) {
          writeFileSync(pathTxtPath, platformPath, "utf8");
        }
        if (!existsSync(versionPath) || readFileSync(versionPath, "utf8").trim() !== `v${version}`) {
          writeFileSync(versionPath, `v${version}`, "utf8");
        }
        console.log(`[ensure-electron] Valid Electron binary already present at ${execPath}`);
        return;
      }
    } catch {
      // Needs re-extraction
    }
  }

  console.log(`[ensure-electron] Resolving Electron ${version} for ${platform}-${arch}...`);

  const zipPath = findCachedZip(version, platform, arch);
  if (!zipPath) {
    console.error(`[ensure-electron] ERROR: Cached binary electron-v${version}-${platform}-${arch}.zip was not found.`);
    console.error("Please ensure the Electron download artifact is available in your system cache.");
    process.exit(1);
  }

  console.log(`[ensure-electron] Extracting ${zipPath} to ${distDir}...`);
  mkdirSync(distDir, { recursive: true });

  if (platform === "darwin" || platform === "linux") {
    // Native unzip reliably handles symlinks, permissions, and streams on modern Node.js versions
    try {
      execFileSync("/usr/bin/unzip", ["-q", "-o", zipPath, "-d", distDir], { stdio: "inherit" });
    } catch (err) {
      console.error("[ensure-electron] /usr/bin/unzip failed, falling back to unzip in PATH...", err);
      execFileSync("unzip", ["-q", "-o", zipPath, "-d", distDir], { stdio: "inherit" });
    }
  } else {
    // Windows PowerShell extraction
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${distDir}'`], { stdio: "inherit" });
  }

  // Ensure path.txt points to platform path
  writeFileSync(pathTxtPath, platformPath, "utf8");
  writeFileSync(versionPath, `v${version}`, "utf8");

  if (platform !== "win32") {
    try {
      chmodSync(execPath, 0o755);
    } catch (e) {
      console.warn("[ensure-electron] chmod warning:", e);
    }
  }

  // Verification test
  if (!existsSync(execPath)) {
    console.error(`[ensure-electron] Extraction failed: ${execPath} does not exist.`);
    process.exit(1);
  }

  const check = spawnSync(execPath, ["-v"], { encoding: "utf8" });
  const output = (check.stdout || "").trim();
  if (output !== `v${version}`) {
    console.error(`[ensure-electron] Verification failed. Expected v${version}, got: ${output}`);
    process.exit(1);
  }

  console.log(`[ensure-electron] Successfully verified Electron binary: ${output} at ${execPath}`);
}

if (require.main === module || process.argv[1]?.endsWith("ensure-electron.ts")) {
  ensureElectron();
}
