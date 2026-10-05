import { classifyCommand, type CommandRisk } from "../tools/command-policy";

/**
 * Phase 4: single permission authority.
 *
 * Before this module the decision lived inline in `server.ts` as a chain of
 * regular expressions plus an `executionMode` branch. That chain had two
 * problems:
 *
 *   * `review` (the default mode) returned `false` for every non-dangerous
 *     tool, so the agent could not edit, test, or run commands at all without
 *     the user first switching to `auto`. The comment promised "pause for an
 *     explicit user decision"; the code denied the call outright.
 *   * The same logic was duplicated in a dead Electron runtime, so the two
 *     copies could disagree.
 *
 * The policy is intentionally small, deterministic, and testable, and it is the
 * only place allowed to answer "may this tool run?".
 */

export type ToolCategory = "read_only" | "mutating" | "execution";

export type ToolPermissionSettings = {
  readFiles: boolean;
  searchRepository: boolean;
  editFiles: boolean;
  createFiles: boolean;
  deleteFiles: boolean;
  renameFiles: boolean;
  runTests: boolean;
  runBuilds: boolean;
  runCommands: boolean;
  networkTools: boolean;
};

export type PermissionDecision = "allow" | "ask" | "deny";

export type PermissionVerdict = {
  decision: PermissionDecision;
  /** Stable machine-readable reason for audit events and diagnostics. */
  reason: string;
  category: ToolCategory;
  risks: CommandRisk[];
  /** Human-readable summary for the approval card. */
  summary: string;
};

export type ExecutionMode = "review" | "auto" | "plan" | "readonly";

type ToolRule = {
  category: ToolCategory;
  /** Permission switch that must be enabled for the tool to be usable at all. */
  switch:
    | keyof ToolPermissionSettings
    | Array<keyof ToolPermissionSettings>;
  /** `dangerous` forces an approval prompt in every execution mode. */
  dangerous?: boolean;
  /** `write_file` may edit an existing file or create a missing one. */
  operation?: "write" | "write-or-create" | "patch" | "delete" | "rename";
};

const TOOL_RULES: Record<string, ToolRule> = {
  // Read-only tools
  read_file: { category: "read_only", switch: "readFiles" },
  list_directory: { category: "read_only", switch: "readFiles" },
  list_files: { category: "read_only", switch: "readFiles" },
  get_project_info: { category: "read_only", switch: "readFiles" },
  inspect_file: { category: "read_only", switch: "readFiles" },
  get_file_diff: { category: "read_only", switch: "readFiles" },
  get_workspace_status: { category: "read_only", switch: "readFiles" },
  search_files: { category: "read_only", switch: "searchRepository" },
  search_repository: { category: "read_only", switch: "searchRepository" },
  search_repository_context: {
    category: "read_only",
    switch: "searchRepository",
  },
  lookup_symbol: { category: "read_only", switch: "searchRepository" },
  repository_metadata: { category: "read_only", switch: "searchRepository" },
  git_status: { category: "read_only", switch: "readFiles" },
  git_diff: { category: "read_only", switch: "readFiles" },
  git_diff_staged: { category: "read_only", switch: "readFiles" },
  git_branch: { category: "read_only", switch: "readFiles" },
  git_log: { category: "read_only", switch: "readFiles" },
  git_show: { category: "read_only", switch: "readFiles" },
  git_blame: { category: "read_only", switch: "readFiles" },
  get_git_status: { category: "read_only", switch: "readFiles" },

  // Mutating tools
  write_file: {
    category: "mutating",
    switch: ["editFiles", "createFiles"],
    operation: "write-or-create",
  },
  apply_patch: {
    category: "mutating",
    switch: "editFiles",
    operation: "patch",
  },
  edit_file: {
    category: "mutating",
    switch: "editFiles",
    operation: "patch",
  },
  create_file: {
    category: "mutating",
    switch: "createFiles",
    operation: "write",
  },
  delete_file: {
    category: "mutating",
    switch: "deleteFiles",
    operation: "delete",
    dangerous: true,
  },
  rename_file: {
    category: "mutating",
    switch: "renameFiles",
    operation: "rename",
  },
  move_file: {
    category: "mutating",
    switch: "renameFiles",
    operation: "rename",
  },

  // Execution tools
  run_command: { category: "execution", switch: "runCommands" },
  run_tests: { category: "execution", switch: "runTests" },
  verify_changes: {
    category: "execution",
    switch: ["runTests", "runBuilds"],
  },
};

