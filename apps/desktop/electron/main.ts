import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile, spawn, ChildProcess } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { safeRealPath } from "../../../packages/tools/workspace";
import { validateIpcPayload } from "./ipc-schemas";
import { spawnCommand } from "../../../packages/tools/command";

/**
 * Every IPC handler goes through a schema. `handle` is the only registration
 * helper in this file so it is not possible to add an unvalidated channel by
 * accident (see ./ipc-schemas.ts).
 */
function handle<T = unknown, R = unknown>(
  channel: string,
  fn: (input: T) => R | Promise<R>,
) {
  ipcMain.handle(channel, async (_event, value) =>
    fn(validateIpcPayload<T>(channel, value)),
  );
}

/** Fire-and-forget channels (the renderer does not await a result). */
function handleNotify<T = unknown>(channel: string, fn: (input: T) => void) {
  ipcMain.on(channel, (_event, value) => {
    try {
      fn(validateIpcPayload<T>(channel, value));
    } catch (error) {
      console.error(`[IPC] Rejected ${channel}:`, error);
    }
  });
}

const execFileAsync = promisify(execFile);
const root = __dirname;
let selectedWorkspace: string | undefined;
let serverProcess: ChildProcess | null = null;

function findNodeExecutable(): string {
  const isWin = process.platform === "win32";
  const nodeName = isWin ? "node.exe" : "node";

  if (process.env.NODE_PATH && existsSync(process.env.NODE_PATH)) {
    return process.env.NODE_PATH;
  }

  const candidateDirs = isWin
    ? [
        process.env.ProgramFiles
          ? path.join(process.env.ProgramFiles, "nodejs")
          : "",
        process.env["ProgramFiles(x86)"]
          ? path.join(process.env["ProgramFiles(x86)"], "nodejs")
          : "",
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, "Programs", "node")
          : "",
        process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
      ].filter(Boolean)
    : [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        path.join(process.env.HOME || "", ".nvm/versions/node"),
      ];

  for (const dir of candidateDirs) {
    const candidate = path.join(dir, nodeName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return isWin ? "node.exe" : "node";
}

function resolveServerScript(appPath: string): {
  binary: string;
  args: string[];
  workingDir: string;
} {
  const nodeBin = findNodeExecutable();
  const unpackedRoot = appPath.includes("app.asar")
    ? appPath.replace(/app\.asar$/, "app.asar.unpacked")
    : appPath;

  const candidateServerScripts = [
    path.join(unpackedRoot, "dist-electron", "server.js"),
    path.join(appPath, "dist-electron", "server.js"),
    path.join(unpackedRoot, "server.js"),
  ];

  for (const scriptPath of candidateServerScripts) {
    if (existsSync(scriptPath)) {
      return {
        binary: nodeBin,
        args: [scriptPath],
        workingDir: path.dirname(scriptPath),
      };
    }
  }

  // Development fallback with tsx
  const tsxCli = path.join(appPath, "node_modules", "tsx", "dist", "cli.mjs");
  const tsServer = path.join(appPath, "server.ts");
  if (existsSync(tsxCli) && existsSync(tsServer)) {
    return {
      binary: nodeBin,
      args: [tsxCli, tsServer],
      workingDir: appPath,
    };
  }

  const fallback = path.join(unpackedRoot, "dist-electron", "server.js");
  return { binary: nodeBin, args: [fallback], workingDir: unpackedRoot };
}

async function ensureBackendServer() {
  try {
    const res = await fetch("http://127.0.0.1:3131/api/health").catch(
      () => null,
    );
    if (res && res.ok) return;
  } catch {
    // not running
  }

  if (serverProcess) return;

  const appPath = app.getAppPath();
  const { binary, args, workingDir } = resolveServerScript(appPath);

  try {
    serverProcess = spawn(binary, args, {
      cwd: workingDir,
      stdio: "ignore",
      env: { ...process.env, PORT: "3131" },
    });

    serverProcess.on("error", (err) => {
      console.error("[Backend Process Error]:", err);
    });

    serverProcess.on("exit", (code, signal) => {
      console.log(
        `[Backend Process] Exited with code ${code}, signal ${signal}`,
      );
      serverProcess = null;
    });
  } catch (err) {
    console.error("[Backend Spawn Error]:", err);
  }

  // Poll briefly for server readiness (up to 4.5 seconds)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:3131/api/health").catch(
        () => null,
      );
      if (res && res.ok) {
        console.log("[Backend] Server active on port 3131");
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Phase 4: when the renderer disappears, any live agent session must unwind
 * immediately. Without this the backend would keep a pending approval waiter
 * alive until its 15-minute timeout because nothing told it the window is gone.
 */
async function notifyRendererClosed(sessionIds?: string[]) {
  try {
    await fetch(`${API_BASE}/api/agent/renderer-closed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds }),
    });
  } catch (err) {
    console.error("[RendererClosed] Failed to notify backend:", err);
  }
}

/**
 * Phase 4 human-editor write path.
 *
 * The editor is a privileged operation: it writes user content directly. It now
 * (1) stays inside the workspace, (2) refuses to follow a symlink out of the
 * workspace, (3) writes atomically via a temporary file, and (4) refuses to
 * overwrite a file that changed on disk since the renderer last read it when
 * the renderer supplies the hash it holds.
 */
async function writeWorkspaceFile(
  filePath: string,
  contents: string,
  expectedHash?: string,
): Promise<{ written: boolean; hash: string; conflict?: boolean }> {
  const target = await safeRealPath(
    selectedWorkspace!,
    path.relative(selectedWorkspace!, filePath),
  );
  const current = await fs.readFile(target, "utf8").catch(() => null);
  const currentHash = current === null ? null : fileContentHash(current);
  if (expectedHash && currentHash !== null && expectedHash !== currentHash) {
    return { written: false, hash: currentHash, conflict: true };
  }
  const temporary = `${target}.g1code-tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  return { written: true, hash: fileContentHash(contents) };
}

/** Currently running human terminal processes, keyed by command text. */
const terminalProcesses = new Map<
  string,
  { cancel: () => Promise<void>; process: { pid?: number } }
>();
function terminalRunId(command: string) {
  return `${process.pid}:${command}`;
}
function fileContentHash(content: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(content).digest("hex");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    webPreferences: {
      preload: path.join(root, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Security: prevent opening external windows or untrusted navigation
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (
      !url.startsWith("http://localhost:5173") &&
      !url.startsWith("file://")
    ) {
      event.preventDefault();
    }
  });

  const distIndex = path.join(app.getAppPath(), "dist", "index.html");
  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (existsSync(distIndex)) {
    window.loadFile(distIndex);
  } else {
    window.loadURL("http://localhost:5173");
  }

  startEventBridge(window);

  // A crashed renderer must cancel sessions too, not just a clean close.
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Renderer] Process gone:", details.reason);
    void notifyRendererClosed();
  });
  window.on("closed", () => {
    void notifyRendererClosed();
  });

  if (process.argv.includes("--smoke")) {
    window.webContents.on("did-finish-load", () => {
      console.log("SMOKE_LOAD_SUCCESS");
      setTimeout(() => app.quit(), 500);
    });
    setTimeout(() => {
      console.log("SMOKE_TIMEOUT_QUIT");
      app.quit();
    }, 4000);
  }
}

async function applyWorkspace(targetPath: string): Promise<string> {
  if (
    typeof targetPath !== "string" ||
    targetPath.length === 0 ||
    targetPath.length > 4096
  ) {
    throw new Error("Invalid workspace path");
  }
  const resolved = path.resolve(targetPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Selected path is not a folder: ${resolved}`);
  }
  selectedWorkspace = resolved;
  // Keep the backend HTTP server (agent, index, git) on the same workspace.
  // Best-effort: a temporarily unavailable backend must not block opening.
  try {
    await api("/api/workspace/choose", {
      method: "POST",
      body: JSON.stringify({ path: resolved }),
    });
  } catch (err) {
    console.error("[Workspace] Failed to sync backend server:", err);
  }
  return resolved;
}

// Programmatic workspace selection (manual path entry from the renderer).
handle<{ path: string }>("workspace:set", async ({ path: targetPath }) => {
  return applyWorkspace(targetPath);
});

ipcMain.handle("workspace:choose", async (event) => {
  validateIpcPayload("workspace:choose", undefined);
  // Native OS folder picker — the same mechanism VS Code uses.
  //   macOS   → NSOpenPanel in folder mode: select the folder itself, click "Open"
  //   Windows → standard open dialog in folder mode: select the folder itself,
  //             click "Select Folder"
  // No file selection is required or possible.
  const parent = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: "Open Project Folder",
    message: "Choose the project folder to open as your workspace",
    defaultPath:
      selectedWorkspace && existsSync(selectedWorkspace)
        ? selectedWorkspace
        : app.getPath("home"),
    properties: ["openDirectory"],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    return await applyWorkspace(result.filePaths[0]);
  } catch (err) {
    console.error("[Workspace] Failed to open selected folder:", err);
    return null;
  }
});
handle("workspace:get-current", () => {
  return selectedWorkspace || null;
});
handle<{ path?: string }>("workspace:open-native-folder", async (input) => {
  const targetPath = input?.path;
  const dir = targetPath || selectedWorkspace || process.cwd();
  if (dir) {
    const resolved = path.resolve(dir);
    try {
      if (!existsSync(resolved)) {
        await fs.mkdir(resolved, { recursive: true });
      }
    } catch {
      // ignore
    }
    await shell.openPath(resolved);
    return { success: true, path: resolved };
  }
  return { success: false, error: "No directory specified" };
});
handle<{ directory: string }>("workspace:list", async ({ directory }) => {
  if (!selectedWorkspace) throw new Error("Open a workspace first");
  const entries = await fs.readdir(
    selectedWorkspace
      ? await safeRealPath(
          selectedWorkspace,
          path.relative(selectedWorkspace, directory),
        )
      : directory,
    { withFileTypes: true },
  );
  return entries
    .filter((entry) => !entry.name.startsWith(".") || entry.name === ".g1code")
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : "file",
    }))
    .sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.localeCompare(b.name),
    );
});
handle<{ path: string }>("file:read", async ({ path: filePath }) => {
  if (!selectedWorkspace) throw new Error("Open a workspace first");
  return fs.readFile(
    await safeRealPath(
      selectedWorkspace,
      path.relative(selectedWorkspace, filePath),
    ),
    "utf8",
  );
});
handle<{ path: string; contents: string; expectedHash?: string }>(
  "file:write",
  async ({ path: filePath, contents, expectedHash }) => {
    if (!selectedWorkspace) throw new Error("Open a workspace first");
    return writeWorkspaceFile(filePath, contents, expectedHash);
  },
);
handle<{ command: string; cwd?: string }>(
  "terminal:run",
  async ({ command, cwd }) => {
    if (!selectedWorkspace) throw new Error("Open a workspace first");
    const workingDirectory = await safeRealPath(
      selectedWorkspace,
      path.relative(selectedWorkspace, cwd || selectedWorkspace),
    );
    // Phase 4: the human terminal uses the same spawned, cancellable,
    // process-tree-aware implementation as agent commands instead of a
    // completion-only execFile with a different output limit.
    const execution = spawnCommand(
      command,
      workingDirectory,
      undefined,
      120_000,
    );
    terminalProcesses.set(terminalRunId(command), execution);
    const MAX_OUTPUT = 2 * 1024 * 1024;
    let output = "";
    const drain = async (stream: AsyncIterable<string>) => {
      for await (const chunk of stream) {
        if (output.length >= MAX_OUTPUT) continue;
        output += chunk.slice(0, MAX_OUTPUT - output.length);
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed())
            window.webContents.send("terminal:output", {
              command,
              chunk,
            });
        }
      }
    };
    const [result] = await Promise.all([
      execution.wait(),
      drain(execution.stdout),
      drain(execution.stderr),
    ]);
    terminalProcesses.delete(terminalRunId(command));
    return {
      output,
      exitCode: result.exitCode,
      signal: null,
      truncated: result.truncated,
      duration: result.duration,
    };
  },
);
const API_BASE = "http://127.0.0.1:3131";

async function api(pathname: string, options?: RequestInit) {
  await ensureBackendServer();
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function registerApiBridgeHandlers() {
  handle("settings:get", () => api("/api/settings"));
  handle("settings:save", (input) =>
    api("/api/settings", { method: "POST", body: JSON.stringify(input) }),
  );
  const providerQuery = (input?: { provider?: string }) =>
    input?.provider ? `?provider=${encodeURIComponent(input.provider)}` : "";
  handle<{ provider?: string }>("provider:models", (input) =>
    api(`/api/provider/models${providerQuery(input)}`),
  );
  handle<{ provider?: string }>("provider:models:free", (input) =>
    api(`/api/provider/models/free${providerQuery(input)}`),
  );
  handle<{ model?: string; provider?: string }>("provider:test", (input) =>
    api("/api/provider/test", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
  handle<{ provider?: string }>("provider:verify", (input) =>
    api("/api/provider/verify", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
  handle<{ provider?: string }>("provider:refresh", (input) =>
    api("/api/provider/refresh", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
  handle("provider:usage-limits", () => api("/api/provider/usage-limits"));
  handle<{ modelId: string }>("provider:usage-limits:simulate", (input) =>
    api("/api/provider/usage-limits/simulate", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );

  handle("agent:start", (input) =>
    api("/api/agent/start", { method: "POST", body: JSON.stringify(input) }),
  );
  handle("agent:session-model", (input) =>
    api("/api/agent/session-model", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  handleNotify<{ sessionId: string }>("agent:stop", ({ sessionId }) => {
    api("/api/agent/stop", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }).catch((err) => console.error("[IPC] agent:stop failed:", err));
  });
  const workspaceOf = (value?: string) => value || selectedWorkspace || "";
  handle<{ workspace: string }>("agent:sessions", ({ workspace }) =>
    api(
      `/api/agent/sessions?workspace=${encodeURIComponent(workspaceOf(workspace))}`,
    ),
  );
  handle<{ workspace: string; sessionId: string }>(
    "agent:session",
    ({ workspace, sessionId }) =>
      api(
        `/api/agent/session?workspace=${encodeURIComponent(workspaceOf(workspace))}&sessionId=${encodeURIComponent(sessionId)}`,
      ),
  );
  handle<{
    workspace: string;
    sessionId: string;
    action: string;
    title?: string;
  }>("agent:session:update", ({ workspace, sessionId, action, title }) =>
    api("/api/agent/session-update", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(workspace),
        sessionId,
        action,
        title,
      }),
    }),
  );
  handle<{ workspace: string; sessionId: string }>(
    "agent:events",
    ({ workspace, sessionId }) =>
      api(
        `/api/agent/events-history?workspace=${encodeURIComponent(workspaceOf(workspace))}&sessionId=${encodeURIComponent(sessionId)}`,
      ),
  );
  handle<{ workspace: string; sessionId?: string }>(
    "agent:changes",
    ({ workspace, sessionId }) =>
      api(
        `/api/agent/changes?workspace=${encodeURIComponent(workspaceOf(workspace))}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      ),
  );
  handle<{ workspace?: string; sessionId: string; id: string; action: string }>(
    "agent:change",
    (input) =>
      api("/api/agent/change", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle<{ workspace?: string; sessionId: string }>(
    "agent:approve-all-changes",
    (input) =>
      api("/api/agent/approve-all", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle<{ workspace?: string; sessionId: string }>(
    "agent:reject-all-changes",
    (input) =>
      api("/api/agent/reject-all", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle<{ workspace?: string; sessionId: string }>(
    "agent:discard-session",
    (input) =>
      api("/api/agent/discard", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle("permission:response", (input) =>
    api("/api/agent/permission", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  handle<string | undefined>("agent:get-pending-permissions", (sessionId) => {
    const query = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : "";
    return api(`/api/agent/permissions/pending${query}`);
  });
  handle<{ workspace?: string; sessionId: string }>(
    "agent:get-session",
    ({ workspace, sessionId }) =>
      api(
        `/api/agent/session?workspace=${encodeURIComponent(workspaceOf(workspace))}&sessionId=${encodeURIComponent(sessionId)}`,
      ),
  );

  // Git / search / diagnostics
  handle<{ workspace?: string; message: string }>("git:commit", (input) =>
    api("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(input.workspace),
        ...input,
      }),
    }),
  );
  handle<{ workspace?: string; model?: string }>(
    "git:generate-commit-msg",
    (input) =>
      api("/api/git/generate-commit-msg", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle<{ workspace?: string }>("git:status", ({ workspace }) =>
    api(
      `/api/git/status?workspace=${encodeURIComponent(workspaceOf(workspace))}&limit=5000`,
    ),
  );
  handle<{
    workspace?: string;
    path: string;
    startLine?: number;
    endLine?: number;
  }>("git:blame", ({ workspace, path: filePath, startLine, endLine }) =>
    api(
      `/api/git/blame?workspace=${encodeURIComponent(workspaceOf(workspace))}&path=${encodeURIComponent(filePath)}${startLine ? `&startLine=${startLine}` : ""}${endLine ? `&endLine=${endLine}` : ""}`,
    ),
  );
  handle<{ workspace?: string; path: string; limit?: number }>(
    "git:file-history",
    ({ workspace, path: filePath, limit }) =>
      api(
        `/api/git/file-history?workspace=${encodeURIComponent(workspaceOf(workspace))}&path=${encodeURIComponent(filePath)}&limit=${limit ?? 20}`,
      ),
  );
  handle<{ workspace?: string }>("problems:get", ({ workspace }) =>
    api(
      `/api/problems?workspace=${encodeURIComponent(workspaceOf(workspace))}`,
    ),
  );
  handle<{ workspace?: string; query: string }>(
    "workspace:search",
    ({ workspace, query }) =>
      api(
        `/api/workspace/search?workspace=${encodeURIComponent(workspaceOf(workspace))}&query=${encodeURIComponent(query ?? "")}`,
      ),
  );

  // Phase 4 repository intelligence, context assembly, verification, diagnostics
  handle<{ workspace?: string; query: string; limit?: number; kind?: string }>(
    "repository:search",
    (input) =>
      api("/api/repository/search", {
        method: "POST",
        body: JSON.stringify({
          workspace: workspaceOf(input.workspace),
          ...input,
        }),
      }),
  );
  handle<{ workspace?: string }>("repository:status", ({ workspace }) =>
    api(
      `/api/repository/status?workspace=${encodeURIComponent(workspaceOf(workspace))}`,
    ),
  );
  handle("repository:index", () =>
    api("/api/repository/index", {
      method: "POST",
      body: JSON.stringify({ workspace: workspaceOf(undefined) }),
    }),
  );
  handle<{
    workspace?: string;
    prompt: string;
    openFile?: string;
    selection?: string;
    budget?: number;
  }>("context:assemble", (input) =>
    api("/api/context/assemble", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(input.workspace),
        ...input,
      }),
    }),
  );
  handle<{
    workspace?: string;
    sessionId?: string;
    paths?: string[];
    level?: string;
  }>("verification:run", (input) =>
    api("/api/verification/run", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(input.workspace),
        ...input,
      }),
    }),
  );
  handle<{ workspace?: string; sessionId?: string }>(
    "verification:list",
    ({ workspace, sessionId }) =>
      api(
        `/api/verification/list?workspace=${encodeURIComponent(workspaceOf(workspace))}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      ),
  );
  handle<{ workspace?: string }>("diagnostics:get", ({ workspace }) =>
    api(
      `/api/diagnostics?workspace=${encodeURIComponent(workspaceOf(workspace))}`,
    ),
  );
  handle<{ workspace?: string }>("index:rebuild", (input) =>
    api("/api/index/rebuild", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(input.workspace),
        ...input,
      }),
    }),
  );
  handle<{ workspace?: string; query: string }>("index:search", (input) =>
    api("/api/index/search", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceOf(input.workspace),
        ...input,
      }),
    }),
  );
}

function startEventBridge(win: BrowserWindow) {
  const connect = () => {
    if (win.isDestroyed()) return;
    try {
      const http = require("node:http");
      const req = http.get("http://127.0.0.1:3131/api/events", (res: any) => {
        let buffer = "";
        res.on("data", (chunk: any) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (part.startsWith("data: ")) {
              try {
                const data = JSON.parse(part.slice(6));
                if (win.isDestroyed()) return;
                if (data.type === "permission:request") {
                  win.webContents.send("permission:request", data);
                } else {
                  win.webContents.send("agent:event", data);
                }
              } catch {}
            }
          }
        });
        res.on("end", () => {
          setTimeout(connect, 2000);
        });
      });
      req.on("error", () => {
        setTimeout(connect, 3000);
      });
    } catch {
      setTimeout(connect, 3000);
    }
  };
  connect();
}

app.whenReady().then(async () => {
  await ensureBackendServer();
  registerApiBridgeHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void notifyRendererClosed();
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  void notifyRendererClosed();
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});
