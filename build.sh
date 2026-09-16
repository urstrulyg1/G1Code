#!/usr/bin/env bash
# ==============================================================================
# G1Code — Zero-Config Hardware & OS Desktop Packaging Script
# 
# Automatically detects host operating system AND hardware architecture:
#   - Apple Silicon Mac (M1/M2/M3/M4): Builds macOS arm64 .dmg
#   - Intel Mac (x86_64): Builds macOS x64 .dmg
#   - 64-bit Windows PC: Builds Windows x64 .exe (NSIS Installer)
#   - 32-bit Windows PC: Builds Windows x86/ia32 .exe (NSIS Installer)
#   - Linux PC: Builds AppImage for host architecture
#
# Usage (no flags required):
#   ./build.sh                  # Detects host OS + hardware and builds native binary
#
# Optional overrides:
#   ./build.sh --all            # Builds all operating systems and architectures
#   ./build.sh --all-arch       # Builds all architectures for the detected OS
#   ./build.sh --mac            # Forces macOS build
#   ./build.sh --win            # Forces Windows build
#   ./build.sh --linux          # Forces Linux build
#   ./build.sh --arm64          # Forces ARM64 architecture
#   ./build.sh --x64            # Forces x64 architecture
#   ./build.sh --ia32           # Forces x86 (32-bit) architecture
#   ./build.sh --clean          # Wipes previous dist/ and release/ before build
#   ./build.sh --skip-tests     # Skips running the test suite
# ==============================================================================

set -euo pipefail

# Visual formatting
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Hardware and OS auto-detection
UNAME_S="$(uname -s 2>/dev/null || echo 'Unknown')"
UNAME_M="$(uname -m 2>/dev/null || echo 'Unknown')"
CPU_MODEL=""

if [ "$UNAME_S" = "Darwin" ]; then
  CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo '')"
fi

DETECTED_OS="unknown"
DETECTED_ARCH="unknown"
OS_NAME="Unknown"
ARCH_NAME="Unknown"

# Detect OS
case "$UNAME_S" in
  Darwin*)
    DETECTED_OS="mac"
    OS_NAME="macOS"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT*)
    DETECTED_OS="win"
    OS_NAME="Windows"
    ;;
  Linux*)
    DETECTED_OS="linux"
    OS_NAME="Linux"
    ;;
  *)
    DETECTED_OS="win"
    OS_NAME="Windows"
    ;;
esac

# Detect Hardware Architecture
case "$UNAME_M" in
  arm64|aarch64)
    DETECTED_ARCH="arm64"
    if [ "$DETECTED_OS" = "mac" ]; then
      ARCH_NAME="Apple Silicon (arm64)"
    else
      ARCH_NAME="ARM64 (aarch64)"
    fi
    ;;
  x86_64|amd64|AMD64)
    DETECTED_ARCH="x64"
    ARCH_NAME="Intel / AMD 64-bit (x64)"
    ;;
  i386|i686|x86)
    DETECTED_ARCH="ia32"
    ARCH_NAME="Intel / AMD 32-bit (x86)"
    ;;
  *)
    DETECTED_ARCH="x64"
    ARCH_NAME="x64"
    ;;
esac

# Default target and arch from auto-detection
TARGET="$DETECTED_OS"
TARGET_ARCH="$DETECTED_ARCH"
BUILD_ALL_ARCH=false
EXPLICIT_CONFIG=false
CLEAN_FIRST=false
SKIP_TESTS=false

