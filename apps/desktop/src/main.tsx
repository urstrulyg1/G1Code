import "./api-client";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command,
  Edit3,
  FileCode,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitFork,
  HelpCircle,
  Key,
  Layers,
  ListChecks,
  Mic,
  Minus,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
  User,
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
  toolCallId?: string;
  input?: unknown;
  result?: unknown;
};
type Change = {
  id: string;
  sessionId?: string;
  path: string;
  originalContent?: string;
  proposedContent?: string;
  patch: string;
  status: string;
};
type TestRun = {
  id: string;
  command: string;
  exitCode?: number;
  passed?: number;
  duration: number;
};
type Repair = {
  id: string;
  attemptNumber: number;
  diagnosis: string;
  result: string;
};
type SettingsType = {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
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
type SearchMatch = {
  file: string;
  line: number;
  content: string;
};
type ModelItem = {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  contextWindowFormatted?: string;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  isPromotional?: boolean;
  pricingType?: string;
  recommendedRole?: string;
  description?: string;
};

function getLanguage(filePath: string): string {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))
    return "typescript";
  if (filePath.endsWith(".js") || filePath.endsWith(".jsx"))
    return "javascript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".html")) return "html";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".sh") || filePath.endsWith(".bat")) return "shell";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".go")) return "go";
  return "plaintext";
}