/** Tools the model may never call, even if they appear in a tool registry. */
const ALWAYS_DENIED = new Set<string>([]);

export function toolRule(name: string): ToolRule | undefined {
  return TOOL_RULES[name];
}

export function isKnownTool(name: string): boolean {
  return name in TOOL_RULES;
}

/** Commands that always require an explicit user decision. */
export function commandRisks(command: string): CommandRisk[] {
  return classifyCommand(command);
}

const HIGH_RISK: readonly CommandRisk[] = [
  "DESTRUCTIVE",
  "PRIVILEGED",
  "DEPENDENCY_CHANGE",
];

function isHighRisk(risks: CommandRisk[]): boolean {
  return risks.some((risk) => HIGH_RISK.includes(risk));
}

function switchEnabled(
  permissions: ToolPermissionSettings,
  rule: ToolRule,
  input: unknown,
): boolean {
  const keys = Array.isArray(rule.switch) ? rule.switch : [rule.switch];
  const requestedPath =
    rule.category === "mutating" && input && typeof input === "object"
      ? (input as { path?: unknown }).path
      : undefined;
  // `write_file` without a path cannot be classified; require at least one of
  // the two switches so the call is never silently allowed.
  if (keys.length > 1) {
    return keys.some((key) => permissions[key] === true);
  }
  void requestedPath;
  return permissions[keys[0]] === true;
}

/**
 * Decide whether a tool call may proceed.
 *
 * `exists` lets the caller tell `write_file` apart into edit/create so the two
 * independent settings switches keep working exactly as the settings UI
 * describes them.
 */