# 2. Argument parsing (optional overrides)
for arg in "$@"; do
  case "$arg" in
    --mac|-m|mac)
      TARGET="mac"
      EXPLICIT_CONFIG=true
      ;;
    --win|-w|win)
      TARGET="win"
      EXPLICIT_CONFIG=true
      ;;
    --linux|-l|linux)
      TARGET="linux"
      EXPLICIT_CONFIG=true
      ;;
    --arm64)
      TARGET_ARCH="arm64"
      EXPLICIT_CONFIG=true
      ;;
    --x64)
      TARGET_ARCH="x64"
      EXPLICIT_CONFIG=true
      ;;
    --ia32|--x86)
      TARGET_ARCH="ia32"
      EXPLICIT_CONFIG=true
      ;;
    --all-arch)
      BUILD_ALL_ARCH=true
      EXPLICIT_CONFIG=true
      ;;
    --all|-a|all)
      TARGET="all"
      BUILD_ALL_ARCH=true
      EXPLICIT_CONFIG=true
      ;;
    --clean|-c)
      CLEAN_FIRST=true
      ;;
    --skip-tests)
      SKIP_TESTS=true
      ;;
    --help|-h)
      echo -e "${BOLD}G1Code Zero-Config Hardware & OS Packaging Utility${NC}"
      echo ""
      echo -e "Usage: ${CYAN}./build.sh${NC} ${DIM}(no flags needed - automatically detects OS and hardware architecture)${NC}"
      echo ""
      echo -e "Optional overrides:"
      echo -e "  ${CYAN}--all, -a${NC}        Cross-compile all operating systems and architectures"
      echo -e "  ${CYAN}--all-arch${NC}       Build all architectures for the current OS (e.g. arm64 + x64)"
      echo -e "  ${CYAN}--mac, -m${NC}        Build for macOS"
      echo -e "  ${CYAN}--win, -w${NC}        Build for Windows"
      echo -e "  ${CYAN}--linux, -l${NC}      Build for Linux"
      echo -e "  ${CYAN}--arm64${NC}          Force Apple Silicon / ARM64 build"
      echo -e "  ${CYAN}--x64${NC}            Force Intel / AMD 64-bit build"
      echo -e "  ${CYAN}--ia32, --x86${NC}    Force 32-bit x86 build"
      echo -e "  ${CYAN}--clean, -c${NC}      Clean dist/, dist-electron/, and release/ directories before packaging"
      echo -e "  ${CYAN}--skip-tests${NC}     Skip running the test suite"
      echo -e "  ${CYAN}--help, -h${NC}       Show this help documentation"
      exit 0
      ;;
    *)
      echo -e "${YELLOW}Warning: Unknown option '$arg'. Using detected hardware (${OS_NAME} ${ARCH_NAME}).${NC}"
      ;;
  esac
done

