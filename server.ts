import http from "node:http";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { openDatabase } from "./packages/database/connection";
import { DatabaseStore } from "./packages/database/repositories";
import { AgentRuntimeManager } from "./packages/agent/manager";
import { ChangeService } from "./packages/tools/change-service";
import { RepositoryIndexService } from "./packages/indexing/service";
import { captureGitBaseline, attributeFiles } from "./packages/git/baseline";
import { safeRealPath, workspaceTools } from "./packages/tools/workspace";
import { gitTools } from "./packages/tools/git";
import { testingTools } from "./packages/testing/tool";
import { ToolRegistry } from "./packages/tools/types";
import {
  AgentRuntime,
  type AgentEvent,
  type ChangeApprovalResult,
} from "./packages/agent/runtime";
import {
  readSettings,
  saveSettings,
  configuredProvider,
  type Settings,
} from "./packages/settings/storage";
import { ModelCatalog } from "./packages/ai/models";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT) || 3131;

let selectedWorkspace: string = process.cwd();
const store = new DatabaseStore(openDatabase());
store.markRunningSessionsInterrupted();
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

const permissionWaiters = new Map<
  string,
  {
    resolve: (allowed: boolean) => void;
  }
>();

const activeToolCalls = new Map<string, string>();
const sseClients = new Set<http.ServerResponse>();

