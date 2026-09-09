import { AgentTool } from "./types";
import { safePath } from "./workspace";
import { spawnCommand } from "./command";

async function runGit(
  args: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await spawnCommand(
    `git --no-pager ${args}`,
    cwd,
    signal,
  ).wait();
  return (result.stdout + result.stderr).trim();
}

export function gitTools(): AgentTool[] {
  const simple = ["status", "diff", "branch", "log"].map((action) => ({
    name: `git_${action}`,
    description: `Read-only git ${action} for the workspace.`,
    permission: "safe" as const,
    inputSchema: { type: "object", properties: {} },
    execute: async (
      _input: unknown,
      context: import("./types").ToolContext,
    ) => {
      const cwd = safePath(context.workspace, ".");
      const result = await spawnCommand(
        `git --no-pager ${action}`,
        cwd,
        context.signal,
      ).wait();
      return {
        content: JSON.stringify(result),
        isError: result.exitCode !== 0,
        exitCode: result.exitCode,
      };
    },
  }));

  const combined: AgentTool = {
    name: "get_git_status",
    description:
      "Returns a full git context summary: current branch, list of modified/untracked files, last 5 commit messages, and a short diff of staged changes. Use this at the start of any git-related task.",
    permission: "safe",
    inputSchema: { type: "object", properties: {} },
    execute: async (_input, context) => {
      const cwd = safePath(context.workspace, ".");
      const [branch, status, log, diff] = await Promise.all([
        runGit("rev-parse --abbrev-ref HEAD", cwd, context.signal),
        runGit("status --short", cwd, context.signal),
        runGit("log --oneline -5", cwd, context.signal),
        runGit("diff --stat HEAD", cwd, context.signal),
      ]);
      return {
        content: JSON.stringify({
          branch,
          status,
          recentCommits: log,
          diffStat: diff,
        }),
      };
    },
  };

  return [...simple, combined];
}
