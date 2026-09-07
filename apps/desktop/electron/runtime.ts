import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OpenAICompatibleProvider } from "../../../packages/ai/providers/openai-compatible";
import { ToolRegistry } from "../../../packages/tools/types";
import { workspaceTools } from "../../../packages/tools/workspace";
import { gitTools } from "../../../packages/tools/git";
import { AgentRuntime, AgentEvent } from "../../../packages/agent/runtime";
import { openDatabase } from "../../../packages/database/connection";
import { DatabaseStore } from "../../../packages/database/repositories";
import { AgentRuntimeManager } from "../../../packages/agent/manager";

type Settings = {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyConfigured: boolean;
};
const settingsPath = () =>
  path.join(app.getPath("userData"), "g1code-settings.json");
const keyPath = () => path.join(app.getPath("userData"), "g1code-api-key.bin");

async function readSettings(): Promise<Settings> {
  const defaults: Settings = {
    provider: "experimental-labs",
    endpoint: "https://api.openai.com/v1",
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  };
  try {
    return {
      ...defaults,
      ...JSON.parse(await fs.readFile(settingsPath(), "utf8")),
      apiKeyConfigured: await fs
        .stat(keyPath())
        .then(() => true)
        .catch(() => false),
    };
  } catch {
    return defaults;
  }
}
async function saveSettings(input: Partial<Settings> & { apiKey?: string }) {
  const current = await readSettings();
  const next = {
    ...current,
    provider: String(input.provider ?? current.provider),
    endpoint: String(input.endpoint ?? current.endpoint),
    model: String(input.model ?? current.model),
    temperature: Number(input.temperature ?? current.temperature),
    maxTokens: Number(input.maxTokens ?? current.maxTokens),
  };
  if (input.apiKey) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("OS secure storage is unavailable");
    await fs.mkdir(path.dirname(keyPath()), { recursive: true });
    await fs.writeFile(keyPath(), safeStorage.encryptString(input.apiKey));
    next.apiKeyConfigured = true;
  }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
async function configuredProvider() {
  const settings = await readSettings();
  if (!settings.apiKeyConfigured) throw new Error("Configure an API key first");
  const key = safeStorage.decryptString(await fs.readFile(keyPath()));
  return {
    settings,
    provider: new OpenAICompatibleProvider(settings.endpoint, key),
  };
}
function validWorkspace(input: unknown) {
  if (typeof input !== "string" || !path.isAbsolute(input))
    throw new Error("A selected absolute workspace path is required");
  return path.resolve(input);
}

export function registerRuntimeHandlers(
  getWindow: () => BrowserWindow | undefined,
  getSelectedWorkspace: () => string | undefined,
) {
  const store = new DatabaseStore(openDatabase());
  const manager = new AgentRuntimeManager();
  ipcMain.handle("settings:get", async () => readSettings());
  ipcMain.handle(
    "settings:save",
    async (_event, input: Partial<Settings> & { apiKey?: string }) =>
      saveSettings(input),
  );
  ipcMain.handle("provider:models", async () => {
    const { provider } = await configuredProvider();
    return provider.getModels();
  });
  ipcMain.handle("provider:test", async (_event, model?: string) => {
    const { provider, settings } = await configuredProvider();
    const models = await provider.getModels();
    return {
      connected: true,
      model: model || settings.model || models[0]?.id,
      models,
    };
  });
  ipcMain.handle("agent:sessions", async (_event, workspace: string) =>
    store.recentSessions(validWorkspace(workspace)),
  );
  ipcMain.handle("agent:events", async (_event, sessionId: string) => {
    if (typeof sessionId !== "string" || sessionId.length > 100)
      throw new Error("Invalid session ID");
    return store.sessionEvents(sessionId);
  });
  ipcMain.handle(
    "agent:start",
    async (
      _event,
      input: {
        workspace: string;
        prompt: string;
        mode: "ask" | "plan" | "agent";
      },
    ) => {
      if (
        !input ||
        typeof input.prompt !== "string" ||
        !["ask", "plan", "agent"].includes(input.mode)
      )
        throw new Error("Invalid agent request");
      const { provider, settings } = await configuredProvider();
      if (!settings.model)
        throw new Error("Select a model before starting an AI task");
      const workspace = validWorkspace(input.workspace);
      const selectedWorkspace = getSelectedWorkspace();
      if (!selectedWorkspace || workspace !== path.resolve(selectedWorkspace))
        throw new Error("Agent workspace must be the selected workspace");
      const instructions = await fs
        .readFile(path.join(workspace, ".g1code", "instructions.md"), "utf8")
        .catch(() => "");
      const registry = new ToolRegistry();
      [...workspaceTools(), ...gitTools()].forEach((tool) =>
        registry.register(tool),
      );
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      store.createSession({
        id: sessionId,
        workspaceId: workspace,
        title: input.prompt.slice(0, 80),
        mode: input.mode,
        model: settings.model,
        provider: settings.provider,
        status: "RUNNING",
      });
      store.addMessage(sessionId, "user", input.prompt);
      const emit = (agentEvent: AgentEvent) => {
        store.addEvent(sessionId, agentEvent.type, agentEvent);
        if (agentEvent.type === "text" || agentEvent.type === "done")
          store.addMessage(sessionId, "assistant", agentEvent.message ?? "");
        if (agentEvent.state === "COMPLETED")
          store.updateSessionStatus(sessionId, "COMPLETED");
        if (agentEvent.state === "FAILED")
          store.updateSessionStatus(sessionId, "FAILED");
        if (agentEvent.state === "STOPPED")
          store.updateSessionStatus(sessionId, "STOPPED");
        getWindow()?.webContents.send("agent:event", {
          ...agentEvent,
          sessionId,
        });
      };
      const agentProvider = {
        getModels: provider.getModels.bind(provider),
        chat: provider.chat.bind(provider),
        streamChat: (request: Parameters<typeof provider.streamChat>[0]) =>
          provider.streamChat({
            ...request,
            model: settings.model,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          }),
      };
      const runtime = new AgentRuntime(
        agentProvider,
        registry,
        workspace,
        emit,
        async (tool, value) => {
          if (tool.permission === "safe") return true;
          return new Promise<boolean>((resolve) => {
            const requestId = `${sessionId}-${Date.now()}`;
            let settled = false;
            const finish = (allowed: boolean) => {
              if (settled) return;
              settled = true;
              ipcMain.removeListener("permission:response", listener);
              resolve(allowed);
            };
            const listener = (
              _event: Electron.IpcMainEvent,
              response: { requestId: string; allowed: boolean },
            ) => {
              if (response?.requestId === requestId)
                finish(response.allowed === true);
            };
            ipcMain.on("permission:response", listener);
            getWindow()?.webContents.send("permission:request", {
              requestId,
              tool: tool.name,
              input: value,
              sessionId,
            });
          });
        },
        undefined,
        sessionId,
      );
      manager.startSession(sessionId, runtime, (signal) =>
        runtime.run(
          `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}${input.prompt}`,
          input.mode,
          signal,
        ),
      );
      return { sessionId };
    },
  );
  ipcMain.on("agent:stop", (_event, sessionId: string) => {
    if (typeof sessionId === "string") manager.cancelSession(sessionId);
  });
}
