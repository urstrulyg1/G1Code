import "./api-client";
import React, { useEffect, useState, useRef, useCallback } from "react";
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
  Clock,
  Command,
  Edit3,
  FileCode,
  Folder,
  FolderOpen,
  ExternalLink,
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
  Zap,
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
  changeId?: string;
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
  pricingFormatted?: string;
  pricingDetails?: {
    input?: number;
    output?: number;
  };
  recommendedRole?: string;
  description?: string;
  apiRank?: number;
};

// ─── Lightweight Markdown Renderer ──────────────────────────────────────────
// Renders the subset of Markdown that Bob/AI models typically produce:
// fenced code blocks, inline code, bold, italic, headers, ordered/unordered
// lists, blockquotes, horizontal rules, and plain text with file-path links.
function renderMarkdown(
  text: string,
  openFile: (path: string) => void,
  workspace: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let keyIdx = 0;
  const key = () => keyIdx++;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <div className="md-code-block" key={key()}>
          {lang && <div className="md-code-lang">{lang}</div>}
          <pre><code>{codeLines.join("\n")}</code></pre>
        </div>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      nodes.push(<Tag className={`md-h${level}`} key={key()}>{inlineMarkdown(headingMatch[2], openFile, workspace, key)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr className="md-hr" key={key()} />);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote className="md-blockquote" key={key()}>
          {quoteLines.map((ql, qi) => <span key={qi}>{inlineMarkdown(ql, openFile, workspace, key)}<br /></span>)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      nodes.push(
        <ul className="md-ul" key={key()}>
          {items.map((item, ii) => <li key={ii}>{inlineMarkdown(item, openFile, workspace, key)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      nodes.push(
        <ol className="md-ol" key={key()}>
          {items.map((item, ii) => <li key={ii}>{inlineMarkdown(item, openFile, workspace, key)}</li>)}
        </ol>
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === "") {
      nodes.push(<div className="md-spacer" key={key()} />);
      i++;
      continue;
    }

    // Paragraph
    nodes.push(
      <p className="md-p" key={key()}>
        {inlineMarkdown(line, openFile, workspace, key)}
      </p>
    );
    i++;
  }

  return nodes;
}

function inlineMarkdown(
  text: string,
  openFile: (path: string) => void,
  workspace: string,
  key: () => number,
): React.ReactNode {
  // Split on inline code, bold, italic, and file paths
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|\/[\w./\-]+\.[a-z]{1,5})/g;
  const parts = text.split(pattern);
  return parts.map((part) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code className="md-inline-code" key={key()}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key()}>{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={key()}>{part.slice(1, -1)}</em>;
    }
    if (/^\/[\w./\-]+\.[a-z]{1,5}$/.test(part) && workspace !== "No workspace open") {
      return (
        <span
          key={key()}
          className="agent-file-link"
          onClick={() => void openFile(part.replace(workspace + "/", ""))}
          title={`Open ${part}`}
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={key()}>{part}</React.Fragment>;
  });
}
// ─────────────────────────────────────────────────────────────────────────────

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

  // Draggable Tile Layout Dimensions (Antigravity Style)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("g1code_sidebar_width");
    return saved ? Math.max(160, Math.min(600, Number(saved))) : 270;
  });
  const [agentWidth, setAgentWidth] = useState(() => {
    const saved = localStorage.getItem("g1code_agent_width");
    return saved ? Math.max(280, Math.min(900, Number(saved))) : 410;
  });
  const [drawerHeight, setDrawerHeight] = useState(() => {
    const saved = localStorage.getItem("g1code_drawer_height");
    return saved ? Math.max(80, Math.min(650, Number(saved))) : 220;
  });
  const [resizingPane, setResizingPane] = useState<"sidebar" | "agent" | "drawer" | null>(null);
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);

  // Keep workspaceRef in sync so closures always see the latest workspace
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    try {
      localStorage.setItem("g1code_sidebar_width", String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("g1code_agent_width", String(agentWidth));
    } catch {}
  }, [agentWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("g1code_drawer_height", String(drawerHeight));
    } catch {}
  }, [drawerHeight]);

  // Drag Sidebar (Left Tile Splitter)
  const startResizingSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizingPane("sidebar");
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const nextW = Math.max(160, Math.min(window.innerWidth * 0.45, startW + delta));
      setSidebarWidth(Math.round(nextW));
    };

    const onMouseUp = () => {
      setResizingPane(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  // Drag Agent Workspace (Right Tile Splitter)
  const startResizingAgent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizingPane("agent");
    const startX = e.clientX;
    const startW = agentWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // dragging left expands width
      const nextW = Math.max(280, Math.min(window.innerWidth * 0.65, startW + delta));
      setAgentWidth(Math.round(nextW));
    };

    const onMouseUp = () => {
      setResizingPane(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [agentWidth]);

  // Drag Bottom Drawer (Bottom Tile Splitter)
  const startResizingDrawer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizingPane("drawer");
    const startY = e.clientY;
    const startH = drawerHeight;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY; // dragging up increases height
      const nextH = Math.max(80, Math.min(window.innerHeight * 0.75, startH + delta));
      setDrawerHeight(Math.round(nextH));
    };

    const onMouseUp = () => {
      setResizingPane(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [drawerHeight]);

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
  const [sessionTitle, setSessionTitle] = useState("");
  const [userTaskPrompt, setUserTaskPrompt] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMode, setAgentMode] = useState<
    "agent" | "ask" | "plan" | "review" | "debug" | "refactor"
  >("agent");
  const [events, setEvents] = useState<Event[]>([]);
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
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  // Track which activity groups are expanded (by group index key)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Structured Timeline (retired fake state — now driven by real events)
  // keep a ref to the last submitted prompt for Retry
  const lastPromptRef = useRef<string>("");
  const workspaceRef = useRef<string>(workspace);
  const agentBodyRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLPreElement>(null);

  // Experiential Labs Provider & Models (Dynamically loaded directly from ExperientialLabs.ai)
  const [settings, setSettings] = useState<SettingsType>({
    provider: "experiential-labs",
    endpoint: "https://api.experientiallabs.ai/v1",
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  });
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFilterTab, setModelFilterTab] = useState<
    "all" | "free" | "coding" | "reasoning" | "fast" | "balanced" | "tools"
  >("free");

  // Usage limits tracking for Experiential Labs free models
  const [usageLimits, setUsageLimits] = useState<
    Record<
      string,
      {
        modelId: string;
        name: string;
        hourlyLimit: number;
        hourlyUsed: number;
        hourlyResetAt: number;
        dailyLimit: number;
        dailyUsed: number;
        dailyResetAt: number;
        isLimitReached: boolean;
        limitType?: "hourly" | "daily";
      }
    >
  >({});
  const [, setTicker] = useState(0);

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

  // Dynamic free models & usage limits refresh loop (refreshes every 30s while G1Code is running)
  useEffect(() => {
    let isMounted = true;

    const refreshCatalogAndLimits = async () => {
      try {
        const getFn = window.g1code.getFreeModels || window.g1code.getModels;
        const [fetchedModels, limits] = await Promise.all([
          getFn("experiential-labs").catch(() => []),
          window.g1code.getUsageLimits
            ? window.g1code.getUsageLimits().catch(() => null)
            : Promise.resolve(null),
        ]);

        if (!isMounted) return;

        if (limits) {
          setUsageLimits(limits);
        }

        if (Array.isArray(fetchedModels) && fetchedModels.length > 0) {
          setModels(fetchedModels);

          setSelectedModel((current) => {
            const currentLimit = limits ? limits[current] : undefined;
            // Current model must: (1) still be in the live free catalog, (2) have zero-cost
            // pricing confirmed by API, and (3) not have hit its usage limit
            const isCurrentValid =
              Boolean(current) &&
              fetchedModels.some((m) => {
                if (m.id !== current) return false;
                if (currentLimit?.isLimitReached) return false;
                // Only remain selected if pricing is still confirmed as $0/$0
                return (
                  m.pricingType === "free" &&
                  (m as ModelItem).pricingDetails?.input === 0 &&
                  (m as ModelItem).pricingDetails?.output === 0
                );
              });

            if (isCurrentValid) return current;

            // Automatically switch to the next best available free model based on API ranking:
            const candidateFreeModels = fetchedModels.filter((m) => {
              if (m.pricingType !== "free") return false;
              if ((m as ModelItem).pricingDetails?.input !== 0) return false;
              if ((m as ModelItem).pricingDetails?.output !== 0) return false;
              const l = limits ? limits[m.id] : undefined;
              return !l?.isLimitReached;
            });

            const nextBest =
              candidateFreeModels.find((m) => m.id !== current) ||
              candidateFreeModels[0];

            if (nextBest) {
              return nextBest.id;
            }

            // If all free models are usage-limited, select first confirmed free model
            const anyFree = fetchedModels.find(
              (m) =>
                m.pricingType === "free" &&
                (m as ModelItem).pricingDetails?.input === 0 &&
                (m as ModelItem).pricingDetails?.output === 0,
            );

            return anyFree?.id || "";
          });
        }
      } catch (err) {
        console.warn("[G1Code] 30s model availability sync error:", err);
      }
    };

    // Initial fetch
    void refreshCatalogAndLimits();

    // Refresh model availability every 30 seconds while G1Code is running
    const intervalId = setInterval(refreshCatalogAndLimits, 30_000);
    // Ticker forces re-render each second so "resets in Xs" countdown updates
    const tickId = setInterval(() => setTicker((n) => n + 1), 1_000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      clearInterval(tickId);
    };
  }, []);

  // Load initial settings, workspace, git & problems
  useEffect(() => {
    void window.g1code.getSettings().then((s) => {
      setSettings(s);
      if (s.model) {
        setSelectedModel((current) => current || s.model);
      }
    });

    // Auto-initialize active workspace from backend server if available
    if (window.g1code.getCurrentWorkspace) {
      void window.g1code.getCurrentWorkspace().then(async (ws) => {
        if (ws && ws !== "No workspace open") {
          setWorkspace(ws);
          setWorkspaceInput(ws);
          try {
            const list = await window.g1code.listDirectory(ws);
            setEntries(list);
            const sess = await window.g1code.listSessions(ws);
            setSessions(sess);
            void loadGitAndProblems(ws);
          } catch {
            // ignore
          }
        }
      });
    }

    const offEvent = window.g1code.onAgentEvent((value) => {
      const event = value as Event;
      setEvents((old) => {
        // Accumulate streaming text into the active text message
        if (event.type === "text" && event.message) {
          const last = old[old.length - 1];
          if (last && last.type === "text") {
            return [
              ...old.slice(0, -1),
              { ...last, message: (last.message || "") + event.message },
            ];
          }
        }
        return [...old, event];
      });

      if (
        event.type === "done" ||
        event.type === "error" ||
        ["COMPLETED", "FAILED", "STOPPED", "CANCELLED"].includes(
          event.state ?? "",
        )
      ) {
        setRunning(false);
        // Refresh changes and git status on completion — use ref to avoid stale closure
        void loadChanges();
        void loadGitAndProblems(workspaceRef.current);
      }
      if (event.state === "WAITING_FOR_CHANGE_APPROVAL") {
        void loadChanges();
      }
      if (event.type === "command" && event.message) {
        setTerminalOutput(
          (old) => `${old}${event.message!.replace(/^COMMAND_[A-Z]+ /, "")}\n`,
        );
        setBottomTab("terminal");
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
      void reloadOpenTabs();
    } catch {
      // ignore
    }
  };

  const openNativeProjectFolder = async () => {
    try {
      if (window.g1code?.openNativeFolder) {
        const targetPath =
          workspace && workspace !== "No workspace open" ? workspace : undefined;
        await window.g1code.openNativeFolder(targetPath);
      }
    } catch (err) {
      console.error("Failed to open native project folder:", err);
    }
  };

  const openWorkspace = async () => {
    // Use the File System Access API (showDirectoryPicker) for a native VS Code-style
    // folder picker — opens the OS panel directly with no intermediate dialog.
    if (typeof (window as any).showDirectoryPicker === "function") {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: "read" });
        const folderName: string = handle.name;
        // Resolve to absolute path via the server's cwd
        const { cwd } = await fetch("/api/workspace/cwd").then((r) => r.json()) as { cwd: string };
        const absolutePath = cwd.replace(/\/+$/, "") + "/" + folderName;
        const { workspace: serverWs } = await fetch("/api/workspace/choose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: absolutePath }),
        }).then((r) => r.json()) as { workspace: string };
        const finalWs = serverWs || absolutePath;
        setWorkspace(finalWs);
        setWorkspaceInput(finalWs);
        setEntries(await window.g1code.listDirectory(finalWs));
        setSessions(await window.g1code.listSessions(finalWs));
        void window.g1code.rebuildIndex(finalWs);
        void loadGitAndProblems(finalWs);
        return;
      } catch (err: any) {
        // User cancelled (AbortError) — do nothing. Any other error falls through to modal.
        if (err?.name === "AbortError") return;
      }
    }
    // Fallback: show the manual path-entry modal
    setWorkspaceModal(true);
  };

  const submitWorkspacePath = async () => {
    if (!workspaceInput.trim()) return;
    const chosen = workspaceInput.trim();
    try {
      // Tell the server which workspace to use, then load it
      const { workspace: serverWs } = await fetch("/api/workspace/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: chosen }),
      }).then((r) => r.json()) as { workspace: string };
      const finalWs = serverWs || chosen;
      setWorkspace(finalWs);
      setWorkspaceInput(finalWs);
      setEntries(await window.g1code.listDirectory(finalWs));
      setSessions(await window.g1code.listSessions(finalWs));
      void window.g1code.rebuildIndex(finalWs);
      void loadGitAndProblems(finalWs);
      setWorkspaceModal(false);
    } catch (err) {
      alert(
        "Could not open directory: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  const openFile = async (name: string) => {
    const filePath = name.startsWith("/") ? name : `${workspace}/${name}`;
    try {
      const content = await window.g1code.readFile(filePath);
      setTabs((old) =>
        old.some((tab) => tab.path === filePath)
          ? old.map((t) =>
              t.path === filePath && !t.dirty ? { ...t, content } : t,
            )
          : [...old, { path: filePath, content, dirty: false }],
      );
      setActiveTabPath(filePath);
      setActiveDiff(null);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const reloadOpenTabs = async () => {
    setTabs((oldTabs) => {
      oldTabs.forEach(async (tab) => {
        if (!tab.dirty) {
          try {
            const fresh = await window.g1code.readFile(tab.path);
            setTabs((current) =>
              current.map((t) =>
                t.path === tab.path && !t.dirty ? { ...t, content: fresh } : t,
              ),
            );
          } catch {
            // ignore
          }
        }
      });
      return oldTabs;
    });
  };

  const approveChange = async (changeId: string) => {
    if (!sessionId || workspace === "No workspace open") return;
    try {
      await window.g1code.change(workspace, sessionId, changeId, "approve");
      await loadChanges();
      await reloadOpenTabs();
      void loadGitAndProblems(workspace);
      if (activeDiff?.id === changeId) {
        setActiveDiff(null);
      }
    } catch (err) {
      console.error("Failed to approve change:", err);
    }
  };

  const rejectChange = async (changeId: string) => {
    if (!sessionId || workspace === "No workspace open") return;
    try {
      await window.g1code.change(workspace, sessionId, changeId, "reject");
      await loadChanges();
      if (activeDiff?.id === changeId) {
        setActiveDiff(null);
      }
    } catch (err) {
      console.error("Failed to reject change:", err);
    }
  };

  const approveAllChanges = async () => {
    if (!sessionId || workspace === "No workspace open") return;
    try {
      await window.g1code.approveAllChanges(workspace, sessionId);
      await loadChanges();
      await reloadOpenTabs();
      void loadGitAndProblems(workspace);
      setActiveDiff(null);
    } catch (err) {
      console.error("Failed to approve all changes:", err);
    }
  };

  const rejectAllChanges = async () => {
    if (!sessionId || workspace === "No workspace open") return;
    try {
      await window.g1code.rejectAllChanges(workspace, sessionId);
      await loadChanges();
      setActiveDiff(null);
    } catch (err) {
      console.error("Failed to reject all changes:", err);
    }
  };

  const switchSession = async (sessId: string) => {
    if (workspace === "No workspace open" || !sessId) return;
    try {
      setSessionId(sessId);
      setShowSessionHistory(false);
      const targetSession = sessions.find((s) => s.id === sessId);
      if (targetSession) {
        setSessionTitle(targetSession.title);
      }
      const sessEvents = await window.g1code.loadSessionEvents(workspace, sessId);
      if (Array.isArray(sessEvents)) {
        // DB records have shape { id, sessionId, eventType, payload }
        // payload IS the original AgentEvent ({ type, state, message, ... })
        // Merge consecutive streaming text chunks into a single event (same as live)
        const rawEvents: Event[] = sessEvents.map((e: any) => {
          const ev = e?.payload ?? e?.data ?? e;
          // Normalise eventType → type (DB stores eventType, renderer expects type)
          if (ev && !ev.type && e?.eventType) {
            return { ...ev, type: e.eventType.toLowerCase() };
          }
          return ev as Event;
        });

        // Collapse consecutive text events (replays streaming chunks as one bubble)
        const merged: Event[] = [];
        for (const ev of rawEvents) {
          if (ev.type === "text" && ev.message) {
            const last = merged[merged.length - 1];
            if (last && last.type === "text") {
              merged[merged.length - 1] = {
                ...last,
                message: (last.message || "") + ev.message,
              };
              continue;
            }
          }
          merged.push(ev);
        }
        setEvents(merged);
        // Restore the user task prompt from the session title (full prompt stored as title)
        setUserTaskPrompt(targetSession?.title || "");
      }
      const sessChanges = await window.g1code.listChanges(workspace, sessId);
      if (Array.isArray(sessChanges)) {
        setChanges(sessChanges);
      }
    } catch (err) {
      console.error("Failed to switch session:", err);
    }
  };

  const openChatsFolder = async () => {
    const target =
      workspace !== "No workspace open"
        ? `${workspace}/G1Code/chats`
        : "G1Code/chats";
    if (window.g1code?.openNativeFolder) {
      await window.g1code.openNativeFolder(target);
    }
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
    if (!task.trim()) return;

    if (workspace === "No workspace open") {
      setWorkspaceModal(true);
      setEvents((old) => [
        ...old,
        {
          type: "error",
          message:
            "No workspace open. Please select or open a local project folder first.",
        },
      ]);
      return;
    }

    let modelToUse = selectedModel;
    const currentLimit = usageLimits[modelToUse];
    const currentMeta = models.find((m) => m.id === modelToUse);
    // A model is valid if it is confirmed free ($0/$0) and not usage-limited.
    // If the models list hasn't loaded yet but a model is configured, allow it through.
    const isCurrentValid =
      Boolean(modelToUse) &&
      (models.length === 0 ||
        (Boolean(currentMeta) &&
          currentMeta?.pricingType === "free" &&
          currentMeta?.pricingDetails?.input === 0 &&
          currentMeta?.pricingDetails?.output === 0 &&
          !currentLimit?.isLimitReached));

    // Collect any pre-flight notification to show after clearing events
    let preflightNotice: string | null = null;

    if (!isCurrentValid) {
      const candidateFree = models.filter((m) => {
        const isFree =
          m.pricingType === "free" &&
          m.pricingDetails?.input === 0 &&
          m.pricingDetails?.output === 0;
        const isLimited = Boolean(usageLimits[m.id]?.isLimitReached);
        return isFree && !isLimited;
      });

      const nextBest =
        candidateFree.find((m) => m.id !== modelToUse) || candidateFree[0];

      if (nextBest) {
        modelToUse = nextBest.id;
        setSelectedModel(modelToUse);
        preflightNotice = `Switched automatically to next best available free model: ${nextBest.name || nextBest.id}`;
      } else {
        setEvents((old) => [
          ...old,
          {
            type: "error",
            message: `Model "${currentMeta?.name || modelToUse || "Selected model"}" is unavailable or usage-limited, and no other free models are currently available.`,
          },
        ]);
        return;
      }
    }

    setRunning(true);
    // Reset events; re-add any pre-flight notice so it isn't lost
    setEvents(
      preflightNotice
        ? [{ type: "text", message: preflightNotice }]
        : [],
    );
    setChanges([]);
    setUserTaskPrompt(task);
    setSessionTitle(task.length > 50 ? task.slice(0, 50) + "…" : task);
    lastPromptRef.current = task;

    try {
      const res = await window.g1code.startAgent({
        workspace,
        prompt: task,
        mode:
          agentMode === "plan" ? "plan" : agentMode === "ask" ? "ask" : "agent",
        model: modelToUse,
        provider: "experiential-labs",
        attachedContext,
      });
      setSessionId(res.sessionId);
      setAgentPrompt("");
      setAttachedContext([]);
      if (window.g1code.getUsageLimits) {
        void window.g1code.getUsageLimits().then((l) => l && setUsageLimits(l));
      }
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

  // Auto-scroll agent body to bottom whenever new events arrive
  useEffect(() => {
    const el = agentBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  // Auto-scroll terminal panel to bottom on new output
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [terminalOutput]);

  const handleModelChange = async (newModel: string) => {
    // Do not allow selecting a model that has reached its usage limit
    const limit = usageLimits[newModel];
    if (limit?.isLimitReached) return;
    setSelectedModel(newModel);
    setModelPickerOpen(false);
    const updated = await window.g1code.saveSettings({
      ...settings,
      model: newModel,
      provider: "experiential-labs",
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
      setEvents((old) => [
        ...old,
        {
          type: "text",
          message: `Git commit successful (${gitStatus.branch}): "${commitMessage.trim()}"`,
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
          `✓ Connected! ${res.modelCount} models available from Experiential Labs.`,
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

  // Auto-resize textarea as content grows (up to max-height from CSS)
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  // Autocomplete triggers
  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without shift → send; Cmd/Ctrl+Enter also sends
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void startAgent();
      return;
    }
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setAgentPrompt(val);
    autoResizeTextarea();

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

  // Filtered models for Model Picker — driven entirely by dynamically fetched data
  // A model is "free" only when the API confirms Input = $0/M and Output = $0/M
  const isTrulyFree = (m: ModelItem) =>
    m.pricingType === "free" &&
    m.pricingDetails?.input === 0 &&
    m.pricingDetails?.output === 0;

  const freeCount = models.filter(isTrulyFree).length;
  const toolCount = models.filter((m) => m.supportsTools).length;

  const filteredModels = models.filter((m) => {
    const matchSearch =
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase());
    if (!matchSearch) return false;
    if (modelFilterTab === "free") return isTrulyFree(m);
    if (modelFilterTab === "tools") return m.supportsTools;
    // Use the recommendedRole assigned dynamically from the API, not hardcoded id fragments
    if (modelFilterTab === "reasoning") return m.recommendedRole === "reasoning";
    if (modelFilterTab === "coding")  return m.recommendedRole === "coding";
    if (modelFilterTab === "fast")    return m.recommendedRole === "fast";
    if (modelFilterTab === "balanced") return m.recommendedRole === "balanced";
    return true; // "all"
  });

  const activeModelMeta = models.find((m) => m.id === selectedModel) ||
    models[0] || {
      id: selectedModel || "loading",
      name:
        selectedModel ||
        (models.length === 0 ? "Loading models..." : "Select model"),
      contextWindowFormatted: "",
      isPromotional: false,
    };

  const renderModelCard = (m: (typeof models)[0], index: number) => {
    const limit = usageLimits[m.id];
    const isLimited = limit?.isLimitReached === true;
    const resetAt = isLimited
      ? (limit.limitType === "daily" ? limit.dailyResetAt : limit.hourlyResetAt)
      : 0;
    const secondsUntilReset = isLimited
      ? Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))
      : 0;
    const resetLabel = isLimited
      ? secondsUntilReset > 3600
        ? `Resets in ${Math.ceil(secondsUntilReset / 3600)}h`
        : secondsUntilReset > 60
        ? `Resets in ${Math.ceil(secondsUntilReset / 60)}m`
        : `Resets in ${secondsUntilReset}s`
      : "";

    const rankNumber = index + 1;
    const rankBadgeClass =
      rankNumber === 1
        ? "model-rank-badge rank-1"
        : rankNumber === 2
        ? "model-rank-badge rank-2"
        : rankNumber === 3
        ? "model-rank-badge rank-3"
        : "model-rank-badge";

    const rankLabel = rankNumber === 1 ? "★ #1" : `#${rankNumber}`;

    const isGenericDesc =
      !m.description ||
      m.description.includes("Free ($0 input / $0 output) model on Experiential Labs gateway");

    return (
      <div
        className={`model-item-card ${selectedModel === m.id ? "active" : ""} ${isLimited ? "model-item-card--limited" : ""}`}
        key={m.id}
        onClick={() => !isLimited && handleModelChange(m.id)}
        style={isLimited ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        title={isLimited ? `Usage limit reached · ${resetLabel}` : undefined}
      >
        <div className="model-item-top">
          <div className="model-item-title-group">
            <span className={rankBadgeClass}>{rankLabel}</span>
            {selectedModel === m.id && !isLimited && (
              <Check size={14} className="model-check-icon" />
            )}
            <span className="model-item-name">{m.name}</span>
            {m.isPromotional && (
              <span className="model-promo-tag">Featured</span>
            )}
          </div>
          <div className="model-badges-group">
            {m.recommendedRole && (
              <span className="model-role-badge">
                {m.recommendedRole}
              </span>
            )}
            {isLimited ? (
              <span className="model-limit-badge">LIMIT REACHED</span>
            ) : isTrulyFree(m) ? (
              <span className="model-free-pill" title={m.pricingFormatted || "Free ($0 input / $0 output)"}>
                <Zap size={10} /> Free · $0/M
              </span>
            ) : (
              <span className="model-role-badge">Credits</span>
            )}
          </div>
        </div>

        {!isGenericDesc && m.description && (
          <div className="model-item-desc">{m.description}</div>
        )}

        {isLimited && (
          <div
            style={{
              fontSize: 11,
              color: "var(--accent-error, #f43f5e)",
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Clock size={11} />
            <span>
              {limit.limitType === "daily" ? "Daily" : "Hourly"} limit reached
              {resetLabel ? ` · ${resetLabel}` : ""}
            </span>
          </div>
        )}

        <div className="model-caps-row">
          <span className="model-cap-tag">{m.contextWindowFormatted || "128K"} Context</span>
          {m.supportsTools && <span className="model-cap-tag cap-accent">Tools ✓</span>}
          {m.supportsStreaming !== false && <span className="model-cap-tag">Streaming ✓</span>}
          {m.supportsVision && <span className="model-cap-tag cap-accent">Vision ✓</span>}
          <span className="model-host-label">Experiential Cloud</span>
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
            <span>Experiential Labs</span>
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
          <aside className="sidebar" style={{ width: `${sidebarWidth}px` }}>
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
                      onClick={() => void openNativeProjectFolder()}
                      title="Open in Finder / File Explorer"
                    >
                      <ExternalLink size={13} />
                    </button>
                    <button
                      onClick={openWorkspace}
                      title="Change Workspace Folder"
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

        {showSidebar && (
          <div
            className={`tile-resizer-vertical ${resizingPane === "sidebar" ? "resizing" : ""}`}
            onMouseDown={startResizingSidebar}
            onDoubleClick={() => setSidebarWidth(270)}
            title="Drag to resize sidebar (Double-click to reset)"
          />
        )}

        {/* 3. Center Professional Code Editor */}
        <main className="editor-area">
          {/* Editor Tabs Bar */}
          <div className="editor-tabs-bar">
            <div className="tabs-scroll">
              {tabs.map((tab, idx) => (
                <div
                  className={`editor-tab ${tab.path === activeTabPath && !activeDiff ? "active" : ""} ${draggedTabIndex === idx ? "dragging" : ""}`}
                  key={tab.path}
                  draggable
                  onDragStart={(e) => {
                    setDraggedTabIndex(idx);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", tab.path);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedTabIndex !== null && draggedTabIndex !== idx) {
                      const updated = [...tabs];
                      const [draggedItem] = updated.splice(draggedTabIndex, 1);
                      updated.splice(idx, 0, draggedItem);
                      setTabs(updated);
                    }
                    setDraggedTabIndex(null);
                  }}
                  onDragEnd={() => setDraggedTabIndex(null)}
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
                <div className="diff-header-action-group">
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
                  <button
                    className="editor-action-btn editor-btn-approve"
                    onClick={() => void approveChange(activeDiff.id)}
                    title="Approve & Apply this change"
                  >
                    <Check size={13} /> Approve
                  </button>
                  <button
                    className="editor-action-btn editor-btn-reject"
                    onClick={() => void rejectChange(activeDiff.id)}
                    title="Reject this change"
                  >
                    <X size={13} /> Reject
                  </button>
                </div>
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
                <button
                  className="btn-open-folder"
                  onClick={() => void openNativeProjectFolder()}
                >
                  <FolderOpen size={14} /> Open Project Folder
                </button>
              </div>
            )}
          </div>

          {/* Bottom Drawer (Terminal / Activity / Problems / Tests) */}
          {showBottomPanel && (
            <div
              className={`tile-resizer-horizontal ${resizingPane === "drawer" ? "resizing" : ""}`}
              onMouseDown={startResizingDrawer}
              onDoubleClick={() => setDrawerHeight(220)}
              title="Drag to resize bottom panel (Double-click to reset)"
            />
          )}
          {showBottomPanel && (
            <div className="bottom-drawer" style={{ height: `${drawerHeight}px` }}>
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
                    <pre className="terminal-pre" ref={terminalRef}>
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
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        No test runs recorded for this session. Use the terminal or ask the agent to run tests.
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
                    {events.length > 0 ? (
                      events.map((ev, i) => (
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
                      ))
                    ) : (
                      <div
                        style={{
                          color: "var(--text-muted)",
                          fontSize: 12,
                          padding: "12px 4px",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span style={{ color: "var(--accent-agent)" }}>●</span>
                        System ready. Agent activity, tool calls, and execution steps will appear here in real-time.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {showAgentWorkspace && (
          <div
            className={`tile-resizer-vertical ${resizingPane === "agent" ? "resizing" : ""}`}
            onMouseDown={startResizingAgent}
            onDoubleClick={() => setAgentWidth(410)}
            title="Drag to resize agent panel (Double-click to reset)"
          />
        )}

        {/* 4. Right-Side Agent Workspace (Antigravity / BOB Style) */}
        {showAgentWorkspace && (
          <aside className="agent-workspace" style={{ width: `${agentWidth}px` }}>
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
                    setSessionTitle("");
                    setUserTaskPrompt("");
                    setEvents([]);
                    setChanges([]);
                    setAgentPrompt("");
                    lastPromptRef.current = "";
                  }}
                  title="New Task / Reset"
                >
                  <Plus size={16} />
                </button>
                {running && (
                  <button
                    className="agent-icon-btn agent-icon-btn--stop"
                    onClick={() => sessionId && window.g1code.stopAgent(sessionId)}
                    title="Stop Agent"
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  className={`agent-icon-btn ${showSessionHistory ? "active" : ""}`}
                  onClick={() => setShowSessionHistory(!showSessionHistory)}
                  title="Session History"
                >
                  <Clock size={16} />
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

            {/* Session History Popover */}
            {showSessionHistory && (
              <div className="session-history-popover">
                <div className="session-history-header">
                  <span>SESSION HISTORY</span>
                  <div className="session-history-header-actions">
                    <button
                      className="open-chats-folder-btn"
                      onClick={() => void openChatsFolder()}
                      title="Open local G1Code/chats folder in system file manager"
                    >
                      <Folder size={11} /> Open Chats Folder
                    </button>
                    <button
                      className="close-history-btn"
                      onClick={() => setShowSessionHistory(false)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div className="session-history-list">
                  {sessions.length > 0 ? (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`session-history-item ${s.id === sessionId ? "active" : ""}`}
                        onClick={() => void switchSession(s.id)}
                      >
                        <div className="session-history-title">{s.title || "Untitled Task"}</div>
                        <div className="session-history-meta">
                          <span className={`session-status-tag status-${s.status.toLowerCase()}`}>{s.status}</span>
                          <span className="session-mode-tag">{s.mode}</span>
                          {s.model && <span className="session-model-name">{s.model.split("/").pop()}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="session-history-empty">No past sessions found</div>
                  )}
                </div>
              </div>
            )}

            {/* Bob-style Chat Body */}
            <div className="chat-body" ref={agentBodyRef}>
              {/* Empty state */}
              {!userTaskPrompt && events.length === 0 && (
                <div className="chat-empty-state">
                  <div className="chat-empty-logo">
                    <Bot size={36} />
                  </div>
                  <div className="chat-empty-title">G1Code Agent</div>
                  <div className="chat-empty-hint">
                    Ask anything. The agent will inspect, plan, edit, and verify autonomously.
                  </div>
                  <div className="chat-empty-pills">
                    {[
                      "Explain this codebase",
                      "Fix failing tests",
                      "Refactor for clarity",
                      "Add a new feature",
                    ].map((s) => (
                      <button
                        key={s}
                        className="chat-empty-pill"
                        onClick={() => {
                          setAgentPrompt(s);
                          textareaRef.current?.focus();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* User bubble — shown when a task is active */}
              {userTaskPrompt && (
                <div className="chat-row chat-row--user">
                  <div className="chat-bubble chat-bubble--user">
                    {userTaskPrompt}
                  </div>
                </div>
              )}

              {/* Bob-style event feed — tools grouped into collapsible activity blocks */}
              {(() => {
                // ── Segment events into activity groups and standalone events ──────
                type Segment =
                  | { kind: "activity"; events: Event[]; groupKey: string }
                  | { kind: "event"; ev: Event; idx: number };

                const segments: Segment[] = [];
                let i = 0;
                while (i < events.length) {
                  const ev = events[i];
                  const isToolOrState =
                    ev.type === "tool" ||
                    (ev.type === "state" &&
                      ev.state !== "IDLE" &&
                      !["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(ev.state ?? "") &&
                      !(ev.message?.includes("[Failover]") || ev.message?.includes("Switched automatically")));

                  if (isToolOrState) {
                    const groupEvents: Event[] = [];
                    const startIdx = i;
                    while (i < events.length) {
                      const cur = events[i];
                      const stillTool =
                        cur.type === "tool" ||
                        (cur.type === "state" &&
                          cur.state !== "IDLE" &&
                          !["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(cur.state ?? "") &&
                          !(cur.message?.includes("[Failover]") || cur.message?.includes("Switched automatically")));
                      if (!stillTool) break;
                      groupEvents.push(cur);
                      i++;
                    }
                    segments.push({ kind: "activity", events: groupEvents, groupKey: `grp-${startIdx}` });
                  } else {
                    segments.push({ kind: "event", ev, idx: i });
                    i++;
                  }
                }

                // ── Render each segment ───────────────────────────────────────────
                return segments.map((seg) => {
                  // ── Activity group block ──────────────────────────────────────
                  if (seg.kind === "activity") {
                    const grpKey = seg.groupKey;
                    const isExpanded = expandedGroups.has(grpKey);
                    const toolEvts = seg.events.filter((e) => e.type === "tool");
                    const isDone = toolEvts.every((e) => Boolean(e.result || e.message?.includes("completed")));
                    const hasFail = toolEvts.some((e) => e.message?.includes("failed"));

                    // Build summary counts: files read, searches, commands, writes
                    let fileCount = 0, searchCount = 0, cmdCount = 0, writeCount = 0;
                    for (const e of toolEvts) {
                      if (!e.input) continue;
                      const n = e.toolName || "";
                      if (n === "read_file" || n === "list_directory") fileCount++;
                      else if (n === "search_files" || n === "search_symbols") searchCount++;
                      else if (n === "run_command" || n === "run_tests") cmdCount++;
                      else if (n === "write_file" || n === "apply_patch") writeCount++;
                      else fileCount++; // fallback count
                    }
                    const summaryParts: string[] = [];
                    if (fileCount > 0) summaryParts.push(`${fileCount} file${fileCount > 1 ? "s" : ""}`);
                    if (searchCount > 0) summaryParts.push(`${searchCount} search${searchCount > 1 ? "es" : ""}`);
                    if (cmdCount > 0) summaryParts.push(`${cmdCount} command${cmdCount > 1 ? "s" : ""}`);
                    if (writeCount > 0) summaryParts.push(`${writeCount} edit${writeCount > 1 ? "s" : ""}`);
                    const summary = summaryParts.length > 0 ? summaryParts.join(", ") : `${toolEvts.length} action${toolEvts.length !== 1 ? "s" : ""}`;

                    return (
                      <div className="activity-group" key={grpKey}>
                        {/* Collapsible header row */}
                        <button
                          className={`activity-group-header ${hasFail ? "activity-group-header--fail" : isDone ? "activity-group-header--done" : "activity-group-header--running"}`}
                          onClick={() => toggleGroup(grpKey)}
                        >
                          <span className="activity-group-icon">
                            {hasFail ? (
                              <AlertTriangle size={13} />
                            ) : isDone ? (
                              <CheckCircle2 size={13} />
                            ) : (
                              <RefreshCw size={12} className="spin-icon" />
                            )}
                          </span>
                          <span className="activity-group-label">
                            {hasFail ? "Failed" : isDone ? "Explored" : "Exploring"}
                          </span>
                          <span className="activity-group-summary">{summary}</span>
                          <span className="activity-group-chevron">
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </span>
                        </button>

                        {/* Expanded detail rows */}
                        {isExpanded && (
                          <div className="activity-group-body">
                            {seg.events.map((e, ei) => {
                              if (e.type === "state") {
                                return (
                                  <div className="activity-state-row" key={ei}>
                                    <span className="activity-state-dot" />
                                    <span className="activity-state-label">{e.state?.replace(/_/g, " ")}</span>
                                    {e.message && <span className="activity-state-msg">{e.message}</span>}
                                  </div>
                                );
                              }
                              const done = Boolean(e.result || e.message?.includes("completed"));
                              const fail = Boolean(e.message?.includes("failed"));
                              const inp = e.input && typeof e.input === "object" ? e.input as Record<string, unknown> : null;
                              const arg = inp
                                ? String(inp.path || inp.filePath || inp.command || inp.query || inp.pattern || "").slice(0, 70)
                                : "";
                              const toolIcon: Record<string, React.ReactNode> = {
                                read_file: <FileCode size={12} />,
                                list_directory: <Folder size={12} />,
                                write_file: <Edit3 size={12} />,
                                apply_patch: <Edit3 size={12} />,
                                run_command: <TerminalIcon size={12} />,
                                run_tests: <CheckCircle2 size={12} />,
                                search_files: <Search size={12} />,
                                search_symbols: <Search size={12} />,
                                get_git_status: <GitBranch size={12} />,
                              };
                              return (
                                <div
                                  className={`activity-tool-row ${fail ? "activity-tool-row--fail" : done ? "activity-tool-row--done" : "activity-tool-row--running"}`}
                                  key={ei}
                                >
                                  <span className="activity-tool-icon">
                                    {fail ? <AlertTriangle size={12} /> : done ? <Check size={12} /> : <RefreshCw size={11} className="spin-icon" />}
                                  </span>
                                  <span className="activity-tool-type-icon">
                                    {toolIcon[e.toolName || ""] || <Zap size={12} />}
                                  </span>
                                  <span className="activity-tool-name">{e.toolName || "tool"}</span>
                                  {arg && <code className="activity-tool-arg">{arg}</code>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── Standalone event ──────────────────────────────────────────
                  const { ev, idx: i } = seg;

                // Approval card
                if (ev.type === "approval") {
                  const changeInput = ev.input as
                    | { changeId?: string; path?: string; diff?: string; status?: string }
                    | undefined;
                  const targetChangeId = changeInput?.changeId || ev.changeId;
                  const filePath =
                    changeInput?.path || (ev.toolName ? `${ev.toolName}` : "File change");
                  const isApplied =
                    ev.result && typeof ev.result === "object" &&
                    (ev.result as any).status === "APPLIED";
                  const isRejected =
                    ev.result && typeof ev.result === "object" &&
                    (ev.result as any).status === "REJECTED";
                  return (
                    <div className="chat-approval-card" key={`appr-${i}`}>
                      <div className="chat-approval-header">
                        <GitFork size={13} />
                        <span>
                          {isApplied ? "Change Applied" : isRejected ? "Change Rejected" : "Approval Required"}
                        </span>
                        <code className="chat-approval-file">{filePath}</code>
                      </div>
                      {changeInput?.diff && (
                        <pre className="chat-approval-diff">
                          {changeInput.diff.split("\n").slice(0, 8).join("\n")}
                        </pre>
                      )}
                      {!isApplied && !isRejected && targetChangeId && (
                        <div className="chat-approval-actions">
                          <button
                            className="chat-approval-btn chat-approval-btn--neutral"
                            onClick={() => {
                              const found = changes.find((c) => c.id === targetChangeId);
                              if (found) setActiveDiff(found);
                              else if (changeInput) {
                                setActiveDiff({
                                  id: targetChangeId,
                                  path: changeInput.path || filePath,
                                  patch: changeInput.diff || "",
                                  status: "pending_approval",
                                });
                              }
                            }}
                          >
                            <ExternalLink size={12} /> View Diff
                          </button>
                          <button
                            className="chat-approval-btn chat-approval-btn--approve"
                            onClick={() => void approveChange(targetChangeId)}
                          >
                            <Check size={12} /> Apply
                          </button>
                          <button
                            className="chat-approval-btn chat-approval-btn--reject"
                            onClick={() => void rejectChange(targetChangeId)}
                          >
                            <X size={12} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                // Error → error bubble
                if (ev.type === "error") {
                  return (
                    <div className="chat-row chat-row--assistant" key={`err-${i}`}>
                      <div className="chat-avatar chat-avatar--error">
                        <AlertTriangle size={14} />
                      </div>
                      <div className="chat-bubble chat-bubble--error">
                        <div className="chat-error-title">Error</div>
                        <div className="chat-error-body">{ev.message}</div>
                        <div className="chat-error-actions">
                          {lastPromptRef.current && !running && (
                            <button
                              className="chat-action-btn chat-action-btn--retry"
                              onClick={() => void startAgent(lastPromptRef.current)}
                            >
                              <RefreshCw size={12} /> Retry
                            </button>
                          )}
                          {ev.message?.toLowerCase().includes("api key") && (
                            <button
                              className="chat-action-btn"
                              onClick={() => setSettingsOpen(true)}
                            >
                              <Key size={12} /> Configure Key
                            </button>
                          )}
                          {ev.message?.toLowerCase().includes("workspace") && (
                            <button
                              className="chat-action-btn"
                              onClick={() => setWorkspaceModal(true)}
                            >
                              <FolderOpen size={12} /> Open Workspace
                            </button>
                          )}
                          {ev.message?.toLowerCase().includes("model") && (
                            <button
                              className="chat-action-btn"
                              onClick={() => setModelPickerOpen(true)}
                            >
                              <Sparkles size={12} /> Switch Model
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                  // Failover / auto-switch system notice — must come before text bubble check
                  if (
                    ev.message?.includes("[Failover]") ||
                    ev.message?.includes("Switched automatically")
                  ) {
                    return (
                      <div className="chat-system-notice" key={`failover-${i}`}>
                        <Sparkles size={12} color="var(--accent-model)" />
                        <span>{ev.message!.replace(/^\[Failover\]\s*/, "")}</span>
                      </div>
                    );
                  }

                // Streaming text → AI message bubble with markdown
                // `done` events carry the full accumulated message but the individual
                // `text` chunks were already merged into a bubble above — skip `done`
                // when it has no message or when text events already rendered content.
                if (ev.type === "text" && ev.message) {
                  return (
                    <div className="chat-row chat-row--assistant" key={i}>
                      <div className="chat-avatar chat-avatar--bot">
                        <Bot size={14} />
                      </div>
                      <div className="chat-bubble chat-bubble--assistant">
                        <div className="chat-bubble-meta">
                          <span className="chat-model-label">
                            {activeModelMeta.name || selectedModel}
                          </span>
                        </div>
                        <div className="chat-markdown">
                          {renderMarkdown(ev.message, openFile, workspace)}
                        </div>
                      </div>
                    </div>
                  );
                }

                // `done` event: the runtime emits this with the full accumulated text,
                // but streaming already rendered it via `text` events.
                // Only render a bubble if this done event carries content that was
                // NOT preceded by any text events (non-streaming completion).
                if (ev.type === "done" && ev.message) {
                  // Check if any text bubble was already rendered before this event index
                  const hasTextBefore = events
                    .slice(0, i)
                    .some((e) => e.type === "text" && e.message);
                  if (!hasTextBefore) {
                    return (
                      <div className="chat-row chat-row--assistant" key={i}>
                        <div className="chat-avatar chat-avatar--bot">
                          <Bot size={14} />
                        </div>
                        <div className="chat-bubble chat-bubble--assistant">
                          <div className="chat-bubble-meta">
                            <span className="chat-model-label">
                              {activeModelMeta.name || selectedModel}
                            </span>
                          </div>
                          <div className="chat-markdown">
                            {renderMarkdown(ev.message, openFile, workspace)}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }

                  // Terminal state pills (COMPLETED / FAILED / STOPPED / CANCELLED)
                  if (ev.type === "state" && ev.state && ev.state !== "IDLE") {
                    const stateClass: Record<string, string> = {
                      COMPLETED: "chat-state-pill--done",
                      FAILED: "chat-state-pill--fail",
                      CANCELLED: "chat-state-pill--stopped",
                      STOPPED: "chat-state-pill--stopped",
                    };
                    return (
                      <div className={`chat-state-pill ${stateClass[ev.state] || ""}`} key={`state-${i}`}>
                        {["COMPLETED"].includes(ev.state) ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                        <span>{ev.state.replace(/_/g, " ")}</span>
                        {ev.message && <span className="chat-state-pill-msg">{ev.message}</span>}
                      </div>
                    );
                  }

                  return null;
                });
              })()}

              {/* Streaming indicator — only show thinking dots when NOT already streaming text */}
              {running && events[events.length - 1]?.type !== "text" && (
                <div className="chat-row chat-row--assistant">
                  <div className="chat-avatar chat-avatar--bot">
                    <Bot size={14} />
                  </div>
                  <div className="chat-thinking">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                </div>
              )}

              {/* Change Review Bar — only when there are changes */}
              {changes.length > 0 && (
                <div className="chat-changes-bar">
                  <div className="chat-changes-info">
                    <GitFork size={13} color="var(--accent-warning)" />
                    <span>{changes.length} file{changes.length > 1 ? "s" : ""} changed</span>
                  </div>
                  <div className="chat-changes-actions">
                    <button
                      className="chat-changes-btn chat-changes-btn--neutral"
                      onClick={() => {
                        if (changes.length > 0) setActiveDiff(changes[0]);
                        else void loadChanges();
                      }}
                    >
                      Review
                    </button>
                    <button
                      className="chat-changes-btn chat-changes-btn--approve"
                      onClick={() => void approveAllChanges()}
                    >
                      <Check size={11} /> Apply All
                    </button>
                    <button
                      className="chat-changes-btn chat-changes-btn--reject"
                      onClick={() => void rejectAllChanges()}
                    >
                      <X size={11} /> Reject All
                    </button>
                  </div>
                </div>
              )}

              {/* Inline permission request card — appears in chat like Bob */}
              {permission && (
                <div className="chat-permission-card">
                  <div className="chat-permission-header">
                    <Shield size={14} />
                    <span>Permission Required</span>
                  </div>
                  <div className="chat-permission-body">
                    <p className="chat-permission-desc">
                      The agent wants to run{" "}
                      <code className="chat-permission-tool">{permission.tool}</code>
                    </p>
                    {Boolean(permission.input) && (
                      <pre className="chat-permission-input">
                        {JSON.stringify(permission.input, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="chat-permission-actions">
                    <button
                      className="chat-approval-btn chat-approval-btn--reject"
                      onClick={() => {
                        window.g1code.respondPermission(permission.requestId, false);
                        setPermission(null);
                      }}
                    >
                      <X size={12} /> Deny
                    </button>
                    <button
                      className="chat-approval-btn chat-approval-btn--approve"
                      onClick={() => {
                        window.g1code.respondPermission(permission.requestId, true);
                        setPermission(null);
                      }}
                    >
                      <Check size={12} /> Allow Once
                    </button>
                  </div>
                </div>
              )}
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

                {usageLimits[selectedModel]?.isLimitReached && (
                  <div className="model-limit-warning-banner">
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <AlertTriangle size={15} color="#f59e0b" />
                      <span>
                        <strong>{activeModelMeta.name}</strong> has reached its{" "}
                        {usageLimits[selectedModel].limitType === "daily"
                          ? "daily"
                          : "hourly"}{" "}
                        usage limit.
                        {(() => {
                          const limit = usageLimits[selectedModel];
                          const resetAt =
                            limit.limitType === "daily"
                              ? limit.dailyResetAt
                              : limit.hourlyResetAt;
                          const sec = Math.max(
                            0,
                            Math.ceil((resetAt - Date.now()) / 1000),
                          );
                          const label =
                            sec > 3600
                              ? `${Math.ceil(sec / 3600)}h`
                              : sec > 60
                                ? `${Math.ceil(sec / 60)}m`
                                : `${sec}s`;
                          return ` Resets in ${label}.`;
                        })()}
                      </span>
                    </div>
                    <button
                      className="btn-switch-model"
                      onClick={() => {
                        const available = models.find(
                          (m) => !usageLimits[m.id]?.isLimitReached,
                        );
                        if (available) void handleModelChange(available.id);
                      }}
                    >
                      Switch Model
                    </button>
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
                          {agentMode}
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
                                {m}
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
                        Experiential Labs
                      </span>
                      <span className="model-selector-name">
                        {activeModelMeta.name}
                        {usageLimits[selectedModel]?.isLimitReached ? (
                          <span
                            className="model-limit-badge"
                            style={{
                              fontSize: 9,
                              padding: "1px 5px",
                              marginLeft: 4,
                            }}
                          >
                            LIMIT REACHED
                          </span>
                        ) : activeModelMeta.isPromotional ? (
                          <span className="model-promo-badge mini">
                            Free · $0/M
                          </span>
                        ) : null}
                        <ChevronDown size={10} />
                      </span>
                    </div>

                    {/* Submit Button */}
                    <button
                      className="btn-send-agent"
                      onClick={() => void startAgent()}
                      disabled={
                        running ||
                        !agentPrompt.trim() ||
                        // Only disable when the selected model is limited AND no other free model is available
                        (Boolean(usageLimits[selectedModel]?.isLimitReached) &&
                          !models.some(
                            (m) =>
                              m.pricingType === "free" &&
                              m.pricingDetails?.input === 0 &&
                              m.pricingDetails?.output === 0 &&
                              !usageLimits[m.id]?.isLimitReached,
                          ))
                      }
                      title={
                        usageLimits[selectedModel]?.isLimitReached
                          ? models.some(
                              (m) =>
                                m.pricingType === "free" &&
                                m.pricingDetails?.input === 0 &&
                                m.pricingDetails?.output === 0 &&
                                !usageLimits[m.id]?.isLimitReached,
                            )
                            ? "Current model limit reached — will auto-switch to next available free model."
                            : "All free models are usage-limited. Please wait for reset."
                          : "Send Prompt (Enter)"
                      }
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
            className="statusbar-item model-pill"
            onClick={() => setModelPickerOpen(true)}
          >
            <span className="statusbar-exp-badge">EXP</span>
            <span>{activeModelMeta.name}</span>
          </div>
          <div className="statusbar-item">
            <span>
              Context: {activeModelMeta.contextWindowFormatted || "—"}
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
                <h3>Experiential Labs — Free Models</h3>
                <span>High-Capability Coding Models · Free Promotional Tier · Usage-Limited</span>
              </div>
              <button onClick={() => setModelPickerOpen(false)}>
                <X size={16} color="var(--text-muted)" />
              </button>
            </div>

            <div className="model-free-notice">
              <div className="live-pulse-dot" />
              <div className="live-tier-text">
                <strong>Live Free Tier:</strong> Confirmed $0/M Input · $0/M Output · Refreshes every 30s
              </div>
              <span className="live-badge">100% Free</span>
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

            <div className="model-filter-tabs">
              {[
                { key: "free", label: `Free (${freeCount})` },
                { key: "all", label: `All (${models.length})` },
                { key: "coding", label: "Coding" },
                { key: "reasoning", label: "Reasoning" },
                { key: "fast", label: "Fast" },
                { key: "balanced", label: "Balanced" },
                { key: "tools", label: `Tools (${toolCount})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`model-filter-btn ${modelFilterTab === tab.key ? "active" : ""}`}
                  onClick={() => setModelFilterTab(tab.key as any)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="model-list-scroll">
              {filteredModels.length === 0 ? (
                <div style={{ padding: "24px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                  No models match your filter.
                </div>
              ) : (
                <>
                  <div className="model-category-header">
                    <div className="model-cat-left">
                      <Sparkles size={11} color="var(--accent-primary, #6366f1)" />
                      <span>AVAILABLE FREE MODELS ({filteredModels.length})</span>
                    </div>
                    <span className="model-cat-right">SORTED BY PERFORMANCE & PROMOTIONS</span>
                  </div>
                  {filteredModels.map((m, index) => renderModelCard(m, index))}
                </>
              )}
            </div>

            <div className="model-picker-footer">
              <button
                className="btn-secondary"
                onClick={async () => {
                  const res = await window.g1code.refreshModels(settings.provider);
                  if (res.success && res.models) {
                    setModels(res.models);
                    setSelectedModel((curr) => {
                      if (curr && res.models.some((m: ModelItem) => m.id === curr)) return curr;
                      return res.models[0]?.id || "";
                    });
                  }
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
              <div
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                Experiential Labs (Free Promotional Models &amp; Coding Gateway)
              </div>
            </div>

            <div className="settings-field">
              <label>API Base URL</label>
              <input
                value={settings.endpoint}
                onChange={(e) =>
                  setSettings({ ...settings, endpoint: e.target.value })
                }
                placeholder="https://api.experientiallabs.ai/v1"
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
                      "Paste xpl_... API Key (or use EXPERIENTIAL_API_KEY env)"
                }
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
              />
              <small style={{ color: "var(--text-dim)" }}>
                API keys for Experiential Labs are encrypted securely on disk. Never exposed to renderer.
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
                {verifying ? "Verifying..." : "Verify Experiential"}
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
                    provider: "experiential-labs",
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

      {/* WORKSPACE DIRECTORY MODAL — fallback for browsers without showDirectoryPicker */}
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
                onKeyDown={(e) => e.key === "Enter" && void submitWorkspacePath()}
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

      {resizingPane && (
        <div
          className="resizing-overlay"
          style={{ cursor: resizingPane === "drawer" ? "row-resize" : "col-resize" }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

export default App;