function broadcastSSE(data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

async function parseJsonBody<T = unknown>(
  req: http.IncomingMessage,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000_000) {
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({} as T);
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validWorkspace(input?: unknown): string {
  if (typeof input === "string" && input.trim()) {
    return path.resolve(input.trim());
  }
  return selectedWorkspace;
}

// A single strict workspace authority for file/index/change operations. The
// server is the only privileged boundary; the renderer passes the selected
// workspace, and every handler must agree before touching the filesystem.
function checkedWorkspace(inputWorkspace: string | undefined): string {
  const candidate = validWorkspace(inputWorkspace);
  if (path.resolve(candidate) !== path.resolve(selectedWorkspace)) {
    throw new Error("Workspace mismatch; refusing cross-workspace access");
  }
  return candidate;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = url.pathname;

  try {
    // Health check
    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        status: "ok",
        port: PORT,
        workspace: selectedWorkspace,
        uptime: process.uptime(),
      });
    }

    // Server-Sent Events stream
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": keepalive\n\n");
      sseClients.add(res);

      const keepaliveTimer = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {
          clearInterval(keepaliveTimer);
          sseClients.delete(res);
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(keepaliveTimer);
        sseClients.delete(res);
      });
      return;
    }

    // Workspace choose
    if (pathname === "/api/workspace/choose" && req.method === "POST") {
      const body = await parseJsonBody<{ path?: string }>(req);
      if (body.path && typeof body.path === "string" && body.path.trim()) {
        selectedWorkspace = path.resolve(body.path.trim());
      } else {
        selectedWorkspace = process.cwd();
      }
      return sendJson(res, 200, { workspace: selectedWorkspace });
    }

    // Workspace list entries
    if (
      (pathname === "/api/workspace/list" && req.method === "POST") ||
      (pathname === "/api/workspace/list" && req.method === "GET")
    ) {
      const directoryParam =
        req.method === "POST"
          ? (await parseJsonBody<{ directory?: string }>(req)).directory
          : url.searchParams.get("directory") || selectedWorkspace;

      const targetDir = directoryParam || selectedWorkspace;
      const relDir = path.isAbsolute(targetDir)
        ? path.relative(selectedWorkspace, targetDir)
        : targetDir;
      const safeDir = await safeRealPath(selectedWorkspace, relDir);
      const entries = await fs.readdir(safeDir, { withFileTypes: true });

      const mapped = entries
        .filter(
          (entry) => !entry.name.startsWith(".") || entry.name === ".g1code",
        )
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory()
            ? ("directory" as const)
            : ("file" as const),
        }))
        .sort(
          (a, b) =>
            Number(b.kind === "directory") - Number(a.kind === "directory") ||
            a.name.localeCompare(b.name),
        );

      return sendJson(res, 200, mapped);
    }

    // File read
    if (pathname === "/api/file/read" && req.method === "POST") {
      const body = await parseJsonBody<{ filePath: string }>(req);
      if (!body.filePath || typeof body.filePath !== "string") {
        return sendError(res, 400, "filePath required");
      }
      const relPath = path.isAbsolute(body.filePath)
        ? path.relative(selectedWorkspace, body.filePath)
        : body.filePath;
      const safePath = await safeRealPath(selectedWorkspace, relPath);
      const content = await fs.readFile(safePath, "utf8");
      return sendJson(res, 200, { content });
    }

    // File write
    if (pathname === "/api/file/write" && req.method === "POST") {
      const body = await parseJsonBody<{ filePath: string; contents: string }>(
        req,
      );
      if (!body.filePath || typeof body.contents !== "string") {
        return sendError(res, 400, "filePath and contents required");
      }
      const relPath = path.isAbsolute(body.filePath)
        ? path.relative(selectedWorkspace, body.filePath)
        : body.filePath;
      const safePath = await safeRealPath(selectedWorkspace, relPath);
      await fs.writeFile(safePath, body.contents, "utf8");
      return sendJson(res, 200, { success: true });
    }

    // Terminal run
    if (pathname === "/api/terminal/run" && req.method === "POST") {
      const body = await parseJsonBody<{ command: string; cwd?: string }>(req);
      if (!body.command || typeof body.command !== "string") {
        return sendError(res, 400, "command required");
      }
      const cwdTarget = body.cwd ? body.cwd : selectedWorkspace;
      const relCwd = path.isAbsolute(cwdTarget)
        ? path.relative(selectedWorkspace, cwdTarget)
        : cwdTarget;
      const safeCwd = await safeRealPath(selectedWorkspace, relCwd);

      try {
        const result = await execFileAsync(
          process.platform === "win32" ? "cmd.exe" : "sh",
          process.platform === "win32"
            ? ["/d", "/s", "/c", body.command]
            : ["-lc", body.command],
          { cwd: safeCwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
        );
        return sendJson(res, 200, {
          output: `${result.stdout}${result.stderr}`,
          exitCode: 0,
        });
      } catch (error) {
        const failure = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
        };
        return sendJson(res, 200, {
          output: `${failure.stdout ?? ""}${failure.stderr ?? String(error)}`,
          exitCode: failure.code ?? 1,
        });
      }
    }

    // Settings
    if (pathname === "/api/settings" && req.method === "GET") {
      const settings = await readSettings();
      return sendJson(res, 200, settings);
    }

    if (pathname === "/api/settings" && req.method === "POST") {
      const body = await parseJsonBody<Partial<Settings> & { apiKey?: string }>(
        req,
      );
      const updated = await saveSettings(body);
      return sendJson(res, 200, updated);
    }

    // Provider models (all or free)
    // Provider models (all or free)
    if (pathname === "/api/provider/models/free" && req.method === "GET") {
      const providerParam = url.searchParams.get("provider") || undefined;
      try {
        const { provider } = await configuredProvider(undefined, providerParam);
        if ("getFreeModels" in provider && typeof (provider as any).getFreeModels === "function") {
          const freeModels = await (provider as any).getFreeModels();
          return sendJson(res, 200, freeModels);
        }
        const models = await provider.getModels();
        const freeModels = models.filter((m) => m.isPromotional);
        return sendJson(res, 200, freeModels);
      } catch {
        const catalog = new ModelCatalog();
        return sendJson(res, 200, catalog.getFreeModels(providerParam));
      }
    }

    if (pathname === "/api/provider/models" && req.method === "GET") {
      const providerParam = url.searchParams.get("provider") || undefined;
      const isFreeOnly = url.searchParams.get("free") === "true";
      try {
        const { provider } = await configuredProvider(undefined, providerParam);
        if (isFreeOnly) {
          if ("getFreeModels" in provider && typeof (provider as any).getFreeModels === "function") {
            const freeModels = await (provider as any).getFreeModels();
            return sendJson(res, 200, freeModels);
          }
        }
        const models = await provider.getModels();
        if (isFreeOnly) {
          return sendJson(res, 200, models.filter((m) => m.isPromotional));
        }
        return sendJson(res, 200, models);
      } catch {
        const catalog = new ModelCatalog();
        const models = isFreeOnly
          ? catalog.getFreeModels(providerParam)
          : catalog.getModels(providerParam);
        return sendJson(res, 200, models);
      }
    }

    // Provider verify connection
    if (pathname === "/api/provider/verify" && req.method === "POST") {
      try {
        const body = await parseJsonBody<{ provider?: string }>(req).catch(() => ({} as any));
        const { provider } = await configuredProvider(undefined, body?.provider);
        if (provider.verifyConnection) {
          const result = await provider.verifyConnection();
          return sendJson(res, 200, result);
        }
        const models = await provider.getModels();
        return sendJson(res, 200, {
          connected: true,
          modelCount: models.length,
          message: `Connected successfully. ${models.length} models available.`,
        });
      } catch (err) {
        return sendJson(res, 400, {
          connected: false,
          modelCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Provider test model
    if (pathname === "/api/provider/test" && req.method === "POST") {
      try {
        const body = await parseJsonBody<{ model?: string; provider?: string }>(req);
        const { provider, settings } = await configuredProvider(undefined, body.provider);
        const targetModel = body.model || settings.model || "gpt-6-astra";

        if (provider.testModel) {
          const result = await provider.testModel(targetModel);
          return sendJson(res, 200, {
            connected: true,
            model: targetModel,
            ...result,
          });
        }

        const startTime = Date.now();
        const chatRes = await provider.chat({
          model: targetModel,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          maxTokens: 10,
        });
        const latency = Date.now() - startTime;
        return sendJson(res, 200, {
          connected: true,
          model: targetModel,
          working: true,
          latencyMs: latency,
          ttftMs: latency,
          output: chatRes.message.content.trim(),
        });
      } catch (err) {
        return sendJson(res, 400, {
          connected: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Provider refresh catalog
    if (pathname === "/api/provider/refresh" && req.method === "POST") {
      try {
        const body = await parseJsonBody<{ provider?: string }>(req).catch(() => ({} as any));
        const { provider } = await configuredProvider(undefined, body?.provider);
        const models = await provider.getModels();
        return sendJson(res, 200, {
          success: true,
          models,
          count: models.length,
        });
      } catch {
        const catalog = new ModelCatalog();
        const models = catalog.getModels(body?.provider);
        return sendJson(res, 200, {
          success: true,
          models,
          count: models.length,
        });
      }
    }

    // Sessions list
    if (pathname === "/api/agent/sessions" && req.method === "GET") {
      const workspace = validWorkspace(url.searchParams.get("workspace"));
      const sessions = store.recentSessions(workspace);
      return sendJson(res, 200, sessions);
    }

    // Session details
    if (pathname === "/api/agent/session" && req.method === "GET") {
      const workspace = validWorkspace(url.searchParams.get("workspace"));
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) return sendError(res, 400, "sessionId required");
      const session = store
        .recentSessions(workspace, 100)
        .find((s) => s.id === sessionId);
      if (!session) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, {
        session,
        messages: store.sessionMessages(session.id),
        events: store.sessionEvents(session.id),
        changes: store.pendingChanges(session.id),
        testRuns: store.sessionTestRuns(session.id),
        repairs: store.sessionRepairHistory(session.id),
        summary: store.taskSummary(session.id),
        checkpoint: store.checkpoint(session.id),
      });
    }

    // Session events
    if (pathname === "/api/agent/events-history" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) return sendError(res, 400, "sessionId required");
      return sendJson(res, 200, store.sessionEvents(sessionId));
    }

    // Pending changes
    if (pathname === "/api/agent/changes" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || undefined;
      return sendJson(res, 200, store.pendingChanges(sessionId));
    }

    // Change action (approve, reject, apply, revert)
    if (pathname === "/api/agent/change" && req.method === "POST") {
      const body = await parseJsonBody<{
        action: "approve" | "reject" | "apply" | "revert";
        id: string;
        sessionId: string;
        workspace?: string;
      }>(req);

      const workspace = validWorkspace(body.workspace);
      const service = new ChangeService(store, workspace);
      const change = service.authorizeChange(body.id, body.sessionId);

      if (body.action === "approve") {
        const waiter = approvalWaiters.get(body.id);
        if (waiter) {
          service.approveChange(body.id);
          const applied = await service.applyChange(body.id);
          const status =
            applied.status === "APPLIED" || applied.status === "CONFLICT"
              ? applied.status
              : "REJECTED";
          const message =
            status === "APPLIED"
              ? "Change applied successfully."
              : "Change conflicted.";
          store.addEvent(waiter.sessionId, `CHANGE_${status}`, {
            changeId: body.id,
            status,
            message,
          });
          broadcastSSE({
            type: "approval",
            sessionId: waiter.sessionId,
            changeId: body.id,
            message,
            result: { status },
          });
          approvalWaiters.delete(body.id);
          waiter.resolve({ approved: status === "APPLIED", status, message });
          return sendJson(res, 200, applied);
        } else {
          service.approveChange(body.id);
          const applied = await service.applyChange(body.id);
          store.addEvent(
            change.sessionId,
            applied.status === "APPLIED" ? "CHANGE_APPLIED" : "CHANGE_CONFLICT",
            {
              changeId: body.id,
              status: applied.status,
            },
          );
          return sendJson(res, 200, applied);
        }
      }

      if (body.action === "reject") {
        const waiter = approvalWaiters.get(body.id);
        if (waiter) {
          const rejected = service.rejectChange(body.id);
          store.addEvent(waiter.sessionId, "CHANGE_REJECTED", {
            changeId: body.id,
            status: "REJECTED",
          });
          broadcastSSE({
            type: "approval",
            sessionId: waiter.sessionId,
            changeId: body.id,
            message: "Change rejected.",
            result: { status: "REJECTED" },
          });
          approvalWaiters.delete(body.id);
          waiter.resolve({
            approved: false,
            status: "REJECTED",
            message: "Change rejected by user.",
          });
          return sendJson(res, 200, rejected);
        } else {
          return sendJson(res, 200, service.rejectChange(body.id));
        }
      }

      if (body.action === "apply") {
        return sendJson(res, 200, await service.applyChange(body.id));
      }

      if (body.action === "revert") {
        return sendJson(res, 200, await service.revertChange(body.id));
      }

      return sendError(res, 400, "Unknown action");
    }

    // Approve all changes
    if (pathname === "/api/agent/approve-all" && req.method === "POST") {
      const body = await parseJsonBody<{
        workspace?: string;
        sessionId: string;
      }>(req);
      const workspace = validWorkspace(body.workspace);
      const changes = store.pendingChanges(body.sessionId);
      const service = new ChangeService(store, workspace);

      for (const change of changes) {
        if (change.status === "PENDING") service.approveChange(change.id);
      }
      const result = await service.applyBatch(
        body.sessionId,
        changes.map((c) => c.id),
      );
      for (const change of changes) {
        const waiter = approvalWaiters.get(change.id);
        if (waiter) {
          approvalWaiters.delete(change.id);
          waiter.resolve({
            approved: true,
            status: "APPLIED",
            message: "Batch applied.",
          });
        }
      }
      store.addEvent(body.sessionId, "CHANGE_BATCH_APPLIED", {
        batchId: result.batch?.id,
        changeIds: changes.map((c) => c.id),
      });
      return sendJson(res, 200, result);
    }

    // Reject all changes
    if (pathname === "/api/agent/reject-all" && req.method === "POST") {
      const body = await parseJsonBody<{
        workspace?: string;
        sessionId: string;
      }>(req);
      const workspace = validWorkspace(body.workspace);
      const service = new ChangeService(store, workspace);
      const rejected = store.pendingChanges(body.sessionId).map((change) => {
        const waiter = approvalWaiters.get(change.id);
        if (waiter) {
          approvalWaiters.delete(change.id);
          waiter.resolve({
            approved: false,
            status: "REJECTED",
            message: "Rejected by user.",
          });
        }
        return service.rejectChange(change.id);
      });
      return sendJson(res, 200, rejected);
    }

    // Discard session
    if (pathname === "/api/agent/discard" && req.method === "POST") {
      const body = await parseJsonBody<{
        workspace?: string;
        sessionId: string;
      }>(req);
      const workspace = validWorkspace(body.workspace);
      const service = new ChangeService(store, workspace);
      for (const change of store.pendingChanges(body.sessionId)) {
        if (approvalWaiters.has(change.id)) {
          approvalWaiters
            .get(change.id)
            ?.resolve({
              approved: false,
              status: "REJECTED",
              message: "Session discarded.",
            });
          approvalWaiters.delete(change.id);
        }
        service.rejectChange(change.id);
      }
      manager.cancelSession(body.sessionId);
      store.updateSessionStatus(body.sessionId, "STOPPED");
      store.addEvent(body.sessionId, "SESSION_DISCARDED", {
        message: "Session discarded by user.",
      });
      return sendJson(res, 200, { status: "STOPPED" });
    }

    // Permission response
    if (pathname === "/api/agent/permission" && req.method === "POST") {
      const body = await parseJsonBody<{ requestId: string; allowed: boolean }>(
        req,
      );
      const waiter = permissionWaiters.get(body.requestId);
      if (waiter) {
        permissionWaiters.delete(body.requestId);
        waiter.resolve(body.allowed === true);
        return sendJson(res, 200, { success: true });
      }
      return sendError(res, 404, "Permission request not found");
    }

    // Rebuild index
    if (pathname === "/api/index/rebuild" && req.method === "POST") {
      const body = await parseJsonBody<{ workspace?: string }>(req);
      const workspace = validWorkspace(body.workspace);
      const entries = await indexService.index(workspace);
      return sendJson(res, 200, { files: entries.length });
    }

    // Search symbols
    if (pathname === "/api/index/search" && req.method === "POST") {
      const body = await parseJsonBody<{ workspace?: string; query: string }>(
        req,
      );
      const workspace = validWorkspace(body.workspace);
      return sendJson(
        res,
        200,
        store.searchSymbols(workspace, body.query || ""),
      );
    }

    // Start agent
    if (pathname === "/api/agent/start" && req.method === "POST") {
      const body = await parseJsonBody<{
        workspace?: string;
        prompt: string;
        mode: "ask" | "plan" | "agent";
        model?: string;
      }>(req);

      if (!body.prompt || !["ask", "plan", "agent"].includes(body.mode)) {
        return sendError(res, 400, "Invalid agent request");
      }

      const { provider, settings } = await configuredProvider();
      const selectedModel = body.model || settings.model || "gpt-6-astra";

      const workspace = validWorkspace(body.workspace);
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
        title: body.prompt.slice(0, 80),
        mode: body.mode,
        model: selectedModel,
        provider: settings.provider,
        status: "RUNNING",
      });

      const baseline = await captureGitBaseline(workspace).catch(() => null);
      if (baseline) store.saveGitBaseline(sessionId, baseline);
      store.addMessage(sessionId, "user", body.prompt);

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
            if (recordId) {
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
            }
            activeToolCalls.delete(key);
          }
        }
        if (agentEvent.type === "text" || agentEvent.type === "done") {
          store.addMessage(sessionId, "assistant", agentEvent.message ?? "");
        }
        if (agentEvent.state === "WAITING_FOR_CHANGE_APPROVAL") {
          store.updateSessionStatus(sessionId, "WAITING_FOR_APPROVAL");
        }
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
            const base = data.baseline;
            let currentStatus = "";
            if (base)
              currentStatus = await captureGitBaseline(workspace)
                .then((v) => v.status)
                .catch(() => "");
            const attribution = base
              ? attributeFiles(
                  base,
                  data.changes
                    .filter((c) => ["APPLIED", "REVERTED"].includes(c.status))
                    .map((c) => c.path),
                  currentStatus,
                )
              : { preExisting: [], agent: [], overlapping: [] };
            store.saveTaskSummary(
              sessionId,
              body.prompt,
              agentEvent.state === "COMPLETED"
                ? "COMPLETED"
                : (agentEvent.state ?? "FAILED"),
              JSON.stringify({
                task: body.prompt,
                filesChanged: data.changes,
                tests: data.tests,
                repairs: data.repairs,
                attribution,
              }),
            );
          })();
        }

        broadcastSSE({ ...agentEvent, sessionId });
      };

      const agentProvider = {
        getModels: provider.getModels.bind(provider),
        chat: provider.chat.bind(provider),
        streamChat: (reqChat: Parameters<typeof provider.streamChat>[0]) =>
          provider.streamChat({
            ...reqChat,
            model: reqChat.model || selectedModel,
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
          const key = `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          return new Promise<boolean>((resolve) => {
            permissionWaiters.set(key, { resolve });
            broadcastSSE({
              type: "permission:request",
              requestId: key,
              tool: tool.name,
              input: value,
              sessionId,
            });
          });
        },
        undefined,
        sessionId,
        changeService,
        (changeId) =>
          new Promise<ChangeApprovalResult>((resolve) => {
            approvalWaiters.set(changeId, { sessionId, resolve });
          }),
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
          `${instructions ? `Project instructions:\n${instructions}\n\n` : ""}${body.prompt}`,
          body.mode,
          signal,
        ),
      );

      return sendJson(res, 200, { sessionId });
    }

    // Stop agent
    if (pathname === "/api/agent/stop" && req.method === "POST") {
      const body = await parseJsonBody<{ sessionId: string }>(req);
      if (body.sessionId) manager.cancelSession(body.sessionId);
      return sendJson(res, 200, { success: true });
    }

    // Switch model for existing session
    if (pathname === "/api/agent/session-model" && req.method === "POST") {
      const body = await parseJsonBody<{ sessionId: string; model: string }>(
        req,
      );
      if (!body.sessionId || !body.model) {
        return sendError(res, 400, "sessionId and model are required");
      }
      try {
        store.addEvent(body.sessionId, "MODEL_CHANGED", {
          message: `Model switched to ${body.model}`,
          model: body.model,
        });
        return sendJson(res, 200, { success: true, model: body.model });
      } catch (err) {
        return sendError(res, 500, String(err));
      }
    }

    // Git Commit
    if (pathname === "/api/git/commit" && req.method === "POST") {
      const body = await parseJsonBody<{ workspace?: string; message: string }>(
        req,
      );
      const workspace = validWorkspace(body.workspace);
      if (!body.message || !body.message.trim()) {
        return sendError(res, 400, "Commit message cannot be empty");
      }
      try {
        await execFileAsync("git", ["add", "-A"], { cwd: workspace });
        const { stdout } = await execFileAsync(
          "git",
          ["commit", "-m", body.message.trim()],
          { cwd: workspace },
        );
        return sendJson(res, 200, { success: true, output: stdout });
      } catch (err) {
        const failure = err as {
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        return sendError(
          res,
          400,
          failure.stderr ||
            failure.stdout ||
            failure.message ||
            "Git commit failed",
        );
      }
    }

    // Git AI Generate Commit Message
    if (pathname === "/api/git/generate-commit-msg" && req.method === "POST") {
      const body = await parseJsonBody<{ workspace?: string; model?: string }>(
        req,
      );
      const workspace = validWorkspace(body.workspace);
      try {
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

        if (!statusOut.trim()) {
          return sendJson(res, 200, { message: "chore: update project files" });
        }

        const { provider, settings } = await configuredProvider();
        const model = body.model || settings.model || "gpt-6-astra";
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
        return sendJson(res, 200, {
          message: cleanMsg || "chore: update codebase",
        });
      } catch {
        return sendJson(res, 200, { message: "chore: update codebase" });
      }
    }

    // Workspace Full-Text Search
    if (pathname === "/api/workspace/search" && req.method === "GET") {
      const workspace = validWorkspace(url.searchParams.get("workspace"));
      const query = url.searchParams.get("query") || "";
      if (!query.trim()) return sendJson(res, 200, []);

      try {
        const { stdout } = await execFileAsync(
          "grep",
          ["-rnI", "-m", "50", query, "."],
          {
            cwd: workspace,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = lines.map((l) => {
          const parts = l.split(":");
          return {
            file: parts[0]?.replace(/^\.\//, ""),
            line: Number(parts[1]) || 1,
            content: parts.slice(2).join(":").trim(),
          };
        });
        return sendJson(res, 200, results);
      } catch {
        return sendJson(res, 200, []);
      }
    }

    // Git Status & History
    if (pathname === "/api/git/status" && req.method === "GET") {
      const workspace = validWorkspace(url.searchParams.get("workspace"));
      const baseline = await captureGitBaseline(workspace).catch(() => null);
      let logOutput = "";
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["log", "-n", "10", "--oneline"],
          { cwd: workspace },
        );
        logOutput = stdout;
      } catch {
        // Not a git repo or no commits
      }
      return sendJson(res, 200, {
        branch: baseline?.branch ?? "unknown",
        head: baseline?.head ?? "unknown",
        status: baseline?.status ?? "",
        diff: baseline?.diff ?? "",
        modifiedFiles: baseline?.modifiedFiles ?? [],
        recentCommits: logOutput ? logOutput.trim().split("\n") : [],
      });
    }

    // Problems / Diagnostics Aggregator
    if (pathname === "/api/problems" && req.method === "GET") {
      const workspace = validWorkspace(url.searchParams.get("workspace"));
      // Collect problems from recent test failures, git conflicts, and agent events
      const recentSessions = store.recentSessions(workspace, 5);
      const problems: Array<{
        id: string;
        source: "test" | "conflict" | "agent" | "security";
        severity: "error" | "warning" | "info";
        message: string;
        file?: string;
        line?: number;
      }> = [];

      for (const s of recentSessions) {
        const testRuns = store.sessionTestRuns(s.id);
        for (const tr of testRuns) {
          if (
            tr.passed === 0 ||
            (tr.exitCode !== undefined && tr.exitCode !== 0)
          ) {
            problems.push({
              id: `test-${tr.id}`,
              source: "test",
              severity: "error",
              message: `Test command failed: "${tr.command}" (exit code ${tr.exitCode})`,
            });
          }
        }
        const changes = store.pendingChanges(s.id);
        for (const c of changes) {
          if (c.status === "CONFLICT") {
            problems.push({
              id: `conflict-${c.id}`,
              source: "conflict",
              severity: "error",
              message: `Conflict detected on file: ${c.path}`,
              file: c.path,
            });
          }
        }
      }

      return sendJson(res, 200, { problems, count: problems.length });
    }

    sendError(res, 404, `Route not found: ${pathname}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 500, message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[G1Code Backend] Server listening at http://127.0.0.1:${PORT}`);
  console.log(`[G1Code Backend] Active workspace: ${selectedWorkspace}`);
});

export { server };