echo ""
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}    G1Code — Hardware & OS Auto-Packaging Engine     ${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"

if [ "$EXPLICIT_CONFIG" = false ]; then
  echo -e " 🖥️  ${BOLD}Detected Operating System:${NC}  ${GREEN}${BOLD}${OS_NAME}${NC} (${UNAME_S})"
  echo -e " ⚙️  ${BOLD}Detected Hardware Arch:${NC}     ${PURPLE}${BOLD}${ARCH_NAME}${NC} (${UNAME_M})"
  if [ -n "$CPU_MODEL" ]; then
    echo -e " 🧠  ${BOLD}Detected Processor:${NC}         ${CYAN}${CPU_MODEL}${NC}"
  fi
  echo -e " 🎯  ${BOLD}Action:${NC}                     Building native package for this hardware"
  echo -e "     ${DIM}(Zero-flag mode: zero flags passed or required)${NC}"
else
  echo -e " 🎯  ${BOLD}Target Override:${NC}   ${CYAN}${TARGET}${NC} (arch: ${CYAN}${TARGET_ARCH}${NC}, all-arch: ${CYAN}${BUILD_ALL_ARCH}${NC})"
fi

echo -e " 🌿  ${DIM}Node Environment:${NC}  $(node -v)"
echo ""

# 0. Clean previous release output to ensure only the target installer is created
echo -e "${CYAN}🚀 [1/6] Cleaning previous release directory...${NC}"
if [ -d "dist-release" ]; then
  rm -rf dist-release 2>/dev/null || (sleep 1 && rm -rf dist-release 2>/dev/null) || true
fi
rm -rf .icon-tmp .icon-gen-tmp 2>/dev/null || true
if [ "$CLEAN_FIRST" = true ]; then
  rm -rf dist dist-electron 2>/dev/null || true
  echo -e "   ✅ Cleaned dist/, dist-electron/, and dist-release/"
else
  echo -e "   ✅ Cleaned dist-release/"
fi

# 1. Generate multi-resolution icons (.icns, .ico, .png)
echo -e "${CYAN}🎨 [2/6] Generating branded desktop icons...${NC}"
if [ -f "scripts/generate-icons.mjs" ]; then
  node scripts/generate-icons.mjs
fi

# 2. Run automated test suite
if [ "$SKIP_TESTS" = false ]; then
  echo -e "${CYAN}🧪 [3/6] Validating test suite...${NC}"
  npm test
else
  echo -e "${YELLOW}⏩ [3/6] Skipping test suite (--skip-tests active)${NC}"
fi

# 3. Build web production bundle and electron main
echo -e "${CYAN}⚡ [4/6] Compiling production bundle (Vite + TypeScript)...${NC}"
npm run build

# 4. Package desktop releases via electron-builder
echo -e "${CYAN}📦 [5/6] Packaging desktop binaries with electron-builder...${NC}"

case "$TARGET" in
  mac)
    if [ "$BUILD_ALL_ARCH" = true ]; then
      echo -e "   👉 Packaging macOS DMGs for all architectures (Apple Silicon arm64 + Intel x64)..."
      npx electron-builder --mac --arm64 --x64 -p never --config electron-builder.json
    else
      echo -e "   👉 Packaging macOS DMG specifically for detected hardware (${TARGET_ARCH})..."
      npx electron-builder --mac "--${TARGET_ARCH}" -p never --config electron-builder.json
    fi
    ;;
  win)
    if [ "$BUILD_ALL_ARCH" = true ]; then
      echo -e "   👉 Packaging Windows EXEs for all architectures (64-bit x64 + 32-bit ia32/x86)..."
      npx electron-builder --win --x64 --ia32 -p never --config electron-builder.json
    else
      echo -e "   👉 Packaging Windows EXE specifically for detected hardware (${TARGET_ARCH})..."
      npx electron-builder --win "--${TARGET_ARCH}" -p never --config electron-builder.json
    fi
    ;;
  linux)
    if [ "$BUILD_ALL_ARCH" = true ]; then
      echo -e "   👉 Packaging Linux packages for all architectures (x64 + arm64)..."
      npx electron-builder --linux --x64 --arm64 -p never --config electron-builder.json
    else
      echo -e "   👉 Packaging Linux package specifically for detected hardware (${TARGET_ARCH})..."
      npx electron-builder --linux "--${TARGET_ARCH}" -p never --config electron-builder.json
    fi
    ;;
  all)
    echo -e "   👉 Cross-compiling macOS DMGs (arm64 + x64)..."
    npx electron-builder --mac --arm64 --x64 -p never --config electron-builder.json
    echo -e "   👉 Cross-compiling Windows EXEs (x64 + ia32/x86)..."
    npx electron-builder --win --x64 --ia32 -p never --config electron-builder.json
    echo -e "   👉 Cross-compiling Linux packages (x64 + arm64)..."
    npx electron-builder --linux --x64 --arm64 -p never --config electron-builder.json
    ;;
esac

# 5. Purge all intermediate updater blockmaps, metadata manifests, and staging folders
echo -e "${CYAN}🧹 [6/6] Purging intermediate metadata and staging folders...${NC}"
rm -rf dist-release/*.blockmap dist-release/*.yml dist-release/*.yaml dist-release/mac-* dist-release/win-* dist-release/linux-* dist-release/*-unpacked dist-release/*.zip

echo ""
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}       Packaging Completed Successfully!             ${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "${BOLD}Generated Native Hardware Installer in dist-release/:${NC}"
echo ""

if [ -d "dist-release" ]; then
  ls -lh dist-release/*.dmg dist-release/*.exe dist-release/*.AppImage dist-release/*.deb 2>/dev/null || ls -lh dist-release/
fi

echo ""
echo -e "${CYAN}Your native desktop installer is ready in:${NC} ${BOLD}${SCRIPT_DIR}/dist-release/${NC}"
echo ""
