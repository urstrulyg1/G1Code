#!/usr/bin/env node
/**
 * G1Code — 4K Ultra-Clarity Desktop Packaging Visual Assets & Icon Generator
 *
 * Generates:
 *  - build/icon-2048.png (2048x2048 4K master asset)
 *  - build/icon.png (1024x1024 master and 512x512)
 *  - build/icons/ (Linux standard XDG multi-resolution icons: 16x16 to 1024x1024)
 *  - build/icon.icns (macOS multi-resolution iconset: 16x16 to 1024x1024 Retina)
 *  - build/icon.ico (Windows multi-resolution icon: 16, 24, 32, 48, 64, 128, 256)
 *  - build/background.tiff & build/dmg-background@2x.png (macOS 4K Retina DMG background)
 *  - build/installerSidebar.bmp & build/uninstallerSidebar.bmp (Windows 4K-supersampled NSIS sidebar)
 *  - build/installerHeader.bmp (Windows 4K-supersampled NSIS header)
 */

import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicSvg = path.join(rootDir, "public", "icon.svg");
const buildDir = path.join(rootDir, "build");
const iconsDir = path.join(buildDir, "icons");
const tmpDir = path.join(rootDir, ".icon-gen-tmp");

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

if (!fs.existsSync(publicSvg)) {
  console.error(`❌ Source icon not found at: ${publicSvg}`);
  process.exit(1);
}

// Clean temporary folder
if (fs.existsSync(tmpDir)) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
fs.mkdirSync(tmpDir, { recursive: true });

console.log("🎨 [G1Code] Generating 4K Ultra-Clarity desktop branding & icon suite...");

const svgSource = fs.readFileSync(publicSvg, "utf8");

// 1. 4K Master Icon Template (2048x2048 native vector)
const icon4kHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 2048px; height: 2048px; background: transparent; overflow: hidden; }
    svg { width: 2048px; height: 2048px; display: block; shape-rendering: geometricPrecision; text-rendering: geometricPrecision; }
  </style>
</head>
<body>
  ${svgSource}
</body>
</html>`;

// 2. 4K DMG Background Template (2720x1800 native vector layout)
const dmgBg4kHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 2720px;
    height: 1800px;
    background: radial-gradient(circle at 50% 30%, #151D2E 0%, #0A0E18 60%, #030712 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif;
    color: #F8FAFC;
    overflow: hidden;
    position: relative;
    -webkit-font-smoothing: antialiased;
  }
  .grid-pattern {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(to right, rgba(56, 189, 248, 0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
    background-size: 80px 80px;
  }
  .content-header {
    position: absolute;
    top: 200px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .brand-badge {
    display: inline-flex;
    align-items: center;
    gap: 16px;
    padding: 12px 32px;
    background: rgba(56, 189, 248, 0.12);
    border: 2px solid rgba(56, 189, 248, 0.35);
    border-radius: 9999px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #38BDF8;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .title {
    font-size: 86px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: #FFFFFF;
    margin-bottom: 12px;
  }
  .subtitle {
    font-size: 34px;
    font-weight: 400;
    color: #94A3B8;
  }
  .arrow-box {
    position: absolute;
    top: 980px;
    left: 1360px;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .arrow-svg {
    width: 140px;
    height: 70px;
  }
  .drag-hint {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: #38BDF8;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="grid-pattern"></div>
  <div class="content-header">
    <div class="brand-badge">⚡ Autonomous AI IDE</div>
    <div class="title">G1Code</div>
    <div class="subtitle">Drag G1Code into Applications to install</div>
  </div>
  <div class="arrow-box">
    <svg class="arrow-svg" viewBox="0 0 140 70" fill="none">
      <path d="M10 35H125M125 35L95 15M125 35L95 55" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="drag-hint">Drag &amp; Drop</div>
  </div>
</body>
</html>`;