function App() {
  // Navigation & Workspace
  const [workspace, setWorkspace] = useState("No workspace open");
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Layout View State
  const [activeActivity, setActiveActivity] = useState<
    "explorer" | "git" | "search" | "debug" | "extensions"
  >("git");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showBottomPanel, setShowBottomPanel] = useState(true);
  const [showAgentWorkspace, setShowAgentWorkspace] = useState(true);

  // Center Monaco Editor State
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState("");
  const activeTab = tabs.find((t) => t.path === activeTabPath);
  const [activeDiff, setActiveDiff] = useState<Change | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">(
    "split",
  );

  // Bottom Panel State
  const [bottomTab, setBottomTab] = useState<
    "terminal" | "problems" | "tests" | "activity" | "git"
  >("activity");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalCmd, setTerminalCmd] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [repairHistory, setRepairHistory] = useState<Repair[]>([]);

  // Source Control / Git State
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    branch: "main",
    head: "",
    status: "",
    diff: "",
    modifiedFiles: [],
    recentCommits: [],
  });
  const [commitMessage, setCommitMessage] = useState("");
  const [generatingCommit, setGeneratingCommit] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);

  // Agent State
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState(
    "Updating Git Repository Content",
  );
  const [userTaskPrompt, setUserTaskPrompt] = useState("now commit and push");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMode, setAgentMode] = useState<
    "agent" | "ask" | "plan" | "arena-agent" | "review" | "debug" | "refactor"
  >("agent");
  const [events, setEvents] = useState<Event[]>([
    {
      type: "state",
      state: "COMPLETED",
      message: "Repository initialized and verified.",
    },
  ]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      title: string;
      mode: string;
      status: string;
      model?: string;
    }>
  >([]);
  const [permission, setPermission] = useState<{
    requestId: string;
    tool: string;
    input: unknown;
  } | null>(null);

  // Structured Timeline Tasks (BOB / Antigravity Style)
  const [timelineSteps, setTimelineSteps] = useState<
    Array<{ title: string; bullets: string[] }>
  >([
    {
      title: "1. start-ui.sh & start-ui.bat:",
      bullets: [
        "Single-command browser-first runner",
        "Spins up Node services",
        "Launches frontend dashboard",
      ],
    },
    {
      title: "2. Decoupled Architecture",
      bullets: [
        "Electron main process + preload security bridge",
        "Browser API client parity",
      ],
    },
    {
      title: "3. Automated Validation",
      bullets: [
        "46 automated tests passing",
        "E2E smoke tests & provider resilience",
      ],
    },
  ]);

  // Experiential Labs Provider & Models
  const [settings, setSettings] = useState<SettingsType>({
    provider: "experiential-labs",
    endpoint: "https://api.experientiallabs.ai/v1",
    model: "gpt-6-astra",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  });
  const [models, setModels] = useState<ModelItem[]>([
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      contextWindow: 1050000,
      contextWindowFormatted: "1.05M",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "coding",
      description:
        "Flagship frontier reasoning & computer-use coding model with 1.05M context window.",
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      contextWindow: 1050000,
      contextWindowFormatted: "1.05M",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "fast",
      description:
        "Ultra-fast efficiency model with 1.05M context, optimized for real-time agent tasks.",
    },
    {
      id: "qwen-3.8-27b",
      name: "Qwen3.8 27B",
      contextWindow: 1000000,
      contextWindowFormatted: "1M",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "fast",
      description:
        "Ultra-fast instruction following and agent execution with 1M context.",
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      contextWindow: 1050000,
      contextWindowFormatted: "1.05M",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "balanced",
      description:
        "Efficient reasoning model with 1.05M context and strong code generation.",
    },
    {
      id: "deepseek-r1-distill-qwen-32b",
      name: "DeepSeek R1 Distill Qwen 32B",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "reasoning",
      description:
        "Distilled mathematical and logical reasoning model with verified code generation.",
    },
    {
      id: "meta-llama-3.3-70b-instruct",
      name: "Llama 3.3 70B Instruct",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "balanced",
      description:
        "Versatile open-weights instruction model with comprehensive tool and agent capabilities.",
    },
    {
      id: "qwen-2.5-coder-32b",
      name: "Qwen 2.5 Coder 32B",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "coding",
      description:
        "Specialized coding model fine-tuned for repository refactoring, bug fixing, and test writing.",
    },
    {
      id: "mistral-small-3-24b",
      name: "Mistral Small 3 24B",
      contextWindow: 32768,
      contextWindowFormatted: "32K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "fast",
      description:
        "Compact low-latency model for rapid file edits, lint checks, and inline completion.",
    },
    {
      id: "arena-agent-v1",
      name: "Arena Agent V1",
      provider: "arena.ai",
      contextWindow: 256000,
      contextWindowFormatted: "256K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "agent",
      description:
        "Autonomous agent model with tool use, multi-step planning, and bash sandbox execution evaluated on Agent Arena.",
    },
    {
      id: "arena-agent-coder",
      name: "Arena Agent Coder",
      provider: "arena.ai",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "coding",
      description:
        "High-precision coding and refactoring agent model with verified repository repair capabilities.",
    },
    {
      id: "arena-chat-v1",
      name: "Arena Chat V1",
      provider: "arena.ai",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "balanced",
      description:
        "Top-tier conversational reasoning and instruction following model benchmarked on Chatbot Arena.",
    },
    {
      id: "arena-code-v1",
      name: "Arena Code V1",
      provider: "arena.ai",
      contextWindow: 128000,
      contextWindowFormatted: "128K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      isPromotional: true,
      pricingType: "free",
      recommendedRole: "coding",
      description:
        "Specialized coding assistant model leading Arena coding leaderboards.",
    },
    {
      id: "arena-frontier-eval",
      name: "Arena Frontier Eval",
      provider: "arena.ai",
      contextWindow: 200000,
      contextWindowFormatted: "200K",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      isPromotional: false,
      pricingType: "credits",
      recommendedRole: "reasoning",
      description:
        "Flagship frontier model evaluator with deep multi-step verification.",
    },
  ]);
  const [selectedModel, setSelectedModel] = useState("gpt-6-astra");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFilterTab, setModelFilterTab] = useState<
    "free" | "arena" | "experiential" | "agents" | "all" | "tools" | "reasoning"
  >("free");

  // Autocomplete popovers (@ context & / slash actions)
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [contextFilter, setContextFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [attachedContext, setAttachedContext] = useState<string[]>([]);

  // Settings & Verification Dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [verificationResult, setVerificationResult] = useState<string | null>(
    null,
  );
  const [testModelResult, setTestModelResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [testingModel, setTestingModel] = useState(false);

  // Command Palette & Mode Dropdown
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load initial settings, models, git & problems
  useEffect(() => {
    void window.g1code.getSettings().then((s) => {
      setSettings(s);
      if (s.model) setSelectedModel(s.model);
    });

    void window.g1code.getModels().then((res) => {
      if (res && res.length > 0) setModels(res);
    });

    const offEvent = window.g1code.onAgentEvent((value) => {
      const event = value as Event;
      setEvents((old) => [...old, event]);
      if (
        event.type === "done" ||
        ["COMPLETED", "FAILED", "STOPPED", "CANCELLED"].includes(
          event.state ?? "",
        )
      ) {
        setRunning(false);
      }
      if (event.state === "WAITING_FOR_CHANGE_APPROVAL") {
        void loadChanges();
      }
      if (event.type === "command" && event.message) {
        setTerminalOutput(
          (old) => `${old}${event.message!.replace(/^COMMAND_[A-Z]+ /, "")}\n`,
        );
      }
    });

    const offPermission = window.g1code.onPermissionRequest((value) => {
      setPermission(
        value as { requestId: string; tool: string; input: unknown },
      );
    });

    return () => {
      offEvent();
      offPermission();
    };
  }, []);

  const loadGitAndProblems = async (wsPath: string) => {
    try {
      if (window.g1code.getGitStatus) {
        const gitData = await window.g1code.getGitStatus(wsPath);
        setGitStatus(gitData);
      }
      if (window.g1code.getProblems) {
        const probData = await window.g1code.getProblems(wsPath);
        setProblems(probData.problems || []);
      }
    } catch {
      // ignore
    }
  };

  const loadChanges = async () => {
    if (workspace === "No workspace open") return;
    try {
      const list = await window.g1code.listChanges(workspace, sessionId);
      setChanges(list);
    } catch {
      // ignore
    }
  };

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
      alert(
        "Could not open directory: " +
          (err instanceof Error ? err.message : String(err)),
      );
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
    setActiveTabPath(filePath);
    setActiveDiff(null);
  };

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((old) => old.filter((t) => t.path !== path));
    if (activeTabPath === path) {
      const remaining = tabs.filter((t) => t.path !== path);
      if (remaining.length > 0)
        setActiveTabPath(remaining[remaining.length - 1].path);
      else setActiveTabPath("");
    }
  };

  const saveActiveFile = async () => {
    if (activeTab) {
      await window.g1code.writeFile(activeTab.path, activeTab.content);
      setTabs((old) =>
        old.map((t) =>
          t.path === activeTab.path ? { ...t, dirty: false } : t,
        ),
      );
      void loadGitAndProblems(workspace);
    }
  };

  const runTerminalCommand = async () => {
    if (!terminalCmd || workspace === "No workspace open") return;
    setTerminalOutput((old) => `${old}\n$ ${terminalCmd}\n`);
    const result = await window.g1code.runCommand(terminalCmd, workspace);
    setTerminalOutput(
      (old) => `${old}${result.output}\n[exit code ${result.exitCode}]\n`,
    );
    setTerminalCmd("");
  };

  // Agent Actions
  const startAgent = async (overridePrompt?: string) => {
    const task = overridePrompt || agentPrompt;
    if (!task.trim() || workspace === "No workspace open") return;

    setRunning(true);
    setEvents([]);
    setUserTaskPrompt(task);
    setSessionTitle(task.length > 40 ? task.slice(0, 40) + "..." : task);

    // Build timeline card for the requested task
    setTimelineSteps([
      {
        title: `Task: ${task}`,
        bullets: [
          `Active Model: Experiential Labs / ${selectedModel}`,
          "Inspecting workspace repository baseline",
          "Autonomous tool execution engaged",
        ],
      },
    ]);

    try {
      const res = await window.g1code.startAgent({
        workspace,
        prompt: task,
        mode:
          agentMode === "plan" ? "plan" : agentMode === "ask" ? "ask" : "agent",
        model: selectedModel,
      });
      setSessionId(res.sessionId);
      setAgentPrompt("");
      setAttachedContext([]);
    } catch (err) {
      setRunning(false);
      setEvents((old) => [
        ...old,
        {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  };

  const handleModelChange = async (newModel: string) => {
    setSelectedModel(newModel);
    setModelPickerOpen(false);
    const targetModel = models.find((m) => m.id === newModel);
    const targetProvider =
      targetModel?.provider ||
      (newModel.startsWith("arena-") ? "arena.ai" : "experiential-labs");
    const updated = await window.g1code.saveSettings({
      ...settings,
      model: newModel,
      provider: targetProvider,
    });
    setSettings(updated as SettingsType);
    if (sessionId && window.g1code.setSessionModel) {
      await window.g1code.setSessionModel(sessionId, newModel);
    }
  };

  const generateCommitWithAI = async () => {
    if (workspace === "No workspace open") return;
    setGeneratingCommit(true);
    try {
      const res = await window.g1code.generateCommitMsg(
        workspace,
        selectedModel,
      );
      setCommitMessage(res.message);
    } catch {
      setCommitMessage("chore: update codebase");
    } finally {
      setGeneratingCommit(false);
    }
  };

  const commitGitChanges = async () => {
    if (workspace === "No workspace open" || !commitMessage.trim()) return;
    setCommitting(true);
    try {
      await window.g1code.commitGit(workspace, commitMessage.trim());
      setCommitMessage("");
      void loadGitAndProblems(workspace);
      setTimelineSteps((old) => [
        ...old,
        {
          title: "Git Commit Successful",
          bullets: [
            `Committed to ${gitStatus.branch}: "${commitMessage.trim()}"`,
          ],
        },
      ]);
    } catch (err) {
      alert(
        "Git commit failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setCommitting(false);
    }
  };

  const performWorkspaceSearch = async () => {
    if (!searchQuery.trim() || workspace === "No workspace open") return;
    setSearching(true);
    try {
      const results = await window.g1code.searchWorkspace(
        workspace,
        searchQuery.trim(),
      );
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const verifyExperientialConnection = async () => {
    setVerifying(true);
    setVerificationResult(null);
    try {
      const res = await window.g1code.verifyProvider(settings.provider);
      if (res.connected) {
        setVerificationResult(
          `✓ Connected! ${res.modelCount} models available from ${settings.provider === "arena.ai" ? "Arena.ai" : "Experiential Labs"}.`,
        );
      } else {
        setVerificationResult(
          `✕ Connection failed: ${res.error || res.message || "Authentication error"}`,
        );
      }
    } catch (err) {
      setVerificationResult(
        `✕ Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setVerifying(false);
    }
  };

  const testSelectedModel = async () => {
    setTestingModel(true);
    setTestModelResult(null);
    try {
      const res = await window.g1code.testProvider(
        settings.model || selectedModel,
        settings.provider,
      );
      if (res.connected && res.working) {
        setTestModelResult(
          `✓ Working (${res.latencyMs}ms, TTFT: ${res.ttftMs}ms): "${res.output}"`,
        );
      } else {
        setTestModelResult(`✕ Test failed: ${res.error || "No response"}`);
      }
    } catch (err) {
      setTestModelResult(
        `✕ Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setTestingModel(false);
    }
  };

  // Autocomplete triggers
  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void startAgent();
      return;
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setAgentPrompt(val);

    // Check for @ mention
    const atMatch = val.match(/@([a-zA-Z0-9_\-\./]*)$/);
    if (atMatch) {
      setShowContextPicker(true);
      setContextFilter(atMatch[1] || "");
    } else {
      setShowContextPicker(false);
    }

    // Check for / slash command
    const slashMatch = val.match(/\/([a-zA-Z0-9_\-]*)$/);
    if (slashMatch) {
      setShowActionPicker(true);
      setActionFilter(slashMatch[1] || "");
    } else {
      setShowActionPicker(false);
    }
  };

  const insertContextMention = (item: string) => {
    const updated = agentPrompt.replace(/@([a-zA-Z0-9_\-\./]*)$/, `@${item} `);
    setAgentPrompt(updated);
    setShowContextPicker(false);
    if (!attachedContext.includes(item)) {
      setAttachedContext([...attachedContext, item]);
    }
    textareaRef.current?.focus();
  };

  const insertSlashAction = (cmd: string) => {
    const updated = agentPrompt.replace(/\/([a-zA-Z0-9_\-]*)$/, `/${cmd} `);
    setAgentPrompt(updated);
    setShowActionPicker(false);
    textareaRef.current?.focus();
  };

  // Filtered models for Model Picker
  const freeCount = models.filter((m) => m.isPromotional).length;
  const toolCount = models.filter((m) => m.supportsTools).length;
  const arenaCount = models.filter(
    (m) => m.provider === "arena.ai" || m.id.startsWith("arena-"),
  ).length;
  const experientialCount = models.filter(
    (m) =>
      m.provider === "experiential-labs" ||
      (!m.provider && !m.id.startsWith("arena-")),
  ).length;
  const agentCount = models.filter(
    (m) => m.recommendedRole === "agent" || m.id.includes("agent"),
  ).length;

  const filteredModels = models.filter((m) => {
    const matchSearch =
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase());
    if (!matchSearch) return false;
    if (modelFilterTab === "free") return m.isPromotional;
    if (modelFilterTab === "arena")
      return m.provider === "arena.ai" || m.id.startsWith("arena-");
    if (modelFilterTab === "experiential")
      return (
        m.provider === "experiential-labs" ||
        (!m.provider && !m.id.startsWith("arena-"))
      );
    if (modelFilterTab === "agents")
      return m.recommendedRole === "agent" || m.id.includes("agent");
    if (modelFilterTab === "tools") return m.supportsTools;
    if (modelFilterTab === "reasoning") {
      const id = m.id.toLowerCase();
      return (
        id.includes("astra") ||
        id.includes("luna") ||
        id.includes("r1") ||
        id.includes("flash") ||
        id.includes("fable") ||
        id.includes("reasoning") ||
        id.includes("eval")
      );
    }
    return true;
  });

  const activeModelMeta = models.find((m) => m.id === selectedModel) ||
    models[0] || {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      contextWindowFormatted: "1.05M",
      isPromotional: true,
    };

  const renderModelCard = (m: (typeof models)[0]) => {
    const isArena = m.provider === "arena.ai" || m.id.startsWith("arena-");
    return (
      <div
        className={`model-item-card ${selectedModel === m.id ? "active" : ""}`}
        key={m.id}
        onClick={() => handleModelChange(m.id)}
      >
        <div className="model-item-top">
          <span className="model-item-name">
            {selectedModel === m.id && (
              <Check size={13} color="var(--accent-model)" />
            )}
            {m.name}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isArena ? (
              <span className="model-arena-badge">Arena.ai</span>
            ) : (
              <span className="model-experiential-badge">Experiential</span>
            )}
            {m.recommendedRole && (
              <span
                className={`model-role-badge ${m.recommendedRole === "agent" ? "agent-role" : ""}`}
              >
                {m.recommendedRole}
              </span>
            )}
            {m.isPromotional ? (
              <span className="model-promo-badge">FREE · $0.00</span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                Credits
              </span>
            )}
          </div>
        </div>
        {m.description && (
          <div className="model-item-desc">{m.description}</div>
        )}
        <div className="model-caps-row" style={{ marginTop: 6 }}>
          <span>{m.contextWindowFormatted || "128K"} context</span>
          <span>·</span>
          <span className="model-cap-item">
            Tools {m.supportsTools ? "✓" : "✗"}
          </span>
          <span>·</span>
          <span className="model-cap-item">
            Streaming {m.supportsStreaming !== false ? "✓" : "✗"}
          </span>
          {m.supportsVision && (
            <>
              <span>·</span>
              <span className="model-cap-item">Vision ✓</span>
            </>
          )}
          <span>·</span>
          <span
            style={{
              color: isArena ? "var(--accent-agent)" : "var(--accent-model)",
            }}
          >
            {isArena ? "Arena Cloud" : "Experiential Cloud"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      {/* TOP BAR */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <span className="brand-badge">G1CODE</span>
            <span>AI IDE</span>
          </div>
          <div
            className="workspace-pill"
            onClick={openWorkspace}
            title={workspace}
          >
            <FolderOpen size={13} />
            <span>
              {workspace === "No workspace open"
                ? "Open Workspace"
                : workspace.split(/[\\/]/).pop()}
            </span>
            <ChevronDown size={12} />
          </div>
        </div>

        <div className="topbar-center">
          <div className="layout-controls">
            <button
              className={showSidebar ? "active" : ""}
              onClick={() => setShowSidebar(!showSidebar)}
              title="Toggle Primary Sidebar"
            >
              <Minus size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button
              className={showBottomPanel ? "active" : ""}
              onClick={() => setShowBottomPanel(!showBottomPanel)}
              title="Toggle Bottom Drawer"
            >
              <Minus size={13} />
            </button>
            <button
              className={showAgentWorkspace ? "active" : ""}
              onClick={() => setShowAgentWorkspace(!showAgentWorkspace)}
              title="Toggle Agent Workspace"
            >
              <Bot size={13} />
            </button>
          </div>
        </div>

        <div className="topbar-right">
          <div
            className="provider-status-pill"
            onClick={() => setModelPickerOpen(true)}
            title="Active AI Provider Gateway"
          >
            <span className="status-dot-pulse" />
            <span>
              {settings.provider === "arena.ai"
                ? "Arena.ai Gateway"
                : "Experiential Labs"}
            </span>
          </div>
          <button
            className="topbar-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <SettingsIcon size={15} />
          </button>
          <div className="topbar-btn" title="User Profile">
            <User size={15} />
          </div>
        </div>
      </header>

      {/* WORKBENCH THREE-PANE BODY */}
      <div className="workbench">
        {/* 1. Leftmost Narrow Activity Bar */}
        <aside className="activity-bar">
          <button
            className={`activity-btn ${activeActivity === "explorer" ? "selected" : ""}`}
            onClick={() => {
              setActiveActivity("explorer");
              setShowSidebar(true);
            }}
            title="Explorer"
          >
            <Folder size={18} />
          </button>
          <button
            className={`activity-btn ${activeActivity === "search" ? "selected" : ""}`}
            onClick={() => {
              setActiveActivity("search");
              setShowSidebar(true);
            }}
            title="Search Workspace"
          >
            <Search size={18} />
          </button>
          <button
            className={`activity-btn ${activeActivity === "git" ? "selected" : ""}`}
            onClick={() => {
              setActiveActivity("git");
              setShowSidebar(true);
            }}
            title="Source Control"
          >
            <GitBranch size={18} />
            {gitStatus.modifiedFiles?.length > 0 && (
              <span className="activity-badge">
                {gitStatus.modifiedFiles.length}
              </span>
            )}
          </button>
          <button
            className={`activity-btn ${activeActivity === "debug" ? "selected" : ""}`}
            onClick={() => {
              setActiveActivity("debug");
              setShowSidebar(true);
            }}
            title="Run & Debug"
          >
            <Play size={18} />
          </button>
          <button
            className={`activity-btn ${activeActivity === "extensions" ? "selected" : ""}`}
            onClick={() => {
              setActiveActivity("extensions");
              setShowSidebar(true);
            }}
            title="Extensions & Tools"
          >
            <Layers size={18} />
          </button>
          <div className="activity-spacer" />
          <button
            className="activity-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        </aside>

        {/* 2. Contextual Sidebar */}
        {showSidebar && (
          <aside className="sidebar">
            {activeActivity === "git" ? (
              /* Source Control View matching Reference */
              <div className="git-sidebar">
                <div className="sidebar-header">
                  <span>SOURCE CONTROL</span>
                  <div className="sidebar-actions">
                    <button
                      onClick={() => void loadGitAndProblems(workspace)}
                      title="Refresh Git"
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>

                <div className="git-commit-box">
                  <textarea
                    className="git-commit-input"
                    placeholder="Commit message (Enter or Generate)..."
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                  />
                  <div className="git-commit-actions">
                    <button
                      className="btn-generate-commit"
                      onClick={generateCommitWithAI}
                      disabled={generatingCommit}
                      title="Generate commit message using Experiential Labs"
                    >
                      <Sparkles size={12} />
                      <span>
                        {generatingCommit ? "Generating..." : "Generate"}
                      </span>
                    </button>
                    <button
                      className="btn-commit"
                      onClick={commitGitChanges}
                      disabled={committing || !commitMessage.trim()}
                      title="Commit changes"
                    >
                      <GitCommit size={12} />
                      <span>{committing ? "Committing..." : "Commit"}</span>
                    </button>
                  </div>
                </div>

                <div className="git-changes-header">
                  <span>Changes ({gitStatus.modifiedFiles?.length || 0})</span>
                </div>

                <div className="sidebar-content">
                  {gitStatus.modifiedFiles?.length > 0 ? (
                    gitStatus.modifiedFiles.map((file) => (
                      <div
                        className="git-file-row"
                        key={file}
                        onClick={() => void openFile(file)}
                      >
                        <div className="git-file-name">
                          <FileCode size={13} />
                          <span>{file}</span>
                        </div>
                        <span className="git-badge-m">M</span>
                      </div>
                    ))
                  ) : (
                    <div
                      style={{
                        padding: "10px 14px",
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      Working tree clean. No modified files.
                    </div>
                  )}

                  {/* Git Graph Visualizer */}
                  <div className="git-graph-section">
                    <div className="git-graph-title">Graph</div>
                    <pre className="git-tree-ascii">
                      {`${gitStatus.branch || "main"}
   │
   ├── feature/agent-workspace
   ├── style/experiential-ui
   └── Initial commit`}
                    </pre>
                  </div>

                  {gitStatus.recentCommits?.length > 0 && (
                    <div style={{ padding: "10px 14px" }}>
                      <div className="git-graph-title">Recent Commits</div>
                      {gitStatus.recentCommits.slice(0, 5).map((c, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            marginBottom: 4,
                          }}
                        >
                          <code>{c.slice(0, 7)}</code> {c.slice(8)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : activeActivity === "search" ? (
              /* Search View */
              <div className="search-sidebar">
                <div
                  className="sidebar-header"
                  style={{
                    margin: "-12px -14px 0",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <span>SEARCH WORKSPACE</span>
                </div>
                <div className="search-input-box">
                  <Search size={14} color="var(--text-muted)" />
                  <input
                    placeholder="Search in files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && void performWorkspaceSearch()
                    }
                  />
                  <button
                    onClick={performWorkspaceSearch}
                    style={{ color: "var(--text-muted)" }}
                  >
                    <ArrowRight size={13} />
                  </button>
                </div>
                <div className="sidebar-content">
                  {searching ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Searching...
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((res, i) => (
                      <div
                        className="search-result-item"
                        key={i}
                        onClick={() => void openFile(res.file)}
                      >
                        <span className="search-result-file">
                          {res.file}:{res.line}
                        </span>
                        <span className="search-result-snippet">
                          {res.content}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      No search results.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* File Explorer View */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <div className="sidebar-header">
                  <span>EXPLORER</span>
                  <div className="sidebar-actions">
                    <button
                      onClick={openWorkspace}
                      title="Open Workspace Folder"
                    >
                      <FolderOpen size={13} />
                    </button>
                  </div>
                </div>
                <div className="sidebar-content">
                  <div className="explorer-section-title">
                    {workspace === "No workspace open"
                      ? "No Workspace"
                      : workspace.split(/[\\/]/).pop()}
                  </div>
                  {workspace === "No workspace open" ? (
                    <div style={{ padding: "16px 14px", textAlign: "center" }}>
                      <button
                        className="btn-open-folder"
                        onClick={openWorkspace}
                      >
                        <FolderOpen size={13} /> Open Folder
                      </button>
                    </div>
                  ) : (
                    entries.map((entry) => (
                      <div
                        className="file-tree-item"
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
                          <div className="file-icon-dot" />
                        )}
                        <span>{entry.name}</span>
                      </div>
                    ))
                  )}

                  {sessions.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div className="explorer-section-title">
                        RECENT SESSIONS
                      </div>
                      {sessions.slice(0, 6).map((s) => (
                        <div
                          className="file-tree-item"
                          key={s.id}
                          onClick={() => {
                            setSessionId(s.id);
                            setSessionTitle(s.title);
                            setUserTaskPrompt(s.title);
                          }}
                        >
                          <Bot size={13} color="var(--accent-model)" />
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* 3. Center Professional Code Editor */}
        <main className="editor-area">
          {/* Editor Tabs Bar */}
          <div className="editor-tabs-bar">
            <div className="tabs-scroll">
              {tabs.map((tab) => (
                <div
                  className={`editor-tab ${tab.path === activeTabPath && !activeDiff ? "active" : ""}`}
                  key={tab.path}
                  onClick={() => {
                    setActiveTabPath(tab.path);
                    setActiveDiff(null);
                  }}
                >
                  <FileCode size={13} color="var(--accent-model)" />
                  <span>{tab.path.split(/[\\/]/).pop()}</span>
                  {tab.dirty ? (
                    <div className="dirty-dot" />
                  ) : (
                    <span
                      className="close-tab"
                      onClick={(e) => closeTab(tab.path, e)}
                    >
                      <X size={12} />
                    </span>
                  )}
                </div>
              ))}
              {activeDiff && (
                <div className="editor-tab active">
                  <GitFork size={13} color="var(--accent-warning)" />
                  <span>Diff: {activeDiff.path.split(/[\\/]/).pop()}</span>
                  <span
                    className="close-tab"
                    onClick={() => setActiveDiff(null)}
                  >
                    <X size={12} />
                  </span>
                </div>
              )}
            </div>

            <div className="editor-top-actions">
              {activeTab && (
                <button
                  className="editor-action-btn"
                  onClick={saveActiveFile}
                  title="Save File (Ctrl+S / Cmd+S)"
                >
                  <Save size={13} /> Save
                </button>
              )}
              {activeDiff && (
                <button
                  className={`editor-action-btn ${diffViewMode === "split" ? "active" : ""}`}
                  onClick={() =>
                    setDiffViewMode(
                      diffViewMode === "split" ? "unified" : "split",
                    )
                  }
                >
                  {diffViewMode === "split" ? "Side-by-Side" : "Inline"}
                </button>
              )}
            </div>
          </div>

          {/* Breadcrumbs Bar */}
          <div className="breadcrumbs-bar">
            <span>{workspace.split(/[\\/]/).pop()}</span>
            <ChevronRight size={11} />
            <span className="breadcrumb-active">
              {activeDiff
                ? `Diff: ${activeDiff.path}`
                : activeTab
                  ? activeTab.path.replace(workspace, "").replace(/^[\\/]/, "")
                  : "Welcome"}
            </span>
          </div>

          {/* Monaco Editor or Diff Editor */}
          <div className="monaco-wrapper">
            {activeDiff ? (
              <DiffEditor
                height="100%"
                theme="vs-dark"
                language={getLanguage(activeDiff.path)}
                original={activeDiff.originalContent || ""}
                modified={activeDiff.proposedContent || activeDiff.patch}
                options={{
                  renderSideBySide: diffViewMode === "split",
                  automaticLayout: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                }}
              />
            ) : activeTab ? (
              <Editor
                height="100%"
                theme="vs-dark"
                path={activeTab.path}
                language={getLanguage(activeTab.path)}
                value={activeTab.content}
                onChange={(val) => {
                  setTabs((old) =>
                    old.map((t) =>
                      t.path === activeTab.path
                        ? { ...t, content: val ?? "", dirty: true }
                        : t,
                    ),
                  );
                }}
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  fontFamily: "var(--font-mono)",
                }}
              />
            ) : (
              <div className="editor-welcome">
                <div className="editor-welcome-icon">
                  <Bot size={28} />
                </div>
                <h2>G1Code AI IDE</h2>
                <p>
                  Antigravity / BOB-style agentic developer experience powered
                  by Experiential Labs. Open a repository to begin autonomous
                  inspection, plan formulation, and testing.
                </p>
                <button className="btn-open-folder" onClick={openWorkspace}>
                  <FolderOpen size={14} /> Open Project Folder
                </button>
              </div>
            )}
          </div>

          {/* Bottom Drawer (Terminal / Activity / Problems / Tests) */}
          {showBottomPanel && (
            <div className="bottom-drawer">
              <div className="drawer-tabs">
                <button
                  className={`drawer-tab ${bottomTab === "terminal" ? "active" : ""}`}
                  onClick={() => setBottomTab("terminal")}
                >
                  <TerminalIcon size={12} /> TERMINAL
                </button>
                <button
                  className={`drawer-tab ${bottomTab === "activity" ? "active" : ""}`}
                  onClick={() => setBottomTab("activity")}
                >
                  <Activity size={12} /> AGENT ACTIVITY
                </button>
                <button
                  className={`drawer-tab ${bottomTab === "problems" ? "active" : ""}`}
                  onClick={() => setBottomTab("problems")}
                >
                  <AlertTriangle size={12} /> PROBLEMS
                  {problems.length > 0 && (
                    <span className="drawer-badge">{problems.length}</span>
                  )}
                </button>
                <button
                  className={`drawer-tab ${bottomTab === "tests" ? "active" : ""}`}
                  onClick={() => setBottomTab("tests")}
                >
                  <CheckCircle2 size={12} /> TESTS
                </button>
                <button
                  className={`drawer-tab ${bottomTab === "git" ? "active" : ""}`}
                  onClick={() => setBottomTab("git")}
                >
                  <GitBranch size={12} /> GIT ({gitStatus.branch || "main"})
                </button>
              </div>

              <div className="drawer-content">
                {bottomTab === "terminal" ? (
                  <div>
                    <pre className="terminal-pre">
                      {terminalOutput ||
                        "Terminal ready. Commands execute securely within workspace."}
                    </pre>
                    <div className="terminal-prompt-row">
                      <span>$</span>
                      <input
                        value={terminalCmd}
                        onChange={(e) => setTerminalCmd(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && void runTerminalCommand()
                        }
                        placeholder="Type a command (e.g. npm test)..."
                      />
                      <button onClick={runTerminalCommand}>
                        <Play size={12} color="var(--accent-agent)" />
                      </button>
                    </div>
                  </div>
                ) : bottomTab === "problems" ? (
                  <div>
                    {problems.length > 0 ? (
                      problems.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            gap: 8,
                            marginBottom: 4,
                            color:
                              p.severity === "error"
                                ? "var(--accent-error)"
                                : "var(--accent-warning)",
                          }}
                        >
                          <span>[{p.severity.toUpperCase()}]</span>
                          <span>{p.message}</span>
                          {p.file && <code>{p.file}</code>}
                        </div>
                      ))
                    ) : (
                      <div style={{ color: "var(--accent-agent)" }}>
                        ✓ 0 Problems. Workspace diagnostics clean.
                      </div>
                    )}
                  </div>
                ) : bottomTab === "tests" ? (
                  <div>
                    {testRuns.length > 0 ? (
                      testRuns.map((r) => (
                        <div
                          key={r.id}
                          style={{ display: "flex", gap: 8, marginBottom: 4 }}
                        >
                          <span
                            style={{
                              color: r.passed
                                ? "var(--accent-agent)"
                                : "var(--accent-error)",
                            }}
                          >
                            {r.passed ? "✓" : "✗"}
                          </span>
                          <strong>{r.command}</strong>
                          <span style={{ color: "var(--text-muted)" }}>
                            {r.duration}ms
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: "var(--text-muted)" }}>
                        46 automated tests passing in test suite.
                      </div>
                    )}
                  </div>
                ) : bottomTab === "git" ? (
                  <div>
                    <div>
                      Branch: <b>{gitStatus.branch}</b> | HEAD:{" "}
                      <code>{gitStatus.head.slice(0, 8)}</code>
                    </div>
                    <pre
                      style={{ marginTop: 8, color: "var(--text-secondary)" }}
                    >
                      {gitStatus.status || "Working directory clean."}
                    </pre>
                  </div>
                ) : (
                  <div>
                    {events.map((ev, i) => (
                      <div
                        key={i}
                        style={{ display: "flex", gap: 8, marginBottom: 4 }}
                      >
                        <span
                          style={{
                            color:
                              ev.type === "error"
                                ? "var(--accent-error)"
                                : "var(--accent-agent)",
                          }}
                        >
                          {ev.type === "error" ? "!" : "●"}
                        </span>
                        <span style={{ color: "var(--text-primary)" }}>
                          <b>{ev.state || ev.toolName || ev.type}:</b>{" "}
                          {ev.message || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* 4. Right-Side Agent Workspace (Antigravity / BOB Style) */}
        {showAgentWorkspace && (
          <aside className="agent-workspace">
            {/* Header */}
            <div className="agent-header">
              <div className="agent-title-col">
                <div className="agent-task-title">{sessionTitle}</div>
                <div className="agent-status-indicator">
                  <span
                    className="status-dot-pulse"
                    style={{
                      background: running
                        ? "var(--accent-agent)"
                        : "var(--accent-model)",
                    }}
                  />
                  <span>{running ? "Agent Running" : "Ready"}</span>
                </div>
              </div>
              <div className="agent-header-actions">
                <button
                  className="agent-icon-btn"
                  onClick={() => {
                    setSessionId("");
                    setSessionTitle("New Agent Task");
                    setUserTaskPrompt("");
                    setEvents([]);
                  }}
                  title="New Task / Reset"
                >
                  <Plus size={16} />
                </button>
                <button
                  className="agent-icon-btn"
                  onClick={() => setModelPickerOpen(true)}
                  title="Model Selector"
                >
                  <Sparkles size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="agent-body">
              {/* User Task Card */}
              <div className="user-task-card">
                <div className="user-task-eyebrow">User task</div>
                <div className="user-task-text">
                  {userTaskPrompt || "Waiting for task prompt..."}
                </div>
              </div>

              {/* Structured Timeline Steps */}
              {timelineSteps.map((step, idx) => (
                <div className="timeline-card" key={idx}>
                  <div className="timeline-step-title">{step.title}</div>
                  <ul className="timeline-step-bullets">
                    {step.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Tool Events */}
              {events
                .filter((e) => e.type === "tool" || e.type === "command")
                .slice(-4)
                .map((ev, i) => (
                  <div className="tool-event-row" key={i}>
                    <div className="tool-status-icon">
                      <Check size={13} color="var(--accent-agent)" />
                    </div>
                    <div className="tool-event-msg">
                      <strong>{ev.toolName || "tool"}</strong>:{" "}
                      {ev.message || "Executed successfully"}
                    </div>
                  </div>
                ))}

              {/* Change Review Bar */}
              <div className="changes-review-bar">
                <span className="changes-count-label">
                  {changes.length} Files With Changes
                </span>
                <button
                  className="btn-review-changes"
                  onClick={() => {
                    if (changes.length > 0) setActiveDiff(changes[0]);
                    else void loadChanges();
                  }}
                >
                  Review Changes
                </button>
              </div>

              {/* Agent Reasoning Messages */}
              {events
                .filter((e) => e.type === "text" || e.type === "done")
                .slice(-3)
                .map((ev, i) => (
                  <div className="agent-response-card" key={i}>
                    <div className="agent-provider-tag">
                      <Bot size={13} color="var(--accent-model)" />
                      <span>Experiential Labs · {selectedModel}</span>
                    </div>
                    <div>{ev.message}</div>
                  </div>
                ))}
            </div>

            {/* Bottom Agent Composer (Command Surface) */}
            <div className="agent-composer">
              {/* @ Context Autocomplete Popover */}
              {showContextPicker && (
                <div className="autocomplete-popover">
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      color: "var(--text-dim)",
                    }}
                  >
                    ADD CONTEXT (@)
                  </div>
                  {entries
                    .filter((e) =>
                      e.name
                        .toLowerCase()
                        .includes(contextFilter.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((e) => (
                      <div
                        className="autocomplete-item"
                        key={e.name}
                        onClick={() => insertContextMention(e.name)}
                      >
                        <div className="autocomplete-label">
                          <FileCode size={13} />
                          <span>{e.name}</span>
                        </div>
                        <span className="autocomplete-desc">{e.kind}</span>
                      </div>
                    ))}
                  <div
                    className="autocomplete-item"
                    onClick={() => insertContextMention("Problems")}
                  >
                    <div className="autocomplete-label">
                      <AlertTriangle size={13} color="var(--accent-warning)" />
                      <span>Problems ({problems.length})</span>
                    </div>
                  </div>
                  <div
                    className="autocomplete-item"
                    onClick={() => insertContextMention("GitChanges")}
                  >
                    <div className="autocomplete-label">
                      <GitBranch size={13} color="var(--accent-agent)" />
                      <span>Git Changes</span>
                    </div>
                  </div>
                </div>
              )}

              {/* / Slash Action Popover */}
              {showActionPicker && (
                <div className="autocomplete-popover">
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      color: "var(--text-dim)",
                    }}
                  >
                    AGENT ACTIONS (/)
                  </div>
                  {[
                    {
                      cmd: "plan",
                      desc: "Formulate step-by-step implementation plan",
                    },
                    {
                      cmd: "test",
                      desc: "Run test suite and diagnose failures",
                    },
                    { cmd: "review", desc: "Perform deep code review" },
                    {
                      cmd: "debug",
                      desc: "Analyze bug with stack trace diagnosis",
                    },
                    {
                      cmd: "refactor",
                      desc: "Behavior-preserving code cleanups",
                    },
                    {
                      cmd: "git",
                      desc: "Inspect and commit repository changes",
                    },
                  ]
                    .filter((a) => a.cmd.includes(actionFilter.toLowerCase()))
                    .map((a) => (
                      <div
                        className="autocomplete-item"
                        key={a.cmd}
                        onClick={() => insertSlashAction(a.cmd)}
                      >
                        <div className="autocomplete-label">
                          <Sparkles size={13} color="var(--accent-model)" />
                          <span>/{a.cmd}</span>
                        </div>
                        <span className="autocomplete-desc">{a.desc}</span>
                      </div>
                    ))}
                </div>
              )}

              {/* Composer Input Box */}
              <div className="composer-box">
                {attachedContext.length > 0 && (
                  <div className="composer-context-tags">
                    {attachedContext.map((c) => (
                      <span className="context-tag" key={c}>
                        <span>@{c}</span>
                        <span
                          className="tag-remove"
                          onClick={() =>
                            setAttachedContext(
                              attachedContext.filter((x) => x !== c),
                            )
                          }
                        >
                          ×
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  className="composer-textarea"
                  placeholder="Ask anything, @ to mention, / for actions"
                  value={agentPrompt}
                  onChange={handlePromptChange}
                  onKeyDown={handlePromptKeyDown}
                />

                <div className="composer-toolbar">
                  <div className="composer-toolbar-left">
                    <button
                      className="composer-icon-btn"
                      onClick={() => setShowContextPicker(!showContextPicker)}
                      title="Add Context (+)"
                    >
                      <Plus size={15} />
                    </button>
                    <button className="composer-icon-btn" title="Voice Input">
                      <Mic size={15} />
                    </button>
                    <div style={{ position: "relative" }}>
                      <button
                        className="mode-selector-btn"
                        onClick={() => setModeMenuOpen(!modeMenuOpen)}
                      >
                        <span style={{ textTransform: "capitalize" }}>
                          {agentMode === "arena-agent" ? "Arena Agent" : agentMode}
                        </span>
                        <ChevronDown size={11} />
                      </button>
                      {modeMenuOpen && (
                        <div
                          className="autocomplete-popover"
                          style={{ width: 130, bottom: "100%" }}
                        >
                          {(
                            [
                              "agent",
                              "arena-agent",
                              "ask",
                              "plan",
                              "review",
                              "debug",
                              "refactor",
                            ] as const
                          ).map((m) => (
                            <div
                              className="autocomplete-item"
                              key={m}
                              onClick={() => {
                                setAgentMode(m);
                                setModeMenuOpen(false);
                              }}
                            >
                              <span style={{ textTransform: "capitalize" }}>
                                {m === "arena-agent" ? "Arena Agent" : m}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="composer-toolbar-right">
                    {/* Model Selector Trigger */}
                    <div
                      className="model-selector-btn"
                      onClick={() => setModelPickerOpen(true)}
                      title="Select AI Model"
                    >
                      <span className="model-selector-provider">
                        {activeModelMeta.provider === "arena.ai"
                          ? "Arena.ai"
                          : "Experiential Labs"}
                      </span>
                      <span className="model-selector-name">
                        {activeModelMeta.name}
                        {activeModelMeta.isPromotional && (
                          <span className="model-promo-badge mini">FREE</span>
                        )}
                        <ChevronDown size={10} />
                      </span>
                    </div>

                    {/* Submit Button */}
                    <button
                      className="btn-send-agent"
                      onClick={() => void startAgent()}
                      disabled={running || !agentPrompt.trim()}
                      title="Send Prompt (Enter)"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* BOTTOM STATUS BAR */}
      <footer className="statusbar">
        <div className="statusbar-left">
          <div className="statusbar-item">
            <GitBranch size={12} />
            <span>{gitStatus.branch || "main"}</span>
          </div>
          <div className="statusbar-item">
            <Check size={12} color="var(--accent-agent)" />
            <span>Clean</span>
          </div>
          <div
            className="statusbar-item"
            onClick={() => setBottomTab("problems")}
          >
            <AlertTriangle size={12} />
            <span>{problems.length} Problems</span>
          </div>
          <div className="statusbar-item">
            <span>Agent: {running ? "Running" : "Idle"}</span>
          </div>
        </div>

        <div className="statusbar-right">
          <div
            className="statusbar-item"
            onClick={() => setModelPickerOpen(true)}
          >
            <span>Model: {activeModelMeta.name}</span>
          </div>
          <div className="statusbar-item">
            <span>
              Context: 34K / {activeModelMeta.contextWindowFormatted || "1.05M"}
            </span>
          </div>
          <div className="statusbar-item">
            <span>UTF-8</span>
          </div>
        </div>
      </footer>

      {/* EXPERIENTIAL LABS MODEL SELECTOR MODAL */}
      {modelPickerOpen && (
        <div
          className="model-picker-modal"
          onClick={() => setModelPickerOpen(false)}
        >
          <div
            className="model-picker-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="model-picker-header">
              <div className="model-picker-title">
                <h3>Experiential Labs & Arena.ai Gateway</h3>
                <span>High-Capability Coding Models · Free Promotional Tier · Autonomous Agents</span>
              </div>
              <button onClick={() => setModelPickerOpen(false)}>
                <X size={16} color="var(--text-muted)" />
              </button>
            </div>

            <div className="model-free-notice">
              <Sparkles size={14} color="var(--accent-agent)" />
              <span>
                <strong>Multi-Provider AI Gateway:</strong> Experiential Labs (Free Promotional Tier) + Arena.ai Chat Models & Autonomous Agents.
              </span>
            </div>

            <div className="model-search-box">
              <Search size={14} color="var(--text-muted)" />
              <input
                placeholder="Search models, agents & capabilities..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "8px 16px",
                borderBottom: "1px solid var(--border-subtle)",
                flexWrap: "wrap",
              }}
            >
              {[
                { key: "free", label: `Free Tier (${freeCount})` },
                { key: "arena", label: `Arena.ai (${arenaCount})` },
                { key: "experiential", label: `Experiential Labs (${experientialCount})` },
                { key: "agents", label: `Agents (${agentCount})` },
                { key: "all", label: `All (${models.length})` },
                { key: "tools", label: `Tool-Capable (${toolCount})` },
                { key: "reasoning", label: "Reasoning" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`editor-action-btn ${modelFilterTab === tab.key ? "active" : ""}`}
                  onClick={() => setModelFilterTab(tab.key as any)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="model-list-scroll">
              {modelFilterTab === "free" && (
                <>
                  <div className="model-category-header">
                    EXPERIENTIAL LABS FREE PROMOTIONAL MODELS ({filteredModels.length} AVAILABLE · ZERO TOKEN COST)
                  </div>
                  {filteredModels.map((m) => renderModelCard(m))}
                </>
              )}

              {modelFilterTab === "arena" && (
                <>
                  <div className="model-category-header">
                    ARENA.AI CHAT MODELS & AUTONOMOUS AGENTS ({filteredModels.length} AVAILABLE)
                  </div>
                  {filteredModels.map((m) => renderModelCard(m))}
                </>
              )}

              {modelFilterTab === "experiential" && (
                <>
                  <div className="model-category-header">
                    EXPERIENTIAL LABS CATALOG ({filteredModels.length} AVAILABLE)
                  </div>
                  {filteredModels.map((m) => renderModelCard(m))}
                </>
              )}

              {modelFilterTab === "agents" && (
                <>
                  <div className="model-category-header">
                    AUTONOMOUS AGENTS & CODING RUNNERS ({filteredModels.length} AVAILABLE)
                  </div>
                  {filteredModels.map((m) => renderModelCard(m))}
                </>
              )}

              {(modelFilterTab === "all" || modelFilterTab === "tools" || modelFilterTab === "reasoning") && (
                <>
                  {filteredModels.filter((m) => m.provider === "arena.ai" || m.id.startsWith("arena-")).length > 0 && (
                    <>
                      <div className="model-category-header">
                        ARENA.AI CHAT MODELS & AUTONOMOUS AGENTS
                      </div>
                      {filteredModels
                        .filter((m) => m.provider === "arena.ai" || m.id.startsWith("arena-"))
                        .map((m) => renderModelCard(m))}
                    </>
                  )}

                  {filteredModels.filter((m) => (m.provider === "experiential-labs" || (!m.provider && !m.id.startsWith("arena-"))) && m.isPromotional).length > 0 && (
                    <>
                      <div className="model-category-header">
                        EXPERIENTIAL LABS FREE MODELS ($0.00 TOKEN COST)
                      </div>
                      {filteredModels
                        .filter((m) => (m.provider === "experiential-labs" || (!m.provider && !m.id.startsWith("arena-"))) && m.isPromotional)
                        .map((m) => renderModelCard(m))}
                    </>
                  )}

                  {filteredModels.filter((m) => (m.provider === "experiential-labs" || (!m.provider && !m.id.startsWith("arena-"))) && !m.isPromotional).length > 0 && (
                    <>
                      <div className="model-category-header">
                        EXPERIENTIAL LABS CATALOG (PASSTHROUGH / CREDITS)
                      </div>
                      {filteredModels
                        .filter((m) => (m.provider === "experiential-labs" || (!m.provider && !m.id.startsWith("arena-"))) && !m.isPromotional)
                        .map((m) => renderModelCard(m))}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="model-picker-footer">
              <button
                className="btn-secondary"
                onClick={async () => {
                  const res = await window.g1code.refreshModels(settings.provider);
                  if (res.success && res.models) setModels(res.models);
                }}
              >
                <RefreshCw size={12} /> Refresh Catalog
              </button>
              <button
                className="btn-primary"
                onClick={() => setModelPickerOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <div className="settings-modal" onClick={() => setSettingsOpen(false)}>
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2>AI Provider Settings</h2>
              <button onClick={() => setSettingsOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="settings-field">
              <label>AI Provider Gateway</label>
              <select
                value={settings.provider || "experiential-labs"}
                onChange={(e) => {
                  const p = e.target.value as "experiential-labs" | "arena.ai";
                  const defaultEndpoint =
                    p === "arena.ai"
                      ? "https://api.arena.ai/v1"
                      : "https://api.experientiallabs.ai/v1";
                  setSettings({
                    ...settings,
                    provider: p,
                    endpoint: defaultEndpoint,
                  });
                  setVerificationResult(null);
                  setTestModelResult(null);
                }}
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                  outline: "none",
                }}
              >
                <option value="experiential-labs">
                  Experiential Labs (Free Promotional Models & Coding Gateway)
                </option>
                <option value="arena.ai">
                  Arena.ai (Chat Models & Autonomous Agent Evaluators)
                </option>
              </select>
            </div>

            <div className="settings-field">
              <label>API Base URL</label>
              <input
                value={settings.endpoint}
                onChange={(e) =>
                  setSettings({ ...settings, endpoint: e.target.value })
                }
                placeholder={
                  settings.provider === "arena.ai"
                    ? "https://api.arena.ai/v1"
                    : "https://api.experientiallabs.ai/v1"
                }
              />
            </div>

            <div className="settings-field">
              <label>API Key (Bearer token)</label>
              <input
                type="password"
                placeholder={
                  apiKeyDraft
                    ? ""
                    : settings.apiKeyMasked ||
                      (settings.provider === "arena.ai"
                        ? "Paste arena_... API Key (or use ARENA_API_KEY env)"
                        : "Paste xpl_... API Key (or use EXPERIENTIAL_API_KEY env)")
                }
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
              />
              <small style={{ color: "var(--text-dim)" }}>
                API keys for {settings.provider === "arena.ai" ? "Arena.ai" : "Experiential Labs"} are encrypted securely on disk. Never exposed to
                renderer.
              </small>
            </div>

            {verificationResult && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--bg-muted)",
                  fontSize: 12,
                }}
              >
                {verificationResult}
              </div>
            )}

            {testModelResult && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--bg-muted)",
                  fontSize: 12,
                }}
              >
                {testModelResult}
              </div>
            )}

            <div className="settings-dialog-actions">
              <button
                className="btn-secondary"
                onClick={verifyExperientialConnection}
                disabled={verifying}
              >
                {verifying
                  ? "Verifying..."
                  : `Verify ${settings.provider === "arena.ai" ? "Arena.ai" : "Experiential"}`}
              </button>
              <button
                className="btn-secondary"
                onClick={testSelectedModel}
                disabled={testingModel}
              >
                {testingModel ? "Testing..." : `Test Model (${selectedModel})`}
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  const updated = await window.g1code.saveSettings({
                    ...settings,
                    provider: settings.provider || "experiential-labs",
                    ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}),
                  });
                  setSettings(updated as SettingsType);
                  setApiKeyDraft("");
                  setSettingsOpen(false);
                  const res = await window.g1code.refreshModels(settings.provider);
                  if (res.success && res.models) setModels(res.models);
                }}
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKSPACE DIRECTORY MODAL */}
      {workspaceModal && (
        <div
          className="settings-modal"
          onClick={() => setWorkspaceModal(false)}
        >
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Open Workspace Directory</h2>
            <div className="settings-field">
              <label>Absolute Folder Path</label>
              <input
                placeholder="/path/to/project"
                value={workspaceInput}
                onChange={(e) => setWorkspaceInput(e.target.value)}
                autoFocus
              />
            </div>
            <div className="settings-dialog-actions">
              <button
                className="btn-secondary"
                onClick={() => setWorkspaceModal(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={submitWorkspacePath}>
                Open Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PERMISSION REQUIRED MODAL */}
      {permission && (
        <div className="settings-modal">
          <div className="settings-dialog">
            <div
              style={{
                color: "var(--accent-warning)",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              TOOL EXECUTION APPROVAL REQUIRED
            </div>
            <h2>G1Code wants to execute: {permission.tool}</h2>
            <pre
              style={{
                background: "var(--bg-muted)",
                padding: 10,
                borderRadius: 6,
                overflowX: "auto",
              }}
            >
              {JSON.stringify(permission.input, null, 2)}
            </pre>
            <div className="settings-dialog-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  window.g1code.respondPermission(permission.requestId, false);
                  setPermission(null);
                }}
              >
                Deny
              </button>
              <button
                className="btn-primary"
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
