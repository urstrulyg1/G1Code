/**
 * Headless end-to-end suite (no Electron, no network, no real model).
 *
 * It exercises the real backend process against a real temporary project and a
 * local OpenAI-compatible mock provider:
 *
 *   open workspace -> index -> ranked search -> context assembly
 *   -> agent run proposes a change -> approval -> apply -> file changed
 *   -> targeted verification -> rejection path -> cancellation
 *   -> session history/restore after a server restart
 *
 * Run with: npm run e2e:backend
 */
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const FIXTURE = path.join(PROJECT_ROOT, "tests/fixtures/agent-project");

type Json = Record<string, unknown>;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Minimal OpenAI-compatible provider. The first request emits a `write_file`
 * tool call that fixes the fixture bug; once the tool result comes back it
 * emits a short final answer.
 */
function startMockProvider(port: number) {
  const calls: Array<{ tools: string[]; messages: number }> = [];
  const slowMode = { enabled: false };
  const server = http.createServer((req, res) => {
    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end("{}");
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as {
        messages?: Array<{ role?: string }>;
        tools?: Array<{ function?: { name?: string } }>;
      };
      const messages = parsed.messages ?? [];
      calls.push({
        tools: (parsed.tools ?? []).map((tool) => tool.function?.name ?? "?"),
        messages: messages.length,
      });
      const hasToolResult = messages.some((message) => message.role === "tool");

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      if (slowMode.enabled && !hasToolResult) {
        // Stream slowly without ever calling a tool: used to test cancellation.
        let ticks = 0;
        const timer = setInterval(() => {
          ticks += 1;
          res.write(
            sseChunk({
              choices: [{ index: 0, delta: { content: "thinking… " } }],
            }),
          );
          if (ticks > 40) {
            clearInterval(timer);
            res.write(
              sseChunk({ choices: [{ index: 0, finish_reason: "stop" }] }),
            );
            res.write("data: [DONE]\n\n");
            res.end();
          }
        }, 150);
        req.on("close", () => clearInterval(timer));
        return;
      }

      if (!hasToolResult) {
        res.write(
          sseChunk({
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Fixing the bug." },
              },
            ],
          }),
        );
        res.write(
          sseChunk({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_fix_1",
                      type: "function",
                      function: {
                        name: "write_file",
                        arguments: JSON.stringify({
                          path: "src/calculator.js",
                          content:
                            "export function add(a, b) {\n  return a + b;\n}\n",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
        res.write(
          sseChunk({ choices: [{ index: 0, finish_reason: "tool_calls" }] }),
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      res.write(
        sseChunk({
          choices: [{ index: 0, delta: { content: "Fixed and verified." } }],
        }),
      );
      res.write(sseChunk({ choices: [{ index: 0, finish_reason: "stop" }] }));
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise<{
    close: () => Promise<void>;
    calls: typeof calls;
    slowMode: { enabled: boolean };
  }>((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        calls,
        slowMode,
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}

type Backend = {
  process: ChildProcess;
  port: number;
  dataDir: string;
  get: (pathname: string) => Promise<Json>;
  post: (pathname: string, body?: Json) => Promise<Json>;
  stop: () => Promise<void>;
};

async function startBackend(input: {
  dataDir: string;
  port: number;
}): Promise<Backend> {
  const tsx = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const child = spawn(tsx, ["server.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(input.port),
      G1CODE_DATA_DIR: input.dataDir,
      EXPLABS_API_KEY: "e2e-key",
      G1CODE_APPROVAL_TIMEOUT_MS: "20000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

  const request = async (method: string, pathname: string, body?: Json) => {
    const response = await fetch(`http://127.0.0.1:${input.port}${pathname}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Json) : {};
    return { status: response.status, body: parsed };
  };

  await waitFor(
    async () => {
      const { status } = await request("GET", "/api/health");
      return status === 200;
    },
    "backend health",
    60_000,
  ).catch((error) => {
    throw new Error(
      `${(error as Error).message}\n--- backend logs ---\n${logs.join("")}`,
    );
  });

  return {
    process: child,
    port: input.port,
    dataDir: input.dataDir,
    get: async (pathname) => (await request("GET", pathname)).body,
    post: async (pathname, body) =>
      (await request("POST", pathname, body)).body,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
          resolve();
        }, 5_000);
      }),
  };
}

async function sessionStatus(
  backend: Backend,
  workspace: string,
  sessionId: string,
): Promise<string> {
  const session = (await backend.get(
    `/api/agent/session?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(sessionId)}`,
  )) as { session?: { status?: string }; status?: string };
  return session.session?.status ?? session.status ?? "UNKNOWN";
}

async function run() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "g1code-e2e-data-"));
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-e2e-ws-"));
  await cp(FIXTURE, workspace, { recursive: true });
  await mkdir(path.join(workspace, ".g1code"), { recursive: true });
  // A real project the agent can safely modify, with real git history.
  await execFileAsync("git", ["-C", workspace, "init", "-q"]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "config",
    "user.email",
    "e2e@example.com",
  ]);
  await execFileAsync("git", ["-C", workspace, "config", "user.name", "E2E"]);
  await execFileAsync("git", ["-C", workspace, "add", "-A"]);
  await execFileAsync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
  const providerPort = await freePort();
  const backendPort = await freePort();
  const provider = await startMockProvider(providerPort);
  let backend = await startBackend({ dataDir, port: backendPort });
  const results: string[] = [];
  const step = (name: string) => {
    results.push(name);
    console.log(`  ok  ${name}`);
  };

  try {
    await backend.post("/api/workspace/choose", { path: workspace });
    await backend.post("/api/settings", {
      endpoint: `http://127.0.0.1:${providerPort}/v1`,
      provider: "experiential-labs",
      model: "e2e-mock-model",
      agentMode: "auto",
      executionMode: "auto",
      reviewPolicy: "always",
      maxAgentSteps: 6,
      maxRetries: 2,
    });
    step("workspace opened and provider configured");

    // ---------------------------------------------------------------- index
    const index = (await backend.post("/api/repository/index", {
      workspace,
    })) as { files: number; indexed: number };
    assert.ok(index.files >= 3, "fixture files were indexed");
    assert.equal(index.indexed, index.files);
    step(`repository indexed (${index.files} files)`);

    const status = (await backend.get(
      `/api/repository/status?workspace=${encodeURIComponent(workspace)}`,
    )) as { indexedAt: string | null; fileCount: number };
    assert.ok(status.indexedAt, "index freshness is recorded");
    assert.equal(status.fileCount, index.files);

    const search = (await backend.post("/api/repository/search", {
      workspace,
      query: "add",
      limit: 5,
    })) as { hits: Array<{ path: string; reasons: string[] }> };
    assert.ok(
      search.hits.some((hit) => hit.path === "src/calculator.js"),
      "ranked search finds the calculator module",
    );
    step("indexed, searched and reported repository status");

    // -------------------------------------------------------------- context
    const context = (await backend.post("/api/context/assemble", {
      workspace,
      prompt: "Fix the add() function in the calculator",
      openFile: "src/calculator.js",
    })) as {
      chars: number;
      manifest: { included: Array<{ path?: string }>; budgetChars: number };
    };
    assert.ok(
      context.chars > 0 && context.chars <= context.manifest.budgetChars,
    );
    assert.ok(
      context.manifest.included.some(
        (entry) => entry.path === "src/calculator.js",
      ),
      "the open file is part of the assembled context",
    );
    step("context assembled with a bounded, observable manifest");

    // ------------------------------------------------------- agent + apply
    const start = (await backend.post("/api/agent/start", {
      workspace,
      prompt: "Fix add() so the test passes",
      mode: "agent",
      executionMode: "auto",
      autoContext: true,
    })) as { sessionId: string; contextManifest?: unknown };
    assert.ok(start.sessionId, "agent session started");
    assert.ok(start.contextManifest, "the run returns its context manifest");

    await waitFor(
      async () =>
        ["COMPLETED", "FAILED", "STOPPED", "CANCELLED"].includes(
          await sessionStatus(backend, workspace, start.sessionId),
        ),
      "agent session to finish",
      90_000,
    );
    const finalStatus = await sessionStatus(
      backend,
      workspace,
      start.sessionId,
    );
    assert.equal(finalStatus, "COMPLETED", `agent finished as ${finalStatus}`);

    const fixed = await readFile(
      path.join(workspace, "src/calculator.js"),
      "utf8",
    );
    assert.match(fixed, /return a \+ b;/, "the proposed change was applied");
    step("agent proposed a change, approval applied it, file changed on disk");

    const changes = (await backend.get(
      `/api/agent/changes?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(start.sessionId)}&includeResolved=1`,
    )) as
      | { changes?: Array<{ status: string; path: string }> }
      | Array<{ status: string }>;
    const changeList = Array.isArray(changes)
      ? changes
      : (changes.changes ?? []);
    assert.ok(
      changeList.some((change) => change.status === "APPLIED"),
      "the applied change is recorded",
    );
    step("change history records the applied change");

    // --------------------------------------------------------- verification
    const verification = (await backend.post("/api/verification/run", {
      workspace,
      sessionId: start.sessionId,
      level: "targeted",
      paths: ["src/calculator.js"],
    })) as { status: string; steps: Array<{ name: string; status: string }> };
    assert.ok(
      ["PASSED", "FAILED", "SKIPPED"].includes(verification.status),
      `verification produced a status (${verification.status})`,
    );
    const listed = (await backend.get(
      `/api/verification/list?workspace=${encodeURIComponent(workspace)}`,
    )) as { runs: Array<{ id: string }> };
    assert.ok(listed.runs.length >= 1, "verification runs are persisted");
    step(`verification ran and persisted (${verification.status})`);

    // -------------------------------------------------------- diagnostics
    const diagnostics = (await backend.get(
      `/api/diagnostics?workspace=${encodeURIComponent(workspace)}`,
    )) as {
      indexing: { fileCount: number };
      sessions: Array<{ id: string }>;
      provider: { apiKeyMasked: string };
    };
    assert.equal(diagnostics.indexing.fileCount, index.files);
    assert.ok(
      diagnostics.sessions.some((entry) => entry.id === start.sessionId),
    );
    assert.ok(
      !JSON.stringify(diagnostics).includes("e2e-key"),
      "diagnostics never expose the provider credential",
    );
    step("diagnostics expose runtime state without secrets");

    // ------------------------------------------------- session management
    await backend.post("/api/agent/session-update", {
      workspace,
      sessionId: start.sessionId,
      action: "rename",
      title: "E2E fixed calculator",
    });
    await backend.post("/api/agent/session-update", {
      workspace,
      sessionId: start.sessionId,
      action: "archive",
    });
    const history = (await backend.get(
      `/api/agent/sessions?workspace=${encodeURIComponent(workspace)}&includeArchived=1`,
    )) as
      | Array<{ id: string; title: string; archived: boolean }>
      | { sessions?: Array<{ id: string; title: string; archived: boolean }> };
    const sessions = Array.isArray(history)
      ? history
      : (history.sessions ?? []);
    const renamed = sessions.find((entry) => entry.id === start.sessionId);
    assert.equal(renamed?.title, "E2E fixed calculator", "session renamed");
    step("session renamed, archived and listed with history metadata");

    // -------------------------------------------------- rejection workflow
    await backend.post("/api/settings", { reviewPolicy: "ask" });
    provider.calls.length = 0;
    const rejectRun = (await backend.post("/api/agent/start", {
      workspace,
      prompt: "Change add() again",
      mode: "agent",
      executionMode: "auto",
      autoContext: false,
    })) as { sessionId: string };
    await waitFor(async () => {
      const pending = (await backend.get(
        `/api/agent/changes?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(rejectRun.sessionId)}`,
      )) as
        | { changes?: Array<{ id: string; status: string }> }
        | Array<{ id: string; status: string }>;
      const list = Array.isArray(pending) ? pending : (pending.changes ?? []);
      return list.some((change) => change.status === "PENDING");
    }, "a pending change to approve");
    const pendingList = (await backend.get(
      `/api/agent/changes?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(rejectRun.sessionId)}`,
    )) as
      | { changes?: Array<{ id: string; status: string }> }
      | Array<{ id: string; status: string }>;
    const pendingChange = (
      Array.isArray(pendingList) ? pendingList : (pendingList.changes ?? [])
    ).find((change) => change.status === "PENDING");
    assert.ok(pendingChange, "pending change exists");
    await backend.post("/api/agent/change", {
      workspace,
      sessionId: rejectRun.sessionId,
      id: pendingChange?.id,
      action: "reject",
    });
    await waitFor(
      async () =>
        ["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(
          await sessionStatus(backend, workspace, rejectRun.sessionId),
        ),
      "rejected run to finish",
      60_000,
    );
    const stillFixed = await readFile(
      path.join(workspace, "src/calculator.js"),
      "utf8",
    );
    assert.match(
      stillFixed,
      /return a \+ b;/,
      "rejection left the file untouched",
    );
    const rejected = (await backend.get(
      `/api/agent/changes?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(rejectRun.sessionId)}&includeResolved=1`,
    )) as { changes?: Array<{ status: string }> } | Array<{ status: string }>;
    const rejectedList = Array.isArray(rejected)
      ? rejected
      : (rejected.changes ?? []);
    assert.ok(
      rejectedList.some((change) => change.status === "REJECTED"),
      "the rejected change is recorded as REJECTED",
    );
    step("change rejection leaves the workspace untouched and is audited");

    // ------------------------------------------------------------ cancel
    provider.slowMode.enabled = true;
    const cancelRun = (await backend.post("/api/agent/start", {
      workspace,
      prompt: "Keep thinking forever",
      mode: "agent",
      executionMode: "auto",
      autoContext: false,
    })) as { sessionId: string };
    await waitFor(
      async () =>
        (await sessionStatus(backend, workspace, cancelRun.sessionId)) ===
        "RUNNING",
      "the slow run to start",
      30_000,
    );
    await backend.post("/api/agent/stop", { sessionId: cancelRun.sessionId });
    await waitFor(
      async () =>
        ["CANCELLED", "STOPPED", "FAILED"].includes(
          await sessionStatus(backend, workspace, cancelRun.sessionId),
        ),
      "the cancelled run to stop",
      30_000,
    );
    provider.slowMode.enabled = false;
    step("cancellation terminates a streaming run");

    // ----------------------------------------------------------- restart
    const eventsBefore = (await backend.get(
      `/api/agent/events-history?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(start.sessionId)}`,
    )) as unknown[];
    assert.ok(
      Array.isArray(eventsBefore) && eventsBefore.length > 0,
      "events are readable before the restart",
    );
    await backend.stop();
    backend = await startBackend({ dataDir, port: backendPort });
    await backend.post("/api/workspace/choose", { path: workspace });
    const restored = await sessionStatus(backend, workspace, start.sessionId);
    assert.notEqual(
      restored,
      "RUNNING",
      "restart never auto-resumes a session",
    );
    const eventsAfter = (await backend.get(
      `/api/agent/events-history?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(start.sessionId)}`,
    )) as unknown[];
    assert.equal(
      eventsAfter.length,
      eventsBefore.length,
      "persisted events survive a restart",
    );
    step("restart restores history without resuming execution");

    // ------------------------------------------------------------ git
    const historyCommits = (await backend.get(
      `/api/git/file-history?workspace=${encodeURIComponent(workspace)}&path=src/calculator.js`,
    )) as { isRepo: boolean; commits: Array<{ hash: string }> };
    assert.equal(historyCommits.isRepo, true);
    assert.ok(
      historyCommits.commits.length >= 1,
      "git file history returns the fixture commit",
    );
    const blame = (await backend.get(
      `/api/git/blame?workspace=${encodeURIComponent(workspace)}&path=src/calculator.js&startLine=1&endLine=2`,
    )) as { isRepo: boolean; lines: Array<{ hash: string }> };
    assert.equal(blame.isRepo, true);
    assert.ok(blame.lines.length >= 1, "git blame returns line attribution");
    step("git blame and file history return real attribution");

    console.log(`\n=== BACKEND E2E PASSED (${results.length} stages) ===`);
    for (const name of results) console.log(`  - ${name}`);
  } finally {
    await backend.stop().catch(() => undefined);
    await provider.close().catch(() => undefined);
    await rm(workspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("\n=== BACKEND E2E FAILED ===");
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