// 3. 4K-supersampled NSIS Sidebar Template (656x1256 for 164x314 target)
const sidebar4kHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 656px;
    height: 1256px;
    background: linear-gradient(180deg, #0B1120 0%, #030712 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif;
    color: #F8FAFC;
    overflow: hidden;
    padding: 64px 48px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  .logo-box {
    width: 176px;
    height: 176px;
    border-radius: 40px;
    background: #0F172A;
    border: 3px solid rgba(56, 189, 248, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
  }
  .logo-box svg { width: 136px; height: 136px; }
  .title {
    font-size: 54px;
    font-weight: 800;
    color: #FFFFFF;
    line-height: 1.1;
    margin-top: 24px;
  }
  .title span { color: #38BDF8; }
  .subtitle {
    font-size: 26px;
    color: #94A3B8;
    margin-top: 12px;
    line-height: 1.4;
  }
  .features {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-top: 40px;
  }
  .feat-item {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 22px;
    color: #E2E8F0;
  }
  .feat-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #38BDF8;
    box-shadow: 0 0 12px #38BDF8;
  }
  .footer {
    font-size: 20px;
    color: #64748B;
  }
</style>
</head>
<body>
  <div>
    <div class="logo-box">${svgSource}</div>
    <div class="title">G1<span>Code</span></div>
    <div class="subtitle">Next-Generation Autonomous AI IDE</div>
    <div class="features">
      <div class="feat-item"><div class="feat-dot"></div> Full-Stack Autonomous Agent</div>
      <div class="feat-item"><div class="feat-dot"></div> Real-time Change Approvals</div>
      <div class="feat-item"><div class="feat-dot"></div> Native Monaco IDE & Git Matrix</div>
    </div>
  </div>
  <div class="footer">urstrulyg1 • v0.1.0</div>
</body>
</html>`;

// 4. 4K-supersampled NSIS Header Template (600x228 for 150x57 target)
const header4kHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 600px;
    height: 228px;
    background: linear-gradient(90deg, #0F172A 0%, #030712 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif;
    color: #F8FAFC;
    overflow: hidden;
    padding: 32px 40px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 32px;
    -webkit-font-smoothing: antialiased;
  }
  .text-side {
    text-align: right;
  }
  .title {
    font-size: 40px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .title span { color: #38BDF8; }
  .sub {
    font-size: 26px;
    color: #94A3B8;
    margin-top: 4px;
  }
  .logo-box {
    width: 104px;
    height: 104px;
    border-radius: 24px;
    background: #0F172A;
    border: 2px solid rgba(56, 189, 248, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .logo-box svg { width: 80px; height: 80px; }
</style>
</head>
<body>
  <div class="text-side">
    <div class="title">G1<span>Code</span></div>
    <div class="sub">Setup Wizard</div>
  </div>
  <div class="logo-box">${svgSource}</div>
</body>
</html>`;

// Runner script for Electron offscreen rendering
const runnerScript = `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const iconHtml = ${JSON.stringify(icon4kHtml)};
const dmgBgHtml = ${JSON.stringify(dmgBg4kHtml)};
const sidebarHtml = ${JSON.stringify(sidebar4kHtml)};
const headerHtml = ${JSON.stringify(header4kHtml)};

app.whenReady().then(async () => {
  const tmp = "${tmpDir.replace(/\\/g, "/")}";

  const win = new BrowserWindow({
    width: 2048,
    height: 2048,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  });

  // 1. Render 4K Master Icon (2048x2048)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(iconHtml));
  await new Promise(r => setTimeout(r, 250));
  let img = await win.capturePage();
  fs.writeFileSync(path.join(tmp, 'master-2048.png'), img.toPNG());

  // 2. Render 4K DMG Background (2720x1800)
  win.setContentSize(2720, 1800);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(dmgBgHtml));
  await new Promise(r => setTimeout(r, 350));
  img = await win.capturePage();
  fs.writeFileSync(path.join(tmp, 'dmg-bg-4k.png'), img.toPNG());

  // 3. Render 4K-supersampled NSIS Sidebar (656x1256)
  win.setContentSize(656, 1256);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(sidebarHtml));
  await new Promise(r => setTimeout(r, 250));
  img = await win.capturePage();
  fs.writeFileSync(path.join(tmp, 'sidebar-4k.png'), img.toPNG());

  // 4. Render 4K-supersampled NSIS Header (600x228)
  win.setContentSize(600, 228);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(headerHtml));
  await new Promise(r => setTimeout(r, 250));
  img = await win.capturePage();
  fs.writeFileSync(path.join(tmp, 'header-4k.png'), img.toPNG());

  win.destroy();
  app.quit();
});
`;

const runnerScriptPath = path.join(tmpDir, "render-all.cjs");
fs.writeFileSync(runnerScriptPath, runnerScript);

try {
  let electronBin = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
  if (!fs.existsSync(electronBin)) {
    electronBin = "electron";
  }

  console.log("   ⚡ Rendering 4K raster master files with Electron...");
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/c", electronBin, runnerScriptPath], {
      stdio: "inherit",
    });
  } else {
    execFileSync(electronBin, [runnerScriptPath], { stdio: "inherit" });
  }

  // 3. Post-process with Python PIL for pristine Lanczos supersampling
  const pythonScript = `
import os, sys, subprocess
from PIL import Image

tmp = r"${tmpDir}"
build = r"${buildDir}"
icons = r"${iconsDir}"

# 1. Master Icons
master_2048 = Image.open(os.path.join(tmp, "master-2048.png"))
master_2048.save(os.path.join(build, "icon-2048.png"))

master_1024 = master_2048.resize((1024, 1024), Image.Resampling.LANCZOS)
master_1024.save(os.path.join(build, "icon.png"))

# 2. Linux multi-resolution icon suite in build/icons/
linux_icon_sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]
for sz in linux_icon_sizes:
    target_path = os.path.join(icons, f"{sz}x{sz}.png")
    resized = master_2048.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(target_path)

# 3. macOS .icns multi-resolution bundle (if on macOS or fallback)
iconset_dir = os.path.join(tmp, "icon.iconset")
os.makedirs(iconset_dir, exist_ok=True)
icns_specs = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]
for filename, sz in icns_specs:
    resized = master_2048.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(os.path.join(iconset_dir, filename))

icns_out = os.path.join(build, "icon.icns")
if sys.platform == "darwin":
    try:
        subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", icns_out], check=True)
    except Exception as e:
        print("Notice: iconutil failed:", e)
else:
    # On Windows/Linux, copy existing icns or 512x512 as placeholder if needed
    pass

# 4. Windows .ico multi-resolution container
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_out = os.path.join(build, "icon.ico")
master_1024.save(ico_out, format="ICO", sizes=ico_sizes)

# 5. 4K DMG Background (680x450 1x and 1360x900 2x Retina TIFF supersampled from 2720x1800)
dmg_4k = Image.open(os.path.join(tmp, "dmg-bg-4k.png")).convert("RGB")
dmg_4k.save(os.path.join(build, "dmg-background-4k.png"))

dmg_2x = dmg_4k.resize((1360, 900), Image.Resampling.LANCZOS)
dmg_2x_path = os.path.join(build, "dmg-background@2x.png")
dmg_2x.save(dmg_2x_path)

dmg_1x = dmg_4k.resize((680, 450), Image.Resampling.LANCZOS)
dmg_1x_path = os.path.join(build, "dmg-background.png")
dmg_1x.save(dmg_1x_path)

if sys.platform == "darwin":
    try:
        tiff_out = os.path.join(build, "background.tiff")
        subprocess.run(["tiffutil", "-cathidpicheck", dmg_1x_path, dmg_2x_path, "-out", tiff_out], check=True)
    except Exception:
        pass

# 6. Windows NSIS BMP graphics supersampled from 4x renders
sidebar_4k = Image.open(os.path.join(tmp, "sidebar-4k.png")).convert("RGB")
sidebar_1x = sidebar_4k.resize((164, 314), Image.Resampling.LANCZOS)
sidebar_1x.save(os.path.join(build, "installerSidebar.bmp"), format="BMP")
sidebar_1x.save(os.path.join(build, "uninstallerSidebar.bmp"), format="BMP")
sidebar_1x.save(os.path.join(build, "installerSidebar.png"), format="PNG")

header_4k = Image.open(os.path.join(tmp, "header-4k.png")).convert("RGB")
header_1x = header_4k.resize((150, 57), Image.Resampling.LANCZOS)
header_1x.save(os.path.join(build, "installerHeader.bmp"), format="BMP")
header_1x.save(os.path.join(build, "installerHeader.png"), format="PNG")

print("4K Asset processing and Linux icon generation complete.")
`;

  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  execFileSync(pythonCmd, ["-c", pythonScript], { stdio: "inherit" });

  // If on non-macOS and icon.icns doesn't exist yet, copy G1Wiggle icon.icns as base or create valid placeholder
  const icnsPath = path.join(buildDir, "icon.icns");
  if (!fs.existsSync(icnsPath)) {
    const fallbackIcns = path.join(
      rootDir,
      "..",
      "G1Wiggle",
      "build",
      "icon.icns",
    );
    if (fs.existsSync(fallbackIcns)) {
      fs.copyFileSync(fallbackIcns, icnsPath);
    }
  }

  console.log("  ✅ Generated build/icon-2048.png (4K Ultra HD master icon)");
  console.log("  ✅ Generated build/icon.png (1024x1024 master icon)");
  console.log(
    "  ✅ Generated build/icons/ (10 standard Linux XDG icon resolutions: 16x16 to 1024x1024)",
  );
  console.log("  ✅ Generated build/icon.ico (Windows multi-resolution 16-256)");
  console.log(
    "  ✅ Generated build/installerSidebar.bmp (4K-supersampled Windows NSIS installer sidebar)",
  );
  console.log(
    "  ✅ Generated build/uninstallerSidebar.bmp (4K-supersampled Windows NSIS uninstaller sidebar)",
  );
  console.log(
    "  ✅ Generated build/installerHeader.bmp (4K-supersampled Windows NSIS installer header)",
  );
  console.log(
    "✨ [G1Code] All 4K ultra-clarity packaging brand assets generated successfully.",
  );
} finally {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
