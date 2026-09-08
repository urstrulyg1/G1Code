import { app, BrowserWindow, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OpenAICompatibleProvider } from "../../../packages/ai/providers/openai-compatible";
import { ToolRegistry } from "../../../packages/tools/types";
import { workspaceTools } from "../../../packages/tools/workspace";
import { gitTools } from "../../../packages/tools/git";
import { AgentRuntime, AgentEvent } from "../../../packages/agent/runtime";
import { openDatabase } from "../../../packages/database/connection";
import { DatabaseStore } from "../../../packages/database/repositories";
import { ChatStorage } from "../../../packages/database/chat-storage";
import { AgentRuntimeManager } from "../../../packages/agent/manager";
import { ChangeService } from "../../../packages/tools/change-service";
import type { ChangeApprovalResult } from "../../../packages/agent/runtime";
import { RepositoryIndexService } from "../../../packages/indexing/service";
import { captureGitBaseline } from "../../../packages/git/baseline";
import { testingTools } from "../../../packages/testing/tool";
import { attributeFiles } from "../../../packages/git/baseline";
import {
  readSettings,
  saveSettings,
  configuredProvider,
  type Settings,
} from "../../../packages/settings/storage";
import { ModelCatalog, globalModelCatalog } from "../../../packages/ai/models";
import { globalUsageLimitManager } from "../../../packages/ai/usage-limits";
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
  store.markRunningSessionsInterrupted();
  try {
    ChatStorage.enforceAllStorageLimits(getSelectedWorkspace());
  } catch (err) {
    console.error("[ChatStorage] Desktop startup limit enforcement error:", err);
  }
  for (const batch of store.activeChangeBatches()) {
    void new ChangeService(store, batch.workspaceId).recoverActiveBatches();
  }
  const manager = new AgentRuntimeManager();
  const indexService = new RepositoryIndexService(store);
  const approvalWaiters = new Map<
    string,
    {
      sessionId: string;
      resolve: (result: ChangeApprovalResult) => void;
    }
  >();
  const activeToolCalls = new Map<string, string>();
  const assistantBuffers = new Map<string, string>();
  const waitForChangeApproval = (sessionId: string, changeId: string) =>
    new Promise<ChangeApprovalResult>((resolve) => {
      approvalWaiters.set(changeId, { sessionId, resolve });
    });
  const finishChangeApproval = async (
    workspace: string,
    changeId: string,
    approved: boolean,
  ) => {
    const waiter = approvalWaiters.get(changeId);
    if (!waiter) throw new Error("Change is not awaiting approval");
    const change = store.getChange(changeId);
    const session = store.getSession(waiter.sessionId);
    if (
      !change ||
      !session ||
      change.sessionId !== waiter.sessionId ||
      session.workspaceId !== workspace
    )
      throw new Error("Change does not belong to the active session");
    const service = new ChangeService(store, workspace);
    const result = approved
      ? await (async () => {
          service.approveChange(changeId);
          return service.applyChange(changeId);
        })()
      : service.rejectChange(changeId);
    const status =
      result.status === "APPLIED" || result.status === "CONFLICT"
        ? result.status
        : "REJECTED";
    const message =
      status === "APPLIED"
        ? "Change applied successfully. Continuing agent."
        : status === "CONFLICT"
          ? "Change conflicted with an external edit. The file was not overwritten."
          : "Change rejected by user.";
    store.addEvent(
      waiter.sessionId,
      approved ? `CHANGE_${status}` : "CHANGE_REJECTED",
      { changeId, status, message },
    );
    getWindow()?.webContents.send("agent:event", {
      type: "approval",
      sessionId: waiter.sessionId,
      changeId,
      message,
      result: { status },
    });
    approvalWaiters.delete(changeId);
    waiter.resolve({ approved: status === "APPLIED", status, message });
    return result;
  };
  ipcMain.handle("settings:get", async () => readSettings());
  ipcMain.handle(
    "settings:save",
    async (_event, input: Partial<Settings> & { apiKey?: string }) =>
      saveSettings(input),
  );
  ipcMain.handle(
    "provider:models",
    async (_event, input?: { provider?: string }) => {
      try {
        const { provider } = await configuredProvider();
        return await provider.getModels();
      } catch {
        return globalModelCatalog.getModels();
      }
    },
  );
  ipcMain.handle(
    "provider:models:free",
    async (_event, input?: { provider?: string }) => {
      try {
        const { provider } = await configuredProvider();
        if (
          "getFreeModels" in provider &&
          typeof (provider as any).getFreeModels === "function"
        ) {
          return await (provider as any).getFreeModels();
        }
        const models = await provider.getModels();
        return models.filter(
          (m: any) =>
            m.pricingType === "free" &&
            m.pricingDetails?.input === 0 &&
            m.pricingDetails?.output === 0,
        );
      } catch {
        return globalModelCatalog.getFreeModels();
      }
    },
  );
  ipcMain.handle("provider:usage-limits", async () => {
    let currentFreeModels: Array<{ id: string; name: string }>;
    try {
      const { provider } = await configuredProvider();
      if (typeof (provider as any).getFreeModels === "function") {
        const free = await (provider as any).getFreeModels();
        currentFreeModels = free.map((m: any) => ({
          id: m.id,
          name: m.name || m.displayName || m.id,
        }));
      } else {
        currentFreeModels = globalModelCatalog
          .getFreeModels()
          .map((m) => ({ id: m.id, name: m.displayName || m.name }));
      }
    } catch {
      currentFreeModels = globalModelCatalog
        .getFreeModels()
        .map((m) => ({ id: m.id, name: m.displayName || m.name }));
    }
    globalUsageLimitManager.pruneExpiredModels(
      new Set(currentFreeModels.map((m) => m.id)),
    );
    return globalUsageLimitManager.getAllUsage(currentFreeModels);
  });
  ipcMain.handle(
    "provider:usage-limits:simulate",
    async (
      _event,
      input: {
        modelId: string;
        resetInSeconds?: number;
        reset?: boolean;
        type?: "hourly" | "daily";
      },
    ) => {
      if (!input?.modelId) throw new Error("modelId is required");
      if (input.reset) {
        return globalUsageLimitManager.resetModelLimit(input.modelId);
      }
      return globalUsageLimitManager.setSimulatedLimit(
        input.modelId,
        input.resetInSeconds || 60,
        input.type || "hourly",
      );
    },
  );
  ipcMain.handle(
    "provider:verify",
    async (_event, input?: { provider?: string }) => {
      try {
        const { provider } = await configuredProvider();
        if (provider.verifyConnection) {
          return provider.verifyConnection();
        }
        const models = await provider.getModels();
        return {
          connected: true,
          modelCount: models.length,
          message: `Connected successfully. ${models.length} models available.`,
        };
      } catch (err) {
        return {
          connected: false,
          modelCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    "provider:test",
    async (_event, input?: { model?: string; provider?: string } | string) => {
      const model = typeof input === "string" ? input : input?.model;
      const providerId =
        typeof input === "object" ? input?.provider : undefined;
      if (
        model !== undefined &&
        (typeof model !== "string" || model.length > 500)
      )
        throw new Error("Invalid model");
      try {
        const { provider, settings } = await configuredProvider();
        const targetModel =
          model ||
          settings.model ||
          globalModelCatalog.getFreeModels()[0]?.id ||
          globalModelCatalog.getModels()[0]?.id ||
          "";
        if (provider.testModel) {
          const result = await provider.testModel(targetModel);
          return { connected: true, model: targetModel, ...result };
        }
        const startTime = Date.now();
        const models = await provider.getModels();
        const target = models.find(
          (m) =>
            m.id.toLowerCase() === targetModel.toLowerCase() ||
            (m as any).slug?.toLowerCase() === targetModel.toLowerCase(),
        );
        const latency = Date.now() - startTime;
        return {
          connected: Boolean(target),
          model: targetModel,
          working: Boolean(target),
          latencyMs: latency,
          ttftMs: latency,
          output: target
            ? `Model ${targetModel} verified active via non-billable catalog.`
            : "",
          error: target ? undefined : `Model ${targetModel} not found in catalog.`,
        };
      } catch (err) {
        return {
          connected: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    "provider:refresh",
    async (_event, input?: { provider?: string }) => {
      try {
        const { provider } = await configuredProvider();
        if (typeof (provider as any).verifyFreeModels === "function") {
          const verifyResult = await (provider as any).verifyFreeModels();
          return {
            success: true,
            models: verifyResult.freeModels,
            count: verifyResult.freeModelCount,
            totalModels: verifyResult.totalModels,
            added: verifyResult.added,
            removed: verifyResult.removed,
            message: verifyResult.message,
          };
        }
        const models =
          typeof (provider as any).getFreeModels === "function"
            ? await (provider as any).getFreeModels()
            : await provider.getModels();
        return { success: true, models, count: models.length };
      } catch {
        const models = globalModelCatalog.getFreeModels();
        return { success: true, models, count: models.length };
      }
    },
  );
  ipcMain.handle("agent:sessions", async (_event, workspace: string) => {
    const selected = getSelectedWorkspace();
    if (!selected || validWorkspace(workspace) !== path.resolve(selected))
      throw new Error("Workspace is not selected");
    return store.recentSessions(validWorkspace(workspace));
  });
  ipcMain.handle(
    "index:rebuild",
    async (_event, input: { workspace: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (workspace !== getSelectedWorkspace())
        throw new Error("Workspace is not selected");
      const entries = await indexService.index(workspace);
      return { files: entries.length };
    },
  );
  ipcMain.handle(
    "index:search",
    async (_event, input: { workspace: string; query: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (
        workspace !== getSelectedWorkspace() ||
        typeof input.query !== "string" ||
        input.query.length === 0 ||
        input.query.length > 500
      )
        throw new Error("Invalid search request");
      return store.searchSymbols(workspace, input.query);
    },
  );
  ipcMain.handle(
    "agent:events",
    async (_event, input: { sessionId: string; workspace: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (
        workspace !== getSelectedWorkspace() ||
        !input ||
        typeof input.sessionId !== "string" ||
        input.sessionId.length === 0 ||
        input.sessionId.length > 100
      )
        throw new Error("Invalid session event request");
      const session = store.getSession(input.sessionId);
      if (!session || session.workspaceId !== workspace)
        throw new Error("Session does not belong to workspace");
      return store.sessionEvents(input.sessionId);
    },
  );
  ipcMain.handle(
    "agent:session",
    async (_event, input: { sessionId: string; workspace: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (workspace !== getSelectedWorkspace())
        throw new Error("Workspace is not selected");
      if (
        !input ||
        typeof input.sessionId !== "string" ||
        input.sessionId.length > 100
      )
        throw new Error("Invalid session ID");
      const session = store
        .recentSessions(workspace, 100)
        .find((item) => item.id === input.sessionId);
      if (!session) throw new Error("Session not found");
      return {
        session,
        messages: store.sessionMessages(session.id),
        events: store.sessionEvents(session.id),
        changes: store.pendingChanges(session.id),
        testRuns: store.sessionTestRuns(session.id),
        repairs: store.sessionRepairHistory(session.id),
        summary: store.taskSummary(session.id),
        checkpoint: store.checkpoint(session.id),
      };
    },
  );
  ipcMain.handle(
    "agent:changes",
    async (_event, input: { sessionId?: string; workspace: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (workspace !== getSelectedWorkspace())
        throw new Error("Workspace is not selected");
      if (
        input.sessionId !== undefined &&
        (typeof input.sessionId !== "string" || input.sessionId.length > 100)
      )
        throw new Error("Invalid session ID");
      return store.pendingChanges(input.sessionId);
    },
  );
  ipcMain.handle(
    "agent:change",
    async (
      _event,
      input: {
        action: string;
        id: string;
        sessionId: string;
        workspace: string;
      },
    ) => {
      const workspace = validWorkspace(input?.workspace);
      if (workspace !== getSelectedWorkspace())
        throw new Error("Workspace is not selected");
      if (
        !input ||
        typeof input.id !== "string" ||
        input.id.length === 0 ||
        input.id.length > 100 ||
        typeof input.sessionId !== "string" ||
        input.sessionId.length === 0 ||
        input.sessionId.length > 100 ||
        !["approve", "reject", "apply", "revert"].includes(input.action)
      )
        throw new Error("Invalid change request");
      const service = new ChangeService(store, workspace);
      const change = service.authorizeChange(input.id, input.sessionId);
      if (input.action === "approve") {
        return approvalWaiters.has(input.id)
          ? finishChangeApproval(workspace, input.id, true)
          : (async () => {
              service.approveChange(input.id);
              const applied = await service.applyChange(input.id);
              store.addEvent(
                change.sessionId,
                applied.status === "APPLIED"
                  ? "CHANGE_APPLIED"
                  : "CHANGE_CONFLICT",
                { changeId: input.id, status: applied.status },
              );
              return applied;
            })();
      }
      if (input.action === "reject") {
        return approvalWaiters.has(input.id)
          ? finishChangeApproval(workspace, input.id, false)
          : service.rejectChange(input.id);
      }
      if (input.action === "apply") return service.applyChange(input.id);
      return service.revertChange(input.id);
    },
  );
  ipcMain.handle(
    "agent:approve-all-changes",
    async (_event, input: { workspace: string; sessionId: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (
        workspace !== getSelectedWorkspace() ||
        typeof input.sessionId !== "string"
      )
        throw new Error("Invalid approval request");
      const changes = store.pendingChanges(input.sessionId);
      const session = store.getSession(input.sessionId);
      if (!session || session.workspaceId !== workspace)
        throw new Error("Session does not belong to workspace");
      const conflicts = await Promise.all(
        changes.map((change) =>
          new ChangeService(store, workspace).detectConflict(change.id),
        ),
      );
      if (conflicts.some(Boolean))
        throw new Error("One or more changes conflict with external edits");
      const service = new ChangeService(store, workspace);
      for (const change of changes)
        if (change.status === "PENDING") service.approveChange(change.id);
      const result = await service.applyBatch(
        input.sessionId,
        changes.map((change) => change.id),
      );
      for (const change of changes) {
        const waiter = approvalWaiters.get(change.id);
        if (waiter) {
          approvalWaiters.delete(change.id);
          waiter.resolve({
            approved: true,
            status: "APPLIED",
            message: "Change batch applied successfully. Continuing agent.",
          });
        }
      }
      store.addEvent(input.sessionId, "CHANGE_BATCH_APPLIED", {
        batchId: result.batch?.id,
        changeIds: changes.map((change) => change.id),
      });
      return result;
    },
  );
  ipcMain.handle(
    "agent:reject-all-changes",
    async (_event, input: { workspace: string; sessionId: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (
        workspace !== getSelectedWorkspace() ||
        typeof input.sessionId !== "string"
      )
        throw new Error("Invalid rejection request");
      const session = store.getSession(input.sessionId);
      if (!session || session.workspaceId !== workspace)
        throw new Error("Session does not belong to workspace");
      return Promise.all(
        store.pendingChanges(input.sessionId).map((change) => {
          if (approvalWaiters.has(change.id))
            return finishChangeApproval(workspace, change.id, false);
          const rejected = new ChangeService(store, workspace).rejectChange(
            change.id,
          );
          store.addEvent(input.sessionId, "CHANGE_REJECTED", {
            changeId: change.id,
            status: rejected.status,
          });
          return rejected;
        }),
      );
    },
  );
  ipcMain.handle(
    "agent:discard-session",
    async (_event, input: { workspace: string; sessionId: string }) => {
      const workspace = validWorkspace(input?.workspace);
      if (
        workspace !== getSelectedWorkspace() ||
        typeof input.sessionId !== "string" ||
        input.sessionId.length === 0 ||
        input.sessionId.length > 100
      )
        throw new Error("Invalid discard request");
      const session = store.getSession(input.sessionId);
      if (!session || session.workspaceId !== workspace)
        throw new Error("Session does not belong to workspace");
      for (const change of store.pendingChanges(input.sessionId)) {
        if (approvalWaiters.has(change.id)) {
          approvalWaiters
            .get(change.id)
            ?.resolve({
              approved: false,
              status: "REJECTED",
              message: "Session discarded by user.",
            });
          approvalWaiters.delete(change.id);
        }
        new ChangeService(store, workspace).rejectChange(change.id);
      }
      manager.cancelSession(input.sessionId);
      store.updateSessionStatus(input.sessionId, "STOPPED");
      store.addEvent(input.sessionId, "SESSION_DISCARDED", {
        message: "Session discarded by user.",
      });
      return { status: "STOPPED" };
    },
  );
  ipcMain.handle(
    "agent:start",
    async (
      _event,
      input: {
        workspace: string;
        prompt: string;
        mode: "ask" | "plan" | "agent";
        model?: string;
        attachedContext?: string[];
      },
    ) => {
      if (
        !input ||
        typeof input.prompt !== "string" ||
        !["ask", "plan", "agent"].includes(input.mode)
      )
        throw new Error("Invalid agent request");
      const { provider, settings } = await configuredProvider();
      let selectedModel =
        input.model ||
        settings.model ||
        globalModelCatalog.getFreeModels()[0]?.id ||
        globalModelCatalog.getModels()[0]?.id ||
        "";

      // Enforce usage limits for Experiential Labs free models & auto-failover
      let { allowed, limitInfo } =
        globalUsageLimitManager.checkAndIncrement(selectedModel);
      if (!allowed) {
        // Automatically switch to the next best available free model based on API ranking
        const nextBest = globalModelCatalog.getNextBestFreeModel(
          selectedModel,
          new Set([selectedModel]),
        );
        if (nextBest) {
          selectedModel = nextBest.id;
          const retryCheck =
            globalUsageLimitManager.checkAndIncrement(selectedModel);
          allowed = retryCheck.allowed;
          limitInfo = retryCheck.limitInfo;
        }
      }

      if (!allowed) {
        const remainingMs = Math.max(
          0,
          (limitInfo.limitType === "daily"
            ? limitInfo.dailyResetAt
            : limitInfo.hourlyResetAt) - Date.now(),
        );
        const mins = Math.ceil(remainingMs / 60000);
        throw new Error(
          `Model "${limitInfo.name}" has reached its ${limitInfo.limitType} usage limit (${limitInfo.limitType === "daily" ? limitInfo.dailyLimit : limitInfo.hourlyLimit} requests). Resets in ${mins} minute${mins === 1 ? "" : "s"}. No other free models currently available.`,
        );
      }
      const workspace = validWorkspace(input.workspace);
      const selectedWorkspace = getSelectedWorkspace();
      if (!selectedWorkspace || workspace !== path.resolve(selectedWorkspace))
        throw new Error("Agent workspace must be the selected workspace");
      const instructions = await fs
        .readFile(path.join(workspace, ".g1code", "instructions.md"), "utf8")
        .catch(() => "");
      const registry = new ToolRegistry();
      [...workspaceTools(), ...gitTools(), ...testingTools()].forEach((tool) =>
        registry.register(tool),
      );
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const changeService = new ChangeService(store, workspace);
      store.createSession({
        id: sessionId,
        workspaceId: workspace,
        title: input.prompt.slice(0, 80),
        mode: input.mode,
        model: selectedModel,
        provider: settings.provider,
        status: "RUNNING",
      });
      const baseline = await captureGitBaseline(workspace).catch(() => null);
      if (baseline) store.saveGitBaseline(sessionId, baseline);
      store.addMessage(sessionId, "user", input.prompt);
      const emit = (agentEvent: AgentEvent) => {
        store.addEvent(sessionId, agentEvent.type, agentEvent);
        if (agentEvent.type === "tool" && agentEvent.toolCallId) {
          const key = `${sessionId}:${agentEvent.toolCallId}`;
          if (agentEvent.input !== undefined && !activeToolCalls.has(key)) {
            activeToolCalls.set(
              key,
              store.addToolCall(
                sessionId,
                agentEvent.toolName ?? "unknown",
                agentEvent.input,
              ),
            );
          }
          if (agentEvent.result !== undefined) {
            const recordId = activeToolCalls.get(key);
            if (recordId)
              store.finishToolCall(
                recordId,
                agentEvent.result,
                agentEvent.result &&
                  typeof agentEvent.result === "object" &&
                  "isError" in agentEvent.result &&
                  agentEvent.result.isError
                  ? "FAILED"
                  : "COMPLETED",
              );
            activeToolCalls.delete(key);
          }
        }
        if (agentEvent.type === "text") {
          const prev = assistantBuffers.get(sessionId) || "";
          assistantBuffers.set(sessionId, prev + (agentEvent.message ?? ""));
        } else if (agentEvent.type === "done") {
          const full =
            agentEvent.message || assistantBuffers.get(sessionId) || "";
          if (full.trim()) {
            store.addMessage(sessionId, "assistant", full);
          }
          assistantBuffers.delete(sessionId);
        } else if (agentEvent.type === "tool" || agentEvent.type === "state") {
          const pending = assistantBuffers.get(sessionId);
          if (pending && pending.trim()) {
            store.addMessage(sessionId, "assistant", pending);
            assistantBuffers.delete(sessionId);
          }
        }
        if (agentEvent.state === "WAITING_FOR_CHANGE_APPROVAL")
          store.updateSessionStatus(sessionId, "WAITING_FOR_APPROVAL");
        if (agentEvent.state === "EXECUTING")
          store.updateSessionStatus(sessionId, "RUNNING");
        if (agentEvent.state === "COMPLETED")
          store.updateSessionStatus(sessionId, "COMPLETED");
        if (agentEvent.state === "FAILED")
          store.updateSessionStatus(sessionId, "FAILED");
        if (agentEvent.state === "STOPPED")
          store.updateSessionStatus(sessionId, "STOPPED");
        if (agentEvent.state === "CANCELLED")
          store.updateSessionStatus(sessionId, "CANCELLED");
        if (
          ["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(
            agentEvent.state ?? "",
          )
        ) {
          void (async () => {
            const data = store.sessionSummaryData(sessionId);
            const baseline = data.baseline;
            let currentStatus = "";
            if (baseline)
              currentStatus = await captureGitBaseline(workspace)
                .then((value) => value.status)
                .catch(() => "");
            const attribution = baseline
              ? attributeFiles(
                  baseline,
                  data.changes
                    .filter((change) =>
                      ["APPLIED", "REVERTED"].includes(change.status),
                    )
                    .map((change) => change.path),
                  currentStatus,
                )
              : { preExisting: [], agent: [], overlapping: [] };
            store.saveTaskSummary(
              sessionId,
              input.prompt,
              agentEvent.state === "COMPLETED"
                ? "COMPLETED"
                : (agentEvent.state ?? "FAILED"),
              JSON.stringify({
                task: input.prompt,
                filesChanged: data.changes,
                tests: data.tests,
                repairs: data.repairs,
                attribution,
              }),
            );
          })();
        }
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
            model: request.model || selectedModel,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          }),
        supportsTools: (m: string) =>
          provider.supportsTools ? provider.supportsTools(m) : true,
        supportsVision: (m: string) =>
          provider.supportsVision ? provider.supportsVision(m) : false,
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
        changeService,
        (changeId) => waitForChangeApproval(sessionId, changeId),
        (run) => {
          const testRunId = store.addTestRun(sessionId, run);
          store.addEvent(sessionId, "TEST_RUN_RECORDED", { testRunId, ...run });
        },
        (attempt) => {
          const id = store.addRepairAttempt(sessionId, {
            ...attempt,
            evidence: attempt.evidence,
            changeIds: [],
            approvalStatus: "NOT_PROPOSED",
            result: attempt.result,
          });
          store.addEvent(sessionId, "REPAIR_ATTEMPT_RECORDED", {
            id,
            ...attempt,
          });
        },
        selectedModel,
      );
      manager.startSession(sessionId, runtime, (signal) =>
        runtime.run(
          `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}${input.prompt}`,
          input.mode,
          signal,
          input.attachedContext ?? [],
        ),
      );
      return { sessionId, model: selectedModel };
    },
  );
  ipcMain.on("agent:stop", (_event, sessionId: string) => {
    if (typeof sessionId === "string") manager.cancelSession(sessionId);
  });
  ipcMain.handle(
    "agent:session-model",
    async (_event, input: { sessionId: string; model: string }) => {
      if (!input || !input.sessionId || !input.model)
        throw new Error("Invalid session model request");
      store.addEvent(input.sessionId, "MODEL_CHANGED", {
        message: `Model switched to ${input.model}`,
        model: input.model,
      });
      return { success: true, model: input.model };
    },
  );
  ipcMain.handle(
    "git:commit",
    async (_event, input: { workspace: string; message: string }) => {
      const { execFile } = require("node:child_process");
      const { promisify } = require("node:util");
      const execFileAsync = promisify(execFile);
      const workspace = validWorkspace(input?.workspace);
      if (!input?.message?.trim()) throw new Error("Commit message required");
      await execFileAsync("git", ["add", "-A"], { cwd: workspace });
      const { stdout } = await execFileAsync(
        "git",
        ["commit", "-m", input.message.trim()],
        { cwd: workspace },
      );
      return { success: true, output: stdout };
    },
  );
  ipcMain.handle(
    "git:generate-commit-msg",
    async (_event, input: { workspace: string; model?: string }) => {
      const { execFile } = require("node:child_process");
      const { promisify } = require("node:util");
      const execFileAsync = promisify(execFile);
      const workspace = validWorkspace(input?.workspace);
      const { stdout: statusOut } = await execFileAsync(
        "git",
        ["status", "--short"],
        { cwd: workspace },
      ).catch(() => ({ stdout: "" }));
      const { stdout: diffOut } = await execFileAsync(
        "git",
        ["diff", "--stat"],
        { cwd: workspace },
      ).catch(() => ({ stdout: "" }));
      if (!statusOut.trim()) return { message: "chore: update codebase" };
      try {
        const { provider, settings } = await configuredProvider();
        const model =
          input?.model ||
          settings.model ||
          globalModelCatalog.getFreeModels()[0]?.id ||
          globalModelCatalog.getModels()[0]?.id ||
          "";
        const prompt = `Based on these Git changes, write a concise, conventional Git commit message (single line header, e.g. "feat: ...", "fix: ...", "refactor: ..."): \nStatus:\n${statusOut.slice(0, 1000)}\nDiff summary:\n${diffOut.slice(0, 1000)}`;
        const chatRes = await provider.chat({
          model,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 50,
        });
        const cleanMsg = chatRes.message.content
          .trim()
          .replace(/^["']|["']$/g, "")
          .split("\n")[0];
        return { message: cleanMsg || "chore: update codebase" };
      } catch {
        return { message: "chore: update codebase" };
      }
    },
  );
  ipcMain.handle(
    "workspace:search",
    async (_event, input: { workspace: string; query: string }) => {
      const { execFile } = require("node:child_process");
      const { promisify } = require("node:util");
      const execFileAsync = promisify(execFile);
      const workspace = validWorkspace(input?.workspace);
      if (!input?.query?.trim()) return [];
      try {
        const { stdout } = await execFileAsync(
          "grep",
          ["-rnI", "-m", "50", input.query, "."],
          {
            cwd: workspace,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        const lines = stdout.trim().split("\n").filter(Boolean);
        return lines.map((l: string) => {
          const parts = l.split(":");
          return {
            file: parts[0]?.replace(/^\.\//, ""),
            line: Number(parts[1]) || 1,
            content: parts.slice(2).join(":").trim(),
          };
        });
      } catch {
        return [];
      }
    },
  );
}
