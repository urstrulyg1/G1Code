// Browser fallback client when running outside Electron (e.g. localhost Vite web server)

const agentListeners = new Set<(event: unknown) => void>();
const permissionListeners = new Set<(event: unknown) => void>();

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function ensureEventSource() {
  if (typeof window === "undefined") return;
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  if (eventSource) {
    try {
      eventSource.close();
    } catch {}
    eventSource = null;
  }

  try {
    eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "permission:request") {
          for (const listener of permissionListeners) {
            listener(parsed);
          }
        } else {
          for (const listener of agentListeners) {
            listener(parsed);
          }
        }
      } catch {
        // Ignore unparseable or ping frames
      }
    };
    eventSource.onerror = () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        try {
          eventSource.close();
        } catch {}
        eventSource = null;
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            ensureEventSource();
          }, 1500);
        }
      }
    };
  } catch {
    // SSE not supported or network error
  }
}

async function apiRequest<T = any>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!response.ok) {
    let errorMsg = `HTTP ${response.status} ${response.statusText}`;
    try {
      const json = await response.json();
      if (json.error) errorMsg = json.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

if (typeof window !== "undefined" && !window.g1code) {
  ensureEventSource();

  window.g1code = {
    // In web mode the workspace modal handles folder selection directly;
    // this method is only used by Electron via the preload IPC bridge.
    async chooseWorkspace(): Promise<string | null> {
      return null;
    },

    async getCurrentWorkspace(): Promise<string | null> {
      try {
        const res = await apiRequest<{ workspace: string }>(
          "/api/workspace/current",
        );
        return res.workspace || null;
      } catch {
        return null;
      }
    },

    async openNativeFolder(
      targetPath?: string,
    ): Promise<{ success: boolean; path?: string }> {
      return apiRequest<{ success: boolean; path?: string }>(
        "/api/workspace/open-folder",
        {
          method: "POST",
          body: JSON.stringify({ path: targetPath }),
        },
      );
    },

    async getUsageLimits(): Promise<Record<string, any>> {
      return apiRequest<Record<string, any>>("/api/provider/usage-limits");
    },

    async simulateLimit(
      modelId: string,
      resetInSeconds = 60,
      type: "hourly" | "daily" = "hourly",
      reset = false,
    ): Promise<any> {
      return apiRequest("/api/provider/usage-limits/simulate", {
        method: "POST",
        body: JSON.stringify({ modelId, resetInSeconds, type, reset }),
      });
    },

    async listDirectory(directory: string) {
      return apiRequest<Array<{ name: string; kind: "file" | "directory" }>>(
        "/api/workspace/list",
        {
          method: "POST",
          body: JSON.stringify({ directory }),
        },
      );
    },

    async readFile(filePath: string) {
      const res = await apiRequest<{ content: string }>("/api/file/read", {
        method: "POST",
        body: JSON.stringify({ filePath }),
      });
      return res.content;
    },

    async writeFile(filePath: string, contents: string) {
      const res = await apiRequest<{ success: boolean }>("/api/file/write", {
        method: "POST",
        body: JSON.stringify({ filePath, contents }),
      });
      return res.success;
    },

    async runCommand(command: string, cwd: string) {
      return apiRequest<{ output: string; exitCode: number }>(
        "/api/terminal/run",
        {
          method: "POST",
          body: JSON.stringify({ command, cwd }),
        },
      );
    },

    async getSettings() {
      return apiRequest<any>("/api/settings");
    },

    async saveSettings(settings: Record<string, unknown>) {
      return apiRequest("/api/settings", {
        method: "POST",
        body: JSON.stringify(settings),
      });
    },

    async getModels(provider?: string) {
      const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      return apiRequest<
        Array<{
          id: string;
          name: string;
          supportsTools?: boolean;
          provider?: string;
        }>
      >(`/api/provider/models${q}`);
    },

    async getFreeModels(provider?: string) {
      const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      return apiRequest<
        Array<{
          id: string;
          name: string;
          supportsTools?: boolean;
          isPromotional?: boolean;
          provider?: string;
        }>
      >(`/api/provider/models/free${q}`);
    },

    async testProvider(model?: string, provider?: string) {
      return apiRequest("/api/provider/test", {
        method: "POST",
        body: JSON.stringify({ model, provider }),
      });
    },

    async verifyProvider(provider?: string) {
      return apiRequest("/api/provider/verify", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
    },

    async refreshModels(provider?: string) {
      return apiRequest("/api/provider/refresh", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
    },

    async startAgent(input: {
      workspace: string;
      prompt: string;
      mode: "ask" | "plan" | "agent";
      model?: string;
      reasoning?: string;
      provider?: string;
      attachedContext?: string[];
    }) {
      ensureEventSource();
      return apiRequest<{ sessionId: string; model?: string }>(
        "/api/agent/start",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async setSessionModel(sessionId: string, model: string) {
      return apiRequest("/api/agent/session-model", {
        method: "POST",
        body: JSON.stringify({ sessionId, model }),
      });
    },

    async commitGit(workspace: string, message: string) {
      return apiRequest("/api/git/commit", {
        method: "POST",
        body: JSON.stringify({ workspace, message }),
      });
    },

    async generateCommitMsg(workspace: string, model?: string) {
      return apiRequest("/api/git/generate-commit-msg", {
        method: "POST",
        body: JSON.stringify({ workspace, model }),
      });
    },

    async searchWorkspace(workspace: string, query: string) {
      return apiRequest<Array<{ file: string; line: number; content: string }>>(
        `/api/workspace/search?workspace=${encodeURIComponent(workspace)}&query=${encodeURIComponent(query)}`,
      );
    },

    stopAgent(sessionId: string) {
      apiRequest("/api/agent/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      }).catch((err) => console.error("Failed to stop agent:", err));
    },

    async listSessions(workspace: string) {
      return apiRequest<
        Array<{ id: string; title: string; mode: string; status: string }>
      >(`/api/agent/sessions?workspace=${encodeURIComponent(workspace)}`);
    },

    async rebuildIndex(workspace: string) {
      return apiRequest<{ files: number }>("/api/index/rebuild", {
        method: "POST",
        body: JSON.stringify({ workspace }),
      });
    },

    async searchSymbols(workspace: string, query: string) {
      return apiRequest<
        Array<{
          symbol: string;
          kind: string;
          path: string;
          line: number;
          column: number;
          parent?: string;
        }>
      >("/api/index/search", {
        method: "POST",
        body: JSON.stringify({ workspace, query }),
      });
    },

    async loadSessionEvents(workspace: string, sessionId: string) {
      return apiRequest(
        `/api/agent/events-history?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(sessionId)}`,
      );
    },

    async loadSession(workspace: string, sessionId: string) {
      return apiRequest(
        `/api/agent/session?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(sessionId)}`,
      );
    },

    async listChanges(workspace: string, sessionId?: string) {
      const q = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "";
      return apiRequest(
        `/api/agent/changes?workspace=${encodeURIComponent(workspace)}${q}`,
      );
    },

    async change(
      workspace: string,
      sessionId: string,
      id: string,
      action: "approve" | "reject" | "apply" | "revert",
    ) {
      return apiRequest("/api/agent/change", {
        method: "POST",
        body: JSON.stringify({ workspace, sessionId, id, action }),
      });
    },

    async approveAllChanges(workspace: string, sessionId: string) {
      return apiRequest("/api/agent/approve-all", {
        method: "POST",
        body: JSON.stringify({ workspace, sessionId }),
      });
    },

    async rejectAllChanges(workspace: string, sessionId: string) {
      return apiRequest("/api/agent/reject-all", {
        method: "POST",
        body: JSON.stringify({ workspace, sessionId }),
      });
    },

    async discardSession(workspace: string, sessionId: string) {
      return apiRequest("/api/agent/discard", {
        method: "POST",
        body: JSON.stringify({ workspace, sessionId }),
      });
    },

    respondPermission(requestId: string, allowed: boolean) {
      apiRequest("/api/agent/permission", {
        method: "POST",
        body: JSON.stringify({ requestId, allowed }),
      }).catch((err) => console.error("Failed to respond to permission:", err));
    },

    onAgentEvent(listener: (event: unknown) => void): () => void {
      ensureEventSource();
      agentListeners.add(listener);
      return () => {
        agentListeners.delete(listener);
      };
    },

    onPermissionRequest(listener: (event: unknown) => void): () => void {
      ensureEventSource();
      permissionListeners.add(listener);
      return () => {
        permissionListeners.delete(listener);
      };
    },

    async getPendingPermissions(sessionId?: string) {
      const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      return apiRequest<
        Array<{
          requestId: string;
          sessionId: string;
          tool: string;
          input: unknown;
          createdAt: number;
        }>
      >(`/api/agent/permissions/pending${q}`);
    },

    async getSession(workspace: string, sessionId: string) {
      return apiRequest(
        `/api/agent/session?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(sessionId)}`,
      );
    },

    // Extended IDE capabilities
    async getGitStatus(workspace: string) {
      return apiRequest(
        `/api/git/status?workspace=${encodeURIComponent(workspace)}&limit=5000`,
      );
    },

    async getProblems(workspace: string) {
      return apiRequest(
        `/api/problems?workspace=${encodeURIComponent(workspace)}`,
      );
    },
  } as any;
}

export {};
