import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("g1code", {
  chooseWorkspace: () =>
    ipcRenderer.invoke("workspace:choose") as Promise<string | null>,
  getCurrentWorkspace: () =>
    ipcRenderer.invoke("workspace:get-current") as Promise<string | null>,
  openNativeFolder: (targetPath?: string) =>
    ipcRenderer.invoke("workspace:open-native-folder", targetPath) as Promise<{
      success: boolean;
      path?: string;
    }>,
  getUsageLimits: () => ipcRenderer.invoke("provider:usage-limits"),
  simulateLimit: (
    modelId: string,
    resetInSeconds = 60,
    type: "hourly" | "daily" = "hourly",
    reset = false,
  ) =>
    ipcRenderer.invoke("provider:usage-limits:simulate", {
      modelId,
      resetInSeconds,
      type,
      reset,
    }),
  listDirectory: (directory: string) =>
    ipcRenderer.invoke("workspace:list", directory) as Promise<
      Array<{ name: string; kind: "file" | "directory" }>
    >,
  readFile: (filePath: string) =>
    ipcRenderer.invoke("file:read", filePath) as Promise<string>,
  writeFile: (filePath: string, contents: string) =>
    ipcRenderer.invoke("file:write", filePath, contents) as Promise<boolean>,
  runCommand: (command: string, cwd: string) =>
    ipcRenderer.invoke("terminal:run", command, cwd) as Promise<{
      output: string;
      exitCode: number;
    }>,
  getSettings: () =>
    ipcRenderer.invoke("settings:get") as Promise<{
      provider: string;
      endpoint: string;
      model: string;
      temperature: number;
      maxTokens: number;
      apiKeyConfigured: boolean;
    }>,
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save", settings),
  getModels: (provider?: string) =>
    ipcRenderer.invoke("provider:models", { provider }),
  getFreeModels: (provider?: string) =>
    ipcRenderer.invoke("provider:models:free", { provider }),
  testProvider: (model?: string, provider?: string) =>
    ipcRenderer.invoke("provider:test", { model, provider }),
  verifyProvider: (provider?: string) =>
    ipcRenderer.invoke("provider:verify", { provider }),
  refreshModels: (provider?: string) =>
    ipcRenderer.invoke("provider:refresh", { provider }),
  startAgent: (input: {
    workspace: string;
    prompt: string;
    mode: "ask" | "plan" | "agent";
    model?: string;
    provider?: string;
    attachedContext?: string[];
  }) => ipcRenderer.invoke("agent:start", input),
  setSessionModel: (sessionId: string, model: string) =>
    ipcRenderer.invoke("agent:session-model", { sessionId, model }),
  stopAgent: (sessionId: string) => ipcRenderer.send("agent:stop", sessionId),
  listSessions: (workspace: string) =>
    ipcRenderer.invoke("agent:sessions", workspace),
  rebuildIndex: (workspace: string) =>
    ipcRenderer.invoke("index:rebuild", { workspace }),
  searchSymbols: (workspace: string, query: string) =>
    ipcRenderer.invoke("index:search", { workspace, query }),
  searchWorkspace: (workspace: string, query: string) =>
    ipcRenderer.invoke("workspace:search", { workspace, query }),
  commitGit: (workspace: string, message: string) =>
    ipcRenderer.invoke("git:commit", { workspace, message }),
  generateCommitMsg: (workspace: string, model?: string) =>
    ipcRenderer.invoke("git:generate-commit-msg", { workspace, model }),
  loadSessionEvents: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:events", { workspace, sessionId }),
  loadSession: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:session", { workspace, sessionId }),
  listChanges: (workspace: string, sessionId?: string) =>
    ipcRenderer.invoke("agent:changes", { workspace, sessionId }),
  change: (
    workspace: string,
    sessionId: string,
    id: string,
    action: "approve" | "reject" | "apply" | "revert",
  ) => ipcRenderer.invoke("agent:change", { workspace, sessionId, id, action }),
  approveAllChanges: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:approve-all-changes", { workspace, sessionId }),
  rejectAllChanges: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:reject-all-changes", { workspace, sessionId }),
  discardSession: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:discard-session", { workspace, sessionId }),
  respondPermission: (requestId: string, allowed: boolean) =>
    ipcRenderer.send("permission:response", { requestId, allowed }),
  onAgentEvent: (listener: (event: unknown) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, value: unknown) =>
      listener(value);
    ipcRenderer.on("agent:event", callback);
    return () => ipcRenderer.removeListener("agent:event", callback);
  },
  onPermissionRequest: (listener: (event: unknown) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, value: unknown) =>
      listener(value);
    ipcRenderer.on("permission:request", callback);
    return () => ipcRenderer.removeListener("permission:request", callback);
  },
  getGitStatus: (workspace: string) =>
    ipcRenderer.invoke("git:status", workspace),
  getProblems: (workspace: string) =>
    ipcRenderer.invoke("problems:get", workspace),
});