export function decidePermission(
  request: {
    toolName: string;
    input?: unknown;
    executionMode: ExecutionMode;
    permissions: ToolPermissionSettings;
    /** Result of a workspace-contained existence check for mutating tools. */
    targetExists?: boolean;
    /** Command text when the tool executes a shell command. */
    command?: string;
  },
  ): PermissionVerdict {
  const { toolName, input, executionMode, permissions } = request;
  const rule = TOOL_RULES[toolName];

  if (!rule) {
    return {
      decision: "deny",
      reason: "unknown-tool",
      category: "mutating",
      risks: [],
      summary: `Tool "${toolName}" is not in the permission catalog.`,
    };
  }

  if (ALWAYS_DENIED.has(toolName)) {
    return {
      decision: "deny",
      reason: "blocked-tool",
      category: rule.category,
      risks: [],
      summary: `Tool "${toolName}" is disabled for agent use.`,
    };
  }

  const risks =
    rule.category === "execution" && request.command
      ? commandRisks(request.command)
      : [];

  // A missing settings switch is a hard stop: the user explicitly disabled it.
  if (rule.operation === "write-or-create") {
    const canEdit = permissions.editFiles === true;
    const canCreate = permissions.createFiles === true;
    const allowed =
      request.targetExists === undefined
        ? canEdit || canCreate
        : request.targetExists
          ? canEdit
          : canCreate;
    if (!allowed) {
      return {
        decision: "deny",
        reason: request.targetExists
          ? "edit-files-disabled"
          : "create-files-disabled",
        category: rule.category,
        risks,
        summary: request.targetExists
          ? "Editing existing files is disabled in settings."
          : "Creating files is disabled in settings.",
      };
    }
  } else if (!switchEnabled(permissions, rule, input)) {
    return {
      decision: "deny",
      reason: `permission-disabled:${Array.isArray(rule.switch) ? rule.switch.join("+") : rule.switch}`,
      category: rule.category,
      risks,
      summary: `The "${toolName}" permission is disabled in settings.`,
    };
  }

  if (rule.category === "execution" && risks.includes("DESTRUCTIVE")) {
    return {
      decision: "ask",
      reason: "destructive-command",
      category: rule.category,
      risks,
      summary: "This command can delete data and always requires approval.",
    };
  }

  if (executionMode === "plan" || executionMode === "readonly") {
    if (rule.category !== "read_only") {
      return {
        decision: "deny",
        reason: `execution-mode:${executionMode}`,
        category: rule.category,
        risks,
        summary: `${executionMode} mode only allows read-only tools.`,
      };
    }
    return {
      decision: "allow",
      reason: "read-only",
      category: rule.category,
      risks,
      summary: "Read-only tool.",
    };
  }

  if (rule.dangerous) {
    return {
      decision: "ask",
      reason: "dangerous-tool",
      category: rule.category,
      risks,
      summary: `"${toolName}" is a dangerous operation and always requires approval.`,
    };
  }

  if (rule.category === "execution") {
    if (rule.switch === "runCommands") {
      const testLike =
        /(^|\s)(npm\s+(run\s+)?test|npx\s+(jest|vitest)|pytest|go\s+test|cargo\s+test|make\s+test)(\s|$)/i.test(
          request.command ?? "",
        );
      const buildLike =
        /(^|\s)(npm\s+(run\s+)?build|tsc(\s|$)|vite\s+build|electron-builder|go\s+build|cargo\s+build|make)(\s|$)/i.test(
          request.command ?? "",
        );
      if (testLike && !permissions.runTests) {
        return {
          decision: "deny",
          reason: "run-tests-disabled",
          category: rule.category,
          risks,
          summary: "Running tests is disabled in settings.",
        };
      }
      if (buildLike && !permissions.runBuilds) {
        return {
          decision: "deny",
          reason: "run-builds-disabled",
          category: rule.category,
          risks,
          summary: "Running builds is disabled in settings.",
        };
      }
    }
    if (executionMode === "auto" && !isHighRisk(risks)) {
      return {
        decision: "allow",
        reason: "auto-mode",
        category: rule.category,
        risks,
        summary: "Auto mode allows this command.",
      };
    }
    return {
      decision: "ask",
      reason: isHighRisk(risks)
        ? "high-risk-command"
        : executionMode === "auto"
          ? "high-risk-command"
          : "review-mode",
      category: rule.category,
      risks,
      summary: `Approval required to run: ${request.command ?? toolName}`,
    };
  }

  if (rule.category === "mutating") {
    if (!permissions.networkTools && risks.includes("NETWORK")) {
      return {
        decision: "deny",
        reason: "network-tools-disabled",
        category: rule.category,
        risks,
        summary: "Network tools are disabled in settings.",
      };
    }
    if (executionMode === "auto") {
      return {
        decision: "allow",
        reason: "auto-mode",
        category: rule.category,
        risks,
        summary: "Auto mode allows this edit.",
      };
    }
    // review mode: the change still has to pass the hash-guarded change
    // approval, but the tool call itself is allowed to run and propose.
    return {
      decision: "allow",
      reason: "review-mode-proposes-change",
      category: rule.category,
      risks,
      summary: "The tool may propose a change; applying it still needs approval.",
    };
  }

  return {
    decision: "allow",
    reason: "read-only",
    category: "read_only",
    risks,
    summary: "Read-only tool.",
  };
}

/** All tools the agent may ever see, grouped for diagnostics and docs. */
export function permissionCatalog(): Record<ToolCategory, string[]> {
  const catalog: Record<ToolCategory, string[]> = {
    read_only: [],
    mutating: [],
    execution: [],
  };
  for (const [name, rule] of Object.entries(TOOL_RULES)) {
    catalog[rule.category].push(name);
  }
  return catalog;
}
