# ADR-0002 — Electron desktop shell with a shell abstraction

**Status:** Accepted  
**Date:** 2026-09-07

## Context

G1Code must ship on macOS, Windows, and Linux (Apple Silicon, x64, ARM64) with Monaco, a GPU-capable terminal, native PTYs, file watchers, and a multi-process host.

Options: Electron, Tauri, a fully native shell, Theia/Electron, or a custom Chromium embed.

## Decision

**Phase 1–7:** Electron as the desktop shell.

**Always:** a `ShellHost` interface so the workbench, IPC, windows, auto-update, and protocol handlers do not import Electron APIs directly.

**Phase 8+:** re-evaluate Tauri (or CEF) against measured Electron cost, once the product is real.

## Alternatives

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Electron | Identical Chromium everywhere; VS Code-proven; node-pty, native modules, DevTools; Monaco/xterm just work | RAM, installer size, “Electron tax” |
| Tauri 2 | 10–50× smaller installer, lower idle RAM, capability security, Rust backend | WebView fragmentation (WebKit vs WebView2 vs WebKitGTK) is lethal for an IDE; PTY/native module story is harder; Linux webview quality varies |
| Native (GPUI/WGPU) | Best latency | Rewriting the entire UI; no Monaco; years |
| Theia | Desktop + browser from one codebase | Wrong product shape (see ADR-0001) |

## Reason

For an IDE, **pixel-identical, modern Chromium** beats a smaller binary. Monaco, xterm.js canvas/WebGL renderers, complex CSS layout, and DevTools debugging all assume Chromium. Tauri’s WebView split is an unacceptable compatibility surface for Phase 1. Electron is how VS Code, Cursor, Windsurf, and Antigravity already ship; we take the runtime, not the product fork.

The `ShellHost` abstraction keeps the door open.

## Consequences

- Idle memory target is **honestly higher** than Zed (~200–500 MB workbench before project load). Performance work goes into process isolation and avoiding extra Chromium renderers, not pretending we are native.
- Auto-update: electron-updater with **signature verification** (see packaging architecture).
- Future Tauri port is an adapter rewrite, not a product rewrite, if `ShellHost` is respected.
