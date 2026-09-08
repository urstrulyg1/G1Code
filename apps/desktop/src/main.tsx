import "./api-client";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command,
  Edit3,
  Eye,
  FileCode,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import "./styles.css";

type Entry = { name: string; kind: "file" | "directory" };
type Tab = { path: string; content: string; dirty: boolean };
type Event = {
  type: string;
  state?: string;
  message?: string;
  toolName?: string;
};
type Change = {
  id: string;
  path: string;
  patch: string;
  status: string;
};
type TestRun = { id: string; command: string; exitCode?: number; passed?: number; duration: number };
type Repair = { id: string; attemptNumber: number; diagnosis: string; result: string };
type SettingsType = {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyConfigured: boolean;
};
type Problem = {
  id: string;
  source: "test" | "conflict" | "agent" | "security";
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
};
type GitStatus = {
  branch: string;
  head: string;
  status: string;
  diff: string;
  modifiedFiles: string[];
  recentCommits: string[];
};
type PlanStep = {
  id: string;
  title: string;
  completed: boolean;
};

function App() {
  const [workspace, setWorkspace] = useState("No workspace open");
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const current = tabs.find((tab) => tab.path === active);
  const [terminal, setTerminal] = useState("");
  const [command, setCommand] = useState("");
  const [panel, setPanel] = useState<"terminal" | "activity" | "tests" | "problems" | "git">("terminal");
  const [palette, setPalette] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settings, setSettings] = useState<SettingsType>({
    provider: "experimental-labs",
    endpoint: "https://api.openai.com/v1",
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  });
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"ask" | "plan" | "agent" | "review" | "debug" | "refactor">("ask");
  const [events, setEvents] = useState<Event[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<
    Array<{ id: string; title: string; mode: string; status: string }>
  >([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [showChanges, setShowChanges] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("unified");
  const [repairHistory, setRepairHistory] = useState<Array<{ attemptNumber: number; diagnosis: string; result: string }>>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [summary, setSummary] = useState<{ task: string; status: string; summary: string } | null>(null);
  const [interruptedSession, setInterruptedSession] = useState<{ id: string; title: string } | null>(null);
  const [permission, setPermission] = useState<{
    requestId: string;
    tool: string;
    input: unknown;
  } | null>(null);

  // Advanced features state
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([
    { id: "s1", title: "Analyze current codebase structure and identify target modules", completed: false },
    { id: "s2", title: "Implement required functionality preserving existing tests", completed: false },
    { id: "s3", title: "Run unit test suite and verify clean execution", completed: false },
  ]);
  const [newStepText, setNewStepText] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    branch: "main",
    head: "",
    status: "",
    diff: "",
    modifiedFiles: [],
    recentCommits: [],
  });

  const loadGitAndProblems = async (wsPath: string) => {
    try {
      if ((window.g1code as any).getGitStatus) {
        const gitData = await (window.g1code as any).getGitStatus(wsPath);
        setGitStatus(gitData);
      }
      if ((window.g1code as any).getProblems) {
        const probData = await (window.g1code as any).getProblems(wsPath);
        setProblems(probData.problems || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void window.g1code.getSettings().then(setSettings);
    const offEvent = window.g1code.onAgentEvent((value) => {
      const event = value as Event;
      setEvents((old) => [...old, event]);
      if (
        event.type === "done" ||
        ["COMPLETED", "FAILED", "STOPPED", "CANCELLED"].includes(event.state ?? "")
      ) {
        setRunning(false);
      }
      if (event.state === "WAITING_FOR_CHANGE_APPROVAL") setShowChanges(true);
      setPanel("activity");
      if (event.type === "command" && event.message) {
        setTerminal((old) => `${old}${event.message!.replace(/^COMMAND_[A-Z]+ /, "")}`);
        if (!event.message.endsWith("\n")) setTerminal((old) => `${old}\n`);
      }
    });
    const offPermission = window.g1code.onPermissionRequest((value) =>
      setPermission(
        value as { requestId: string; tool: string; input: unknown },
      ),
    );
    return () => {
      offEvent();
      offPermission();
    };
  }, []);

  const openWorkspace = async () => {
    try {
      const selected = await window.g1code.chooseWorkspace();
      if (selected) {
        setWorkspace(selected);
        setWorkspaceInput(selected);
        setEntries(await window.g1code.listDirectory(selected));
        setSessions(await window.g1code.listSessions(selected));
        void window.g1code.rebuildIndex(selected);
        void loadGitAndProblems(selected);
      }
    } catch {
      setWorkspaceModal(true);
    }
  };

  const submitWorkspacePath = async () => {
    if (!workspaceInput.trim()) return;
    try {
      setWorkspace(workspaceInput.trim());
      setEntries(await window.g1code.listDirectory(workspaceInput.trim()));
      setSessions(await window.g1code.listSessions(workspaceInput.trim()));
      void window.g1code.rebuildIndex(workspaceInput.trim());
      void loadGitAndProblems(workspaceInput.trim());
      setWorkspaceModal(false);
    } catch (err) {
      alert("Could not open directory: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const openFile = async (name: string) => {
    const filePath = `${workspace}/${name}`;
    const content = await window.g1code.readFile(filePath);
    setTabs((old) =>
      old.some((tab) => tab.path === filePath)
        ? old
        : [...old, { path: filePath, content, dirty: false }],
    );
    setActive(filePath);
  };

  const save = async () => {
    if (current) {
      await window.g1code.writeFile(current.path, current.content);
      setTabs((old) =>
        old.map((tab) =>
          tab.path === current.path ? { ...tab, dirty: false } : tab,
        ),
      );
    }
  };

  const run = async () => {
    if (!command || workspace === "No workspace open") return;
    setTerminal((old) => `${old}\n$ ${command}\n`);
    const result = await window.g1code.runCommand(command, workspace);
    setTerminal((old) => `${old}${result.output}\n[exit ${result.exitCode}]\n`);
    setCommand("");
  };

  const startAgent = async () => {
    if (!prompt.trim() || workspace === "No workspace open") return;
    setEvents([]);
    setRunning(true);
    try {
      const agentMode = mode === "review" || mode === "debug" || mode === "refactor" ? "agent" : mode;
      let effectivePrompt = prompt;
      if (mode === "review") {
        effectivePrompt = `[CODE REVIEW MODE]: Inspect the following files or area and perform a thorough security, reliability, and performance code review. Return structured findings with severity and concrete fixes:\n\n${prompt}`;
      } else if (mode === "debug") {
        effectivePrompt = `[DEBUG MODE]: Analyze the following error/stack trace, isolate the root cause, inspect the relevant source code, run tests, and propose a targeted repair:\n\n${prompt}`;
      } else if (mode === "refactor") {
        effectivePrompt = `[REFACTOR MODE]: Perform a behavior-preserving refactoring with symbol awareness according to this instruction:\n\n${prompt}`;
      }

      const result = await window.g1code.startAgent({
        workspace,
        prompt: effectivePrompt,
        mode: agentMode,
      });
      setSessionId(result.sessionId);
      setPrompt("");
    } catch (error) {
      setEvents([
        {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
      setRunning(false);
    }
  };

  const executePlanWithAgent = async () => {
    const planPrompt = `Execute the following verified plan steps sequentially:\n${planSteps.map((s, idx) => `${idx + 1}. ${s.title}`).join("\n")}`;
    setMode("agent");
    setPrompt(planPrompt);
    setEvents([]);
    setRunning(true);
    try {
      const result = await window.g1code.startAgent({
        workspace,
        prompt: planPrompt,
        mode: "agent",
      });
      setSessionId(result.sessionId);
      setPrompt("");
    } catch (error) {
      setEvents([
        {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
      setRunning(false);
    }
  };

  const loadSessions = async () => {
    if (workspace !== "No workspace open")
      setSessions(await window.g1code.listSessions(workspace));
  };

  const restoreSession = async (id: string) => {
    const restored = await window.g1code.loadSession(workspace, id);
    setSessionId(id);
    setEvents(restored.events.map((event) => ({ ...(event.payload as Event), type: (event.payload as Event).type ?? event.eventType })));
    setChanges(restored.changes);
    setRepairHistory(restored.repairs);
    setTestRuns(restored.testRuns);
    setSummary(restored.summary ?? null);
    setRunning(false);
  };

  const discardSession = async () => {
    if (!interruptedSession) return;
    await window.g1code.discardSession(workspace, interruptedSession.id);
    setInterruptedSession(null);
    await loadSessions();
  };

  const loadChanges = async () => {
    if (workspace !== "No workspace open") {
      setChanges(await window.g1code.listChanges(workspace, sessionId || undefined));
      setShowChanges(true);
    }
  };

  const changeAction = async (id: string, action: "approve" | "reject" | "apply" | "revert") => {
    await window.g1code.change(workspace, sessionId, id, action);
    await loadChanges();
  };

  const refreshModels = async () => {
    try {
      setModels(await window.g1code.getModels());
    } catch (error) {
      setEvents((old) => [
        ...old,
        {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  };

  const testConnection = async () => {
    try {
      const result = await window.g1code.testProvider(settings.model);
      setModels(result.models);
      setEvents((old) => [
        ...old,
        {
          type: "state",
          message: `Connected${result.model ? ` with ${result.model}` : ""}`,
        },
      ]);
    } catch (error) {
      setEvents((old) => [
        ...old,
        {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  };

  const addPlanStep = () => {
    if (!newStepText.trim()) return;
    setPlanSteps((old) => [
      ...old,
      { id: `s-${Date.now()}`, title: newStepText.trim(), completed: false },
    ]);
    setNewStepText("");
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= planSteps.length) return;
    const updated = [...planSteps];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setPlanSteps(updated);
  };

  const removeStep = (id: string) => {
    setPlanSteps((old) => old.filter((s) => s.id !== id));
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setPalette(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">G1</span>
          <span>G1Code</span>
          <small>AI IDE</small>
        </div>
        <div className="top-actions">
          <button onClick={() => setPalette(true)}>
            <Command size={14} /> Command Palette
          </button>
          <button onClick={() => setWorkspaceModal(true)}>
            <FolderOpen size={14} /> Workspace
          </button>
          <button onClick={() => setSettingsOpen(true)}>
            <Settings size={14} /> Settings
          </button>
        </div>
      </header>
      <div className="workbench">
        <aside className="activitybar">
          <button className="active" onClick={() => setWorkspaceModal(true)} title="Explorer">
            <FolderOpen size={20} />
          </button>
          <button onClick={() => setPanel("git")} title="Source Control / Git">
            <GitBranch size={20} />
          </button>
          <button onClick={() => setPanel("problems")} title="Problems & Diagnostics">
            <ShieldAlert size={20} />
          </button>
          <button onClick={() => setPanel("activity")} title="Agent Activity">
            <Activity size={20} />
          </button>
          <button onClick={() => void loadChanges()} title="Review AI changes">
            <Layers size={20} />
          </button>
          <div className="activity-spacer" />
          <button onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings size={20} />
          </button>
        </aside>
        <aside className="explorer">
          <div className="section-title">
            EXPLORER{" "}
            <button onClick={openWorkspace}>
              <FolderOpen size={15} />
            </button>
          </div>
          <div className="workspace-name" onClick={() => setWorkspaceModal(true)}>
            <ChevronDown size={14} /> {workspace.split(/[\\/]/).pop()}
          </div>
          {sessions.length > 0 && (
            <div className="session-list">
              <div className="section-title">RECENT SESSIONS</div>
              {sessions.slice(0, 6).map((session) => (
                <button
                  className="session-row"
                  key={session.id}
                  onClick={() => {
                    if (session.status === "INTERRUPTED")
                      setInterruptedSession({ id: session.id, title: session.title });
                    else void restoreSession(session.id);
                  }}
                >
                  <strong>{session.title}</strong>
                  <small>{session.status}</small>
                </button>
              ))}
            </div>
          )}
          {workspace === "No workspace open" ? (
            <div className="empty">
              <FolderOpen size={24} />
              <p>Open a folder to start</p>
              <button className="primary" onClick={openWorkspace}>
                Open workspace
              </button>
            </div>
          ) : (
            entries.map((entry) => (
              <button
                className="file-row"
                key={entry.name}
                onClick={() =>
                  entry.kind === "file"
                    ? void openFile(entry.name)
                    : setExpanded((old) => ({
                        ...old,
                        [entry.name]: !old[entry.name],
                      }))
                }
              >
                {entry.kind === "directory" ? (
                  expanded[entry.name] ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )
                ) : (
                  <span className="file-dot" />
                )}
                <span>{entry.name}</span>
              </button>
            ))
          )}
        </aside>
        <main className="editor-area">
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                className={tab.path === active ? "tab selected" : "tab"}
                key={tab.path}
                onClick={() => setActive(tab.path)}
              >
                {tab.path.split(/[\\/]/).pop()}
                {tab.dirty && " •"}
                <X
                  size={13}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTabs((old) =>
                      old.filter((item) => item.path !== tab.path),
                    );
                  }}
                />
              </button>
            ))}
          </div>
          {current ? (
            <>
              <div className="editor-header">
                <span>
                  {current.path.replace(workspace, "").replace(/^[/\\]/, "")}
                </span>
                <button onClick={() => void save()}>
                  <Save size={14} /> Save
                </button>
              </div>
              <textarea
                className="editor"
                value={current.content}
                onChange={(event) =>
                  setTabs((old) =>
                    old.map((tab) =>
                      tab.path === current.path
                        ? { ...tab, content: event.target.value, dirty: true }
                        : tab,
                    ),
                  )
                }
                spellCheck={false}
              />
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-icon">
                <Sparkles size={30} />
              </div>
              <h1>Build with intent.</h1>
              <p>
                Professional AI-assisted IDE with real-time agent execution, structured plan editing,
                interactive review, debug diagnostics, and safe rollback verification.
              </p>
              <button className="primary" onClick={openWorkspace}>
                <FolderOpen size={15} /> Open workspace
              </button>
            </div>
          )}
          <div className="bottom-panel">
            <div className="panel-tabs">
              <button
                className={panel === "terminal" ? "selected" : ""}
                onClick={() => setPanel("terminal")}
              >
                <Terminal size={14} /> TERMINAL
              </button>
              <button
                className={panel === "activity" ? "selected" : ""}
                onClick={() => setPanel("activity")}
              >
                <Activity size={14} /> AGENT ACTIVITY
              </button>
              <button
                className={panel === "tests" ? "selected" : ""}
                onClick={() => setPanel("tests")}
              >
                <Activity size={14} /> TESTS
              </button>
              <button
                className={panel === "problems" ? "selected" : ""}
                onClick={() => {
                  setPanel("problems");
                  void loadGitAndProblems(workspace);
                }}
              >
                <AlertTriangle size={14} /> PROBLEMS {problems.length > 0 && `(${problems.length})`}
              </button>
              <button
                className={panel === "git" ? "selected" : ""}
                onClick={() => {
                  setPanel("git");
                  void loadGitAndProblems(workspace);
                }}
              >
                <GitBranch size={14} /> GIT ({gitStatus.branch || "main"})
              </button>
            </div>

            {panel === "terminal" ? (
              <div className="terminal">
                <pre>
                  {terminal ||
                    "Terminal ready. Commands execute securely inside the active workspace."}
                </pre>
                <div className="terminal-input">
                  <span>$</span>
                  <input
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && void run()}
                    placeholder="Enter a command..."
                  />
                  <button onClick={() => void run()}>
                    <Play size={14} />
                  </button>
                </div>
              </div>
            ) : panel === "tests" ? (
              <div className="activity-log test-results">
                <h3>Test Runs</h3>
                {testRuns.length ? (
                  testRuns.map((run) => (
                    <div className="event-row" key={run.id}>
                      <span className={run.passed ? "event-mark" : "event-error"}>
                        {run.passed ? "✓" : "!"}
                      </span>
                      <span>
                        <b>{run.command}</b>{" "}
                        <small>
                          {run.exitCode === 0 ? "passed" : `failed (${run.exitCode ?? "?"})`} ·{" "}
                          {run.duration}ms
                        </small>
                      </span>
                    </div>
                  ))
                ) : (
                  <span>No persisted test runs for this session.</span>
                )}
                {repairHistory.length > 0 && (
                  <>
                    <h3>Repair History</h3>
                    {repairHistory.map((repair) => (
                      <div className="event-row" key={repair.attemptNumber}>
                        <span className="event-error">!</span>
                        <span>
                          <b>Attempt {repair.attemptNumber}</b> {repair.diagnosis}{" "}
                          <small>{repair.result}</small>
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : panel === "problems" ? (
              <div className="activity-log">
                <h3>Workspace Diagnostics & Warnings</h3>
                {problems.length > 0 ? (
                  problems.map((p) => (
                    <div className="event-row" key={p.id}>
                      <span className={p.severity === "error" ? "event-error" : "event-mark"}>
                        {p.severity === "error" ? "!" : "i"}
                      </span>
                      <span>
                        <b>[{p.source.toUpperCase()}]</b> {p.message}{" "}
                        {p.file && <small>at {p.file}</small>}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty-panel-text">
                    <CheckCircle2 size={16} color="#d8f56b" /> No active problems or diagnostic errors detected.
                  </div>
                )}
              </div>
            ) : panel === "git" ? (
              <div className="activity-log git-panel-content">
                <div className="git-header-bar">
                  <span>Branch: <b>{gitStatus.branch}</b></span>
                  <span>HEAD: <code>{gitStatus.head.slice(0, 8)}</code></span>
                  <button onClick={() => void loadGitAndProblems(workspace)}>
                    <RefreshCw size={13} /> Refresh
                  </button>
                </div>
                {gitStatus.status ? (
                  <pre className="git-status-pre">{gitStatus.status}</pre>
                ) : (
                  <div className="empty-panel-text">Working tree clean. No uncommitted modifications.</div>
                )}
                {gitStatus.recentCommits?.length > 0 && (
                  <div className="git-commits-list">
                    <h4>Recent Commits</h4>
                    {gitStatus.recentCommits.slice(0, 5).map((c, i) => (
                      <div key={i} className="git-commit-row">
                        <code>{c.split(" ")[0]}</code> {c.split(" ").slice(1).join(" ")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="activity-log">
                {events.length ? (
                  events.map((event, index) => (
                    <div className="event-row" key={index}>
                      <span
                        className={
                          event.type === "error" ? "event-error" : "event-mark"
                        }
                      >
                        {event.type === "error" ? "!" : "✓"}
                      </span>
                      <span>
                        <b>{event.state || event.toolName || event.type}</b>{" "}
                        {event.message || ""}
                      </span>
                    </div>
                  ))
                ) : (
                  <>
                    <Bot size={17} />
                    <span>
                      Agent activity will appear here when a task is running.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
        <aside className="agent">
          <div className="agent-heading">
            <div>
              <div className="eyebrow">G1CODE AGENT</div>
              <h2>{running ? "Working..." : "Build with intent."}</h2>
            </div>
            <span className="status-dot" />
          </div>

          <div className="agent-mode-grid">
            <button
              className={mode === "ask" ? "selected" : ""}
              onClick={() => setMode("ask")}
            >
              Ask
            </button>
            <button
              className={mode === "plan" ? "selected" : ""}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
            <button
              className={mode === "agent" ? "selected" : ""}
              onClick={() => setMode("agent")}
            >
              Agent
            </button>
            <button
              className={mode === "review" ? "selected" : ""}
              onClick={() => setMode("review")}
            >
              Review
            </button>
            <button
              className={mode === "debug" ? "selected" : ""}
              onClick={() => setMode("debug")}
            >
              Debug
            </button>
            <button
              className={mode === "refactor" ? "selected" : ""}
              onClick={() => setMode("refactor")}
            >
              Refactor
            </button>
          </div>

          <div className="model-picker">
            <span>Model</span>
            <select
              value={settings.model}
              onChange={(event) =>
                setSettings({ ...settings, model: event.target.value })
              }
            >
              <option value="">Select configured model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button onClick={() => void refreshModels()}>
              <Activity size={13} />
            </button>
          </div>

          {mode === "plan" ? (
            <div className="plan-editor-panel">
              <div className="plan-editor-header">
                <h3>
                  <ListChecks size={16} /> Interactive Plan
                </h3>
                <span className="plan-count">{planSteps.length} steps</span>
              </div>
              <div className="plan-steps-list">
                {planSteps.map((step, idx) => (
                  <div className="plan-step-item" key={step.id}>
                    <span className="step-idx">{idx + 1}</span>
                    <input
                      className="step-input"
                      value={step.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPlanSteps((old) =>
                          old.map((s) => (s.id === step.id ? { ...s, title: val } : s)),
                        );
                      }}
                    />
                    <div className="step-actions">
                      <button onClick={() => moveStep(idx, "up")} disabled={idx === 0}>
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => moveStep(idx, "down")} disabled={idx === planSteps.length - 1}>
                        <ChevronDown size={13} />
                      </button>
                      <button onClick={() => removeStep(step.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="add-step-row">
                <input
                  placeholder="Add next plan step..."
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlanStep()}
                />
                <button onClick={addPlanStep}>
                  <Plus size={14} /> Add
                </button>
              </div>
              <button className="primary execute-plan-btn" onClick={executePlanWithAgent}>
                <Play size={14} /> Approve & Execute Plan
              </button>
            </div>
          ) : (
            <div className="agent-empty">
              {events.length ? (
                <div className="latest-event">
                  {events.slice(-5).map((event, index) => (
                    <div key={index}>
                      <span
                        className={
                          event.type === "error" ? "event-error" : "event-mark"
                        }
                      >
                        {event.type === "error" ? "!" : "✓"}
                      </span>{" "}
                      {event.message || event.state || event.toolName}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <Bot size={28} />
                  <h3>Ready when you are.</h3>
                  <p>
                    {mode === "review"
                      ? "Request an automated code review for security, performance, or correctness."
                      : mode === "debug"
                        ? "Paste a stack trace or describe an error to isolate and fix the bug."
                        : mode === "refactor"
                          ? "Propose behavior-preserving transformations and cleanups."
                          : "Ask about your codebase, plan a feature, or start autonomous implementation."}
                  </p>
                  {mode === "review" ? (
                    <>
                      <div
                        className="prompt-chip"
                        onClick={() => setPrompt("Perform a full security review of recent changes")}
                      >
                        Security review of changes <span>↵</span>
                      </div>
                      <div
                        className="prompt-chip"
                        onClick={() => setPrompt("Check for performance bottlenecks and async leaks")}
                      >
                        Find performance bottlenecks <span>↵</span>
                      </div>
                    </>
                  ) : mode === "debug" ? (
                    <>
                      <div
                        className="prompt-chip"
                        onClick={() => setPrompt("Diagnose and repair the latest failing test")}
                      >
                        Diagnose failing test <span>↵</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="prompt-chip"
                        onClick={() => setPrompt("Explain this project")}
                      >
                        Explain this project <span>↵</span>
                      </div>
                      <div
                        className="prompt-chip"
                        onClick={() => setPrompt("Find the build command and dependencies")}
                      >
                        Find the build command <span>↵</span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {summary && (
            <div className="task-summary">
              <div className="eyebrow">TASK SUMMARY</div>
              <strong>{summary.status}</strong>
              <p>{summary.task}</p>
            </div>
          )}

          <div className="agent-input">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === "review"
                  ? "Describe what files or criteria to review..."
                  : mode === "debug"
                    ? "Paste stack trace or describe failure..."
                    : mode === "refactor"
                      ? "Describe refactoring goal..."
                      : "Ask G1Code anything..."
              }
              onKeyDown={(event) =>
                event.key === "Enter" &&
                !event.shiftKey &&
                (event.preventDefault(), void startAgent())
              }
            />
            <button
              className="send"
              onClick={() => void startAgent()}
              disabled={running}
            >
              <Sparkles size={16} />
            </button>
          </div>
          <div className="agent-footer">
            <span>
              <span className="status-dot" />{" "}
              {running
                ? "Working"
                : settings.apiKeyConfigured
                  ? "Provider ready"
                  : "Provider not configured"}
            </span>
            <span>{settings.provider}</span>
          </div>
        </aside>
      </div>
      <footer>
        <span>
          <GitBranch size={13} /> {gitStatus.branch || "main"}
        </span>
        <span>Ln 1, Col 1</span>
        <span className="footer-spacer" />
        <span>UTF-8</span>
        <span>G1Code v1.0 Production</span>
      </footer>

      {/* Workspace Path Modal */}
      {workspaceModal && (
        <div className="modal-backdrop" onClick={() => setWorkspaceModal(false)}>
          <div className="settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-title">
              <div>
                <div className="eyebrow">WORKSPACE DIRECTORY</div>
                <h2>Open Project Folder</h2>
              </div>
              <button onClick={() => setWorkspaceModal(false)}>
                <X size={17} />
              </button>
            </div>
            <p className="muted">
              Enter the absolute or relative filesystem path of the workspace to open:
            </p>
            <label>
              Workspace Folder Path
              <input
                value={workspaceInput}
                onChange={(e) => setWorkspaceInput(e.target.value)}
                placeholder="/path/to/project"
                autoFocus
              />
            </label>
            <div className="settings-actions">
              <button className="secondary" onClick={() => setWorkspaceModal(false)}>
                Cancel
              </button>
              <button className="primary" onClick={submitWorkspacePath}>
                Open Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette */}
      {palette && (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <div className="palette-search">
              <Search size={16} />
              <input autoFocus placeholder="Type a command or action..." />
            </div>
            {[
              "Open Workspace Folder",
              "G1Code: Review Mode",
              "G1Code: Debug Failing Test",
              "G1Code: Refactor Code",
              "G1Code: Interactive Plan",
              "Open AI Provider Settings",
            ].map((item, index) => (
              <button
                key={item}
                onClick={() => {
                  setPalette(false);
                  if (index === 0) setWorkspaceModal(true);
                  if (index === 1) setMode("review");
                  if (index === 2) setMode("debug");
                  if (index === 3) setMode("refactor");
                  if (index === 4) setMode("plan");
                  if (index === 5) setSettingsOpen(true);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="settings-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-title">
              <div>
                <div className="eyebrow">G1CODE SETTINGS</div>
                <h2>AI Provider Configuration</h2>
              </div>
              <button onClick={() => setSettingsOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <label>
              Provider
              <input value={settings.provider} readOnly />
            </label>
            <label>
              Endpoint
              <input
                value={settings.endpoint}
                onChange={(event) =>
                  setSettings({ ...settings, endpoint: event.target.value })
                }
              />
            </label>
            <label>
              API key
              <input
                type="password"
                value={apiKeyDraft}
                placeholder={
                  settings.apiKeyConfigured
                    ? "Stored securely (AES-256)"
                    : "Enter API key"
                }
                onChange={(event) => setApiKeyDraft(event.target.value)}
              />
            </label>
            <label>
              Model
              <input
                value={settings.model}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value })
                }
                placeholder="Provider model identifier"
              />
            </label>
            <div className="settings-grid">
              <label>
                Temperature
                <input
                  type="number"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      temperature: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Max tokens
                <input
                  type="number"
                  value={settings.maxTokens}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      maxTokens: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="settings-actions">
              <button
                className="secondary"
                onClick={() => void testConnection()}
              >
                Test connection
              </button>
              <button
                className="primary"
                onClick={() =>
                  void window.g1code
                    .saveSettings({
                      ...settings,
                      ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}),
                    })
                    .then(() => {
                      setSettings({
                        ...settings,
                        apiKeyConfigured:
                          settings.apiKeyConfigured || Boolean(apiKeyDraft),
                      });
                      setApiKeyDraft("");
                      setSettingsOpen(false);
                    })
                }
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Dialog */}
      {permission && (
        <div className="modal-backdrop">
          <div className="settings-card permission-card">
            <div className="eyebrow">PERMISSION REQUIRED</div>
            <h2>G1Code wants to execute {permission.tool}</h2>
            <pre>{JSON.stringify(permission.input, null, 2)}</pre>
            <div className="settings-actions">
              <button
                className="secondary"
                onClick={() => {
                  window.g1code.respondPermission(permission.requestId, false);
                  setPermission(null);
                }}
              >
                Deny
              </button>
              <button
                className="primary"
                onClick={() => {
                  window.g1code.respondPermission(permission.requestId, true);
                  setPermission(null);
                }}
              >
                Allow Once
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Diff & Changes Modal */}
      {showChanges && (
        <div className="modal-backdrop" onClick={() => setShowChanges(false)}>
          <div className="settings-card changes-card" onClick={(event) => event.stopPropagation()}>
            <div className="settings-title">
              <div>
                <div className="eyebrow">G1CODE ADVANCED DIFF VIEWER</div>
                <h2>{changes.length} pending or applied changes</h2>
              </div>
              <div className="diff-view-controls">
                <button
                  className={diffViewMode === "unified" ? "selected" : ""}
                  onClick={() => setDiffViewMode("unified")}
                >
                  Unified
                </button>
                <button
                  className={diffViewMode === "split" ? "selected" : ""}
                  onClick={() => setDiffViewMode("split")}
                >
                  Split View
                </button>
                <button onClick={() => setShowChanges(false)}>
                  <X size={17} />
                </button>
              </div>
            </div>
            {!changes.length ? (
              <p className="muted">No persisted AI changes for this workspace.</p>
            ) : (
              changes.map((change) => (
                <section className="change-review" key={change.id}>
                  <div className="change-heading">
                    <strong>{change.path}</strong>
                    <span className={`change-status ${change.status.toLowerCase()}`}>
                      {change.status}
                    </span>
                  </div>
                  <pre className={`diff-view ${diffViewMode}`}>{change.patch}</pre>
                  <div className="settings-actions">
                    {change.status === "PENDING" && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => void changeAction(change.id, "reject")}
                        >
                          Reject
                        </button>
                        <button
                          className="primary"
                          onClick={() => void changeAction(change.id, "approve")}
                        >
                          Accept
                        </button>
                      </>
                    )}
                    {change.status === "APPROVED" && (
                      <button
                        className="primary"
                        onClick={() => void changeAction(change.id, "apply")}
                      >
                        Apply to Filesystem
                      </button>
                    )}
                    {change.status === "APPLIED" && (
                      <button
                        className="secondary"
                        onClick={() => void changeAction(change.id, "revert")}
                      >
                        Revert AI Change
                      </button>
                    )}
                  </div>
                </section>
              ))
            )}
            {changes.some((change) => change.status === "PENDING") && (
              <div className="settings-actions batch-actions">
                <button
                  className="secondary"
                  onClick={async () => {
                    if (sessionId) await window.g1code.rejectAllChanges(workspace, sessionId);
                    await loadChanges();
                  }}
                >
                  Reject All Changes
                </button>
                <button
                  className="primary"
                  onClick={async () => {
                    if (sessionId) await window.g1code.approveAllChanges(workspace, sessionId);
                    await loadChanges();
                  }}
                >
                  Accept & Apply All Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interrupted Session Modal */}
      {interruptedSession && (
        <div className="modal-backdrop">
          <div className="settings-card permission-card">
            <div className="eyebrow">INTERRUPTED AGENT SESSION</div>
            <h2>{interruptedSession.title}</h2>
            <p className="muted">
              This session was interrupted. Review its persisted changes before deciding what to do. Safe resume verifies filesystem hashes before continuing.
            </p>
            <div className="settings-actions">
              <button
                className="secondary"
                onClick={() => {
                  setSessionId(interruptedSession.id);
                  setShowChanges(true);
                  setInterruptedSession(null);
                  void restoreSession(interruptedSession.id);
                }}
              >
                Review Changes
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setInterruptedSession(null);
                  void restoreSession(interruptedSession.id);
                }}
              >
                Resume Safely
              </button>
              <button className="primary" onClick={() => void discardSession()}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
