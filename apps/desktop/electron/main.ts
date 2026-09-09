import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile, spawn, ChildProcess } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { safeRealPath } from "../../../packages/tools/workspace";

const execFileAsync = promisify(execFile);
const root = __dirname;
let selectedWorkspace: string | undefined;
let serverProcess: ChildProcess | null = null;

async function ensureBackendServer() {
  try {
    const res = await fetch("http://127.0.0.1:3131/api/health").catch(
      () => null,
    );
    if (res && res.ok) return;
  } catch {
    // not running
  }
  const appPath = app.getAppPath();
  const tsxPath = path.join(appPath, "node_modules", "tsx", "dist", "cli.mjs");
  const serverScript = path.join(appPath, "server.ts");
  try {
    serverProcess = spawn(process.execPath, [tsxPath, serverScript], {
      cwd: appPath,
      stdio: "ignore",
      env: { ...process.env, PORT: "3131" },
    });
  } catch {
    // ignore
  }
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

ipcMain.handle("workspace:choose", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled) return null;
  selectedWorkspace = path.resolve(result.filePaths[0]);
  return selectedWorkspace;
});
ipcMain.handle("workspace:get-current", () => {
  return selectedWorkspace || null;
});
ipcMain.handle(
  "workspace:open-native-folder",
  async (_event, targetPath?: string) => {
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
  },
);
ipcMain.handle("workspace:list", async (_event, directory: string) => {
  if (
    typeof directory !== "string" ||
    directory.length === 0 ||
    directory.length > 4096
  )
    throw new Error("Invalid workspace directory");
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
ipcMain.handle("file:read", async (_event, filePath: string) => {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.length > 4096
  )
    throw new Error("Invalid file path");
  if (!selectedWorkspace) throw new Error("Open a workspace first");
  return fs.readFile(
    await safeRealPath(
      selectedWorkspace,
      path.relative(selectedWorkspace, filePath),
    ),
    "utf8",
  );
});
ipcMain.handle(
  "file:write",
  async (_event, filePath: string, contents: string) => {
    if (
      typeof filePath !== "string" ||
      filePath.length === 0 ||
      filePath.length > 4096
    )
      throw new Error("Invalid file path");
    if (!selectedWorkspace) throw new Error("Open a workspace first");
    if (typeof contents !== "string" || contents.length > 10_000_000)
      throw new Error("Invalid file contents");
    await fs.writeFile(
      await safeRealPath(
        selectedWorkspace,
        path.relative(selectedWorkspace, filePath),
      ),
      contents,
      "utf8",
    );
    return true;
  },
);
ipcMain.handle("terminal:run", async (_event, command: string, cwd: string) => {
  if (typeof command !== "string" || command.length > 10_000)
    throw new Error("Invalid command");
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > 4096)
    throw new Error("Invalid working directory");
  if (!selectedWorkspace) throw new Error("Open a workspace first");
  const workingDirectory = await safeRealPath(
    selectedWorkspace,
    path.relative(selectedWorkspace, cwd),
  );
  try {
    const result = await execFileAsync(
      process.platform === "win32" ? "cmd.exe" : "sh",
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-lc", command],
      { cwd: workingDirectory, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
    );
    return { output: `${result.stdout}${result.stderr}`, exitCode: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      output: `${failure.stdout ?? ""}${failure.stderr ?? String(error)}`,
      exitCode: failure.code ?? 1,
    };
  }
});
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
  ipcMain.handle("settings:get", async () => api("/api/settings"));
  ipcMain.handle("settings:save", async (_e, input) =>
    api("/api/settings", { method: "POST", body: JSON.stringify(input) }),
  );
  const providerQuery = (input?: { provider?: string }) =>
    input?.provider ? `?provider=${encodeURIComponent(input.provider)}` : "";
  ipcMain.handle("provider:models", async (_e, input) =>
    api(`/api/provider/models${providerQuery(input)}`),
  );
  ipcMain.handle("provider:models:free", async (_e, input) =>
    api(`/api/provider/models/free${providerQuery(input)}`),
  );
  // preload sends a single `{ model, provider }` object
  ipcMain.handle("provider:test", async (_e, input) =>
    api("/api/provider/test", {
      method: "POST",
      body: JSON.stringify(
        input && typeof input === "object" ? input : { model: input },
      ),
    }),
  );
  ipcMain.handle("provider:verify", async (_e, input) =>
    api("/api/provider/verify", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
  ipcMain.handle("provider:refresh", async (_e, input) =>
    api("/api/provider/refresh", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
  ipcMain.handle("provider:usage-limits", async () =>
    api("/api/provider/usage-limits"),
  );
  ipcMain.handle("provider:usage-limits:simulate", async (_e, input) =>
    api("/api/provider/usage-limits/simulate", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );

  ipcMain.handle("agent:start", async (_e, input) =>
    api("/api/agent/start", { method: "POST", body: JSON.stringify(input) }),
  );
  ipcMain.handle("agent:session-model", async (_e, input) =>
    api("/api/agent/session-model", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  ipcMain.on("agent:stop", (_e, sessionId) => {
    api("/api/agent/stop", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }).catch((err) => console.error("[IPC] agent:stop failed:", err));
  });
  ipcMain.handle("agent:sessions", async (_e, ws) =>
    api(
      `/api/agent/sessions?workspace=${encodeURIComponent(ws || selectedWorkspace || "")}`,
    ),
  );
  ipcMain.handle("agent:session", async (_e, { workspace, sessionId }) =>
    api(
      `/api/agent/session?workspace=${encodeURIComponent(workspace || selectedWorkspace || "")}&sessionId=${encodeURIComponent(sessionId)}`,
    ),
  );
  ipcMain.handle("agent:events", async (_e, { workspace, sessionId }) =>
    api(
      `/api/agent/events-history?workspace=${encodeURIComponent(workspace || selectedWorkspace || "")}&sessionId=${encodeURIComponent(sessionId)}`,
    ),
  );
  ipcMain.handle("agent:changes", async (_e, { workspace, sessionId }) =>
    api(
      `/api/agent/changes?workspace=${encodeURIComponent(workspace || selectedWorkspace || "")}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  );
  ipcMain.handle("agent:change", async (_e, input) =>
    api("/api/agent/change", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("agent:approve-all-changes", async (_e, input) =>
    api("/api/agent/approve-all", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("agent:reject-all-changes", async (_e, input) =>
    api("/api/agent/reject-all", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("agent:discard-session", async (_e, input) =>
    api("/api/agent/discard", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.on("permission:response", (_e, input) => {
    api("/api/agent/permission", {
      method: "POST",
      body: JSON.stringify(input),
    }).catch((err) =>
      console.error("[IPC] permission:response failed:", err),
    );
  });

  // Git / search / diagnostics
  ipcMain.handle("git:commit", async (_e, input) =>
    api("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("git:generate-commit-msg", async (_e, input) =>
    api("/api/git/generate-commit-msg", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("git:status", async (_e, ws) =>
    api(
      `/api/git/status?workspace=${encodeURIComponent(ws || selectedWorkspace || "")}&limit=5000`,
    ),
  );
  ipcMain.handle("problems:get", async (_e, ws) =>
    api(
      `/api/problems?workspace=${encodeURIComponent(ws || selectedWorkspace || "")}`,
    ),
  );
  ipcMain.handle("workspace:search", async (_e, { workspace, query }) =>
    api(
      `/api/workspace/search?workspace=${encodeURIComponent(workspace || selectedWorkspace || "")}&query=${encodeURIComponent(query ?? "")}`,
    ),
  );

  ipcMain.handle("index:rebuild", async (_e, input) =>
    api("/api/index/rebuild", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
    }),
  );
  ipcMain.handle("index:search", async (_e, input) =>
    api("/api/index/search", {
      method: "POST",
      body: JSON.stringify({ workspace: selectedWorkspace, ...input }),
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
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});
