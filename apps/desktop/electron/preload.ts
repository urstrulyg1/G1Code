import { contextBridge, ipcRenderer } from "electron";

/**
 * The renderer's only privileged surface.
 *
 * Phase 4 rules (enforced by `ipc-schemas.ts` on the main side):
 *   * every channel takes exactly one object payload — no positional argument
 *     soup, no accidental `undefined` smuggling;
 *   * the renderer never supplies file contents or hashes to an apply path;
 *   * no credential is ever returned to the renderer (settings only expose
 *     `apiKeyConfigured` / `apiKeyMasked`).
 */
contextBridge.exposeInMainWorld("g1code", {
  chooseWorkspace: () =>
    ipcRenderer.invoke("workspace:choose") as Promise<string | null>,
  setWorkspace: (targetPath: string) =>
    ipcRenderer.invoke("workspace:set", { path: targetPath }) as Promise<string>,
  getCurrentWorkspace: () =>
    ipcRenderer.invoke("workspace:get-current") as Promise<string | null>,
  openNativeFolder: (targetPath?: string) =>
    ipcRenderer.invoke("workspace:open-native-folder", { path: targetPath }) as Promise<{
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
    ipcRenderer.invoke("workspace:list", { directory }) as Promise<
      Array<{ name: string; kind: "file" | "directory" }>
    >,
  readFile: (filePath: string) =>
    ipcRenderer.invoke("file:read", { path: filePath }) as Promise<string>,
  /**
   * Write an editor buffer. `expectedHash` (optional) makes the write
   * conflict-aware: when the file changed on disk since the renderer read it,
   * the write is refused instead of silently overwriting.
   */
  writeFile: (filePath: string, contents: string, expectedHash?: string) =>
    ipcRenderer.invoke("file:write", {
      path: filePath,
      contents,
      expectedHash,
    }) as Promise<{
      written: boolean;
      hash: string;
      conflict?: boolean;
    }>,
  runCommand: (command: string, cwd: string) =>
    ipcRenderer.invoke("terminal:run", { command, cwd }) as Promise<{
      output: string;
      exitCode: number;
      truncated?: boolean;
      duration?: number;
    }>,
  onTerminalOutput: (listener: (event: unknown) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, value: unknown) =>
      listener(value);
    ipcRenderer.on("terminal:output", callback);
    return () => ipcRenderer.removeListener("terminal:output", callback);
  },
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
    sessionId?: string;
    model?: string;
    reasoning?: string;
    provider?: string;
    executionMode?: "review" | "auto" | "plan" | "readonly";
    attachedContext?: string[];
    openFile?: string;
    selection?: string;
    autoContext?: boolean;
  }) =>
    ipcRenderer.invoke("agent:start", input) as Promise<{
      sessionId: string;
      requestId: string;
      executionMode: string;
      model?: string;
      contextManifest?: unknown;
    }>,
  setSessionModel: (sessionId: string, model: string, workspace?: string) =>
    ipcRenderer.invoke("agent:session-model", { sessionId, model, workspace }),
  stopAgent: (sessionId: string) =>
    ipcRenderer.send("agent:stop", { sessionId }),
  listSessions: (workspace: string) =>
    ipcRenderer.invoke("agent:sessions", { workspace }),
  updateSession: (
    workspace: string,
    sessionId: string,
    action: "rename" | "archive" | "unarchive" | "delete",
    title?: string,
  ) =>
    ipcRenderer.invoke("agent:session:update", {
      workspace,
      sessionId,
      action,
      title,
    }),
  rebuildIndex: (workspace?: string) =>
    ipcRenderer.invoke("index:rebuild", { workspace }),
  searchSymbols: (workspace: string, query: string) =>
    ipcRenderer.invoke("index:search", { workspace, query }),
  searchWorkspace: (workspace: string, query: string) =>
    ipcRenderer.invoke("workspace:search", { workspace, query }),
  searchRepository: (
    workspace: string,
    query: string,
    options?: { limit?: number; kind?: string },
  ) =>
    ipcRenderer.invoke("repository:search", {
      workspace,
      query,
      limit: options?.limit,
      kind: options?.kind,
    }),
  repositoryStatus: (workspace?: string) =>
    ipcRenderer.invoke("repository:status", { workspace }),
  assembleContext: (input: {
    workspace?: string;
    prompt: string;
    openFile?: string;
    selection?: string;
    budget?: number;
  }) => ipcRenderer.invoke("context:assemble", input),
  runVerification: (input: {
    workspace?: string;
    sessionId?: string;
    paths?: string[];
    level?: "targeted" | "full" | "typecheck" | "build";
  }) => ipcRenderer.invoke("verification:run", input),
  listVerification: (workspace?: string, sessionId?: string) =>
    ipcRenderer.invoke("verification:list", { workspace, sessionId }),
  getDiagnostics: (workspace?: string) =>
    ipcRenderer.invoke("diagnostics:get", { workspace }),
  commitGit: (workspace: string, message: string) =>
    ipcRenderer.invoke("git:commit", { workspace, message }),
  generateCommitMsg: (workspace: string, model?: string) =>
    ipcRenderer.invoke("git:generate-commit-msg", { workspace, model }),
  blameFile: (workspace: string, path: string, startLine?: number, endLine?: number) =>
    ipcRenderer.invoke("git:blame", { workspace, path, startLine, endLine }),
  fileHistory: (workspace: string, path: string, limit?: number) =>
    ipcRenderer.invoke("git:file-history", { workspace, path, limit }),
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
    ipcRenderer.invoke("permission:response", { requestId, allowed }),
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
  getPendingPermissions: (sessionId?: string) =>
    ipcRenderer.invoke("agent:get-pending-permissions", sessionId),
  getSession: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke("agent:get-session", { workspace, sessionId }),
  getGitStatus: (workspace: string) =>
    ipcRenderer.invoke("git:status", { workspace }),
  getProblems: (workspace: string) =>
    ipcRenderer.invoke("problems:get", { workspace }),
});
