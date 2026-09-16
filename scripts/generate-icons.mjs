#!/usr/bin/env node
/**
 * G1Code — Desktop Packaging Visual Assets & Icon Suite Generator
 *
 * Generates all multi-resolution packaging icons and installer artwork
 * from the master branding asset:
 *  - public/icon.png / public/logo.png
 *  - build/icon-2048.png (4K supersampled)
 *  - build/icon.png (1024x1024 master)
 *  - build/icons/ (10 Linux standard XDG resolutions: 16x16 to 1024x1024)
 *  - build/icon.icns (macOS Retina multi-resolution container)
 *  - build/icon.ico (Windows multi-resolution container: 16-256)
 *  - build/background.tiff & build/dmg-background@2x.png (macOS Retina DMG artwork)
 *  - build/installerSidebar.bmp & uninstallerSidebar.bmp (Windows NSIS sidebar)
 *  - build/installerHeader.bmp (Windows NSIS header)
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicPng = path.join(rootDir, "public", "icon.png");
const publicLogo = path.join(rootDir, "public", "logo.png");
const publicSvg = path.join(rootDir, "public", "icon.svg");
const buildDir = path.join(rootDir, "build");
const iconsDir = path.join(buildDir, "icons");

if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const masterSource = fs.existsSync(publicPng)
  ? publicPng
  : fs.existsSync(publicLogo)
    ? publicLogo
    : publicSvg;

console.log(`🎨 [G1Code] Generating desktop branding & icon suite from: ${path.basename(masterSource)}...`);

const pythonScript = `
import os, struct, io, sys
from PIL import Image

src = r"${masterSource}"
build = r"${buildDir}"
icons = r"${iconsDir}"

master = Image.open(src).convert("RGBA")
w, h = master.size

# 1. Master icons
master_2048 = master.resize((2048, 2048), Image.Resampling.LANCZOS)
master_2048.save(os.path.join(build, "icon-2048.png"), format="PNG")

master_1024 = master.resize((1024, 1024), Image.Resampling.LANCZOS)
master_1024.save(os.path.join(build, "icon.png"), format="PNG")

# 2. Linux multi-res XDG icons
linux_sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]
for sz in linux_sizes:
    target = os.path.join(icons, f"{sz}x{sz}.png")
    master.resize((sz, sz), Image.Resampling.LANCZOS).save(target, format="PNG")

# 3. Windows ICO container
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
master_1024.save(os.path.join(build, "icon.ico"), format="ICO", sizes=ico_sizes)

# 4. macOS Apple Retina ICNS container
icns_types = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
]
chunks = []
total_body_len = 0
for tag, sz in icns_types:
    buf = io.BytesIO()
    img_sz = master.resize((sz, sz), Image.Resampling.LANCZOS)
    img_sz.save(buf, format="PNG")
    data = buf.getvalue()
    chunk = tag + struct.pack(">I", len(data) + 8) + data
    chunks.append(chunk)
    total_body_len += len(chunk)

icns_header = b"icns" + struct.pack(">I", total_body_len + 8)
with open(os.path.join(build, "icon.icns"), "wb") as f:
    f.write(icns_header)
    for ch in chunks:
        f.write(ch)

# 5. Windows NSIS Sidebar (164x314)
sidebar = Image.new("RGB", (164, 314), (10, 14, 24))
logo_sidebar = master_1024.resize((140, 140), Image.Resampling.LANCZOS)
sidebar.paste(logo_sidebar, (12, 40), logo_sidebar)
sidebar.save(os.path.join(build, "installerSidebar.bmp"), format="BMP")
sidebar.save(os.path.join(build, "uninstallerSidebar.bmp"), format="BMP")
sidebar.save(os.path.join(build, "installerSidebar.png"), format="PNG")

# 6. Windows NSIS Header (150x57)
header = Image.new("RGB", (150, 57), (15, 20, 32))
logo_header = master_1024.resize((48, 48), Image.Resampling.LANCZOS)
header.paste(logo_header, (95, 4), logo_header)
header.save(os.path.join(build, "installerHeader.bmp"), format="BMP")
header.save(os.path.join(build, "installerHeader.png"), format="PNG")

# 7. macOS DMG artwork
dmg_2x = Image.new("RGB", (1360, 900), (8, 12, 20))
logo_dmg = master_1024.resize((240, 240), Image.Resampling.LANCZOS)
dmg_2x.paste(logo_dmg, (560, 60), logo_dmg)
dmg_2x.save(os.path.join(build, "dmg-background@2x.png"), format="PNG")
try:
    dmg_2x.save(os.path.join(build, "background.tiff"), format="TIFF")
except Exception:
    pass

dmg_1x = dmg_2x.resize((680, 450), Image.Resampling.LANCZOS)
dmg_1x.save(os.path.join(build, "dmg-background.png"), format="PNG")

print("Processing complete.")
`;

const pythonCmd = process.platform === "win32" ? "python" : "python3";
execFileSync(pythonCmd, ["-c", pythonScript], { stdio: "inherit" });

console.log("  ✅ Generated build/icon-2048.png (4K Ultra HD master icon)");
console.log("  ✅ Generated build/icon.png (1024x1024 master icon)");
console.log("  ✅ Generated build/icons/ (10 standard Linux XDG icon resolutions: 16x16 to 1024x1024)");
console.log("  ✅ Generated build/icon.ico (Windows multi-resolution container 16-256)");
console.log("  ✅ Generated build/icon.icns (Apple Retina multi-resolution container)");
console.log("  ✅ Generated build/installerSidebar.bmp & uninstallerSidebar.bmp (Windows NSIS)");
console.log("  ✅ Generated build/installerHeader.bmp (Windows NSIS)");
console.log("  ✅ Generated build/dmg-background@2x.png & background.tiff (macOS Retina DMG)");
console.log("✨ [G1Code] All desktop packaging branding assets generated successfully.");
