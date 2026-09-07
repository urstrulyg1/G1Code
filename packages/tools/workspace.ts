import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentTool } from "./types";
import { spawnCommand } from "./command";
const exec = promisify(execFile);
export function safePath(workspace: string, requested: string) {
  const resolved = path.resolve(workspace, requested);
  const root = path.resolve(workspace);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error("Path is outside the selected workspace");
  return resolved;
}
const input = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});
export const workspaceTools = (): AgentTool[] => [
  {
    name: "read_file",
    description: "Read a UTF-8 file section inside the workspace.",
    permission: "safe",
    inputSchema: input({
      path: { type: "string" },
      startLine: { type: "number" },
      endLine: { type: "number" },
    }),
    execute: async (value, context) => {
      const data = value as {
        path: string;
        startLine?: number;
        endLine?: number;
      };
      const file = safePath(context.workspace, data.path);
      const stat = await fs.stat(file);
      if (stat.size > 2_000_000 && data.startLine === undefined)
        return {
          content: `File is too large (${stat.size} bytes); provide startLine and endLine.`,
          isError: true,
        };
      const full = await fs.readFile(file, "utf8");
      const lines = full.split(/\r?\n/);
      const start = Math.max(1, data.startLine ?? 1);
      const end = Math.min(lines.length, data.endLine ?? lines.length);
      return {
        content: JSON.stringify({
          path: file,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          startLine: start,
          endLine: end,
          content: lines.slice(start - 1, end).join("\n"),
        }),
      };
    },
  },
  {
    name: "list_directory",
    description: "List files and directories inside the workspace.",
    permission: "safe",
    inputSchema: input({ path: { type: "string" } }),
    execute: async (value, context) => {
      const directory = safePath(
        context.workspace,
        String((value as { path: string }).path ?? "."),
      );
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return {
        content: JSON.stringify(
          entries
            .filter((entry) => !entry.name.startsWith("node_modules"))
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? "directory" : "file",
            })),
        ),
      };
    },
  },
  {
    name: "search_files",
    description:
      "Search text in workspace files without sending the repository wholesale.",
    permission: "safe",
    inputSchema: input({ query: { type: "string" }, path: { type: "string" } }),
    execute: async (value, context) => {
      const query = String((value as { query: string }).query);
      const directory = safePath(
        context.workspace,
        String((value as { path?: string }).path ?? "."),
      );
      const command =
        process.platform === "win32"
          ? [
              "-NoProfile",
              "-Command",
              `Get-ChildItem -LiteralPath '${directory.replace(/'/g, "''")}' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|\\.git\\' } | Select-String -SimpleMatch -Pattern '${query.replace(/'/g, "''")}' | Select-Object -First 100 Path,LineNumber,Line`,
            ]
          : [
              "-lc",
              `rg -n --hidden --glob '!node_modules' --glob '!.git' ${JSON.stringify(query)} ${JSON.stringify(directory)} || true`,
            ];
      const result = await exec(
        process.platform === "win32" ? "powershell.exe" : "sh",
        command,
        { cwd: context.workspace, timeout: 30000, maxBuffer: 500_000 },
      );
      return { content: result.stdout || "No matches found." };
    },
  },
  {
    name: "write_file",
    description: "Write a file inside the workspace after approval.",
    permission: "moderate",
    inputSchema: input({
      path: { type: "string" },
      content: { type: "string" },
    }),
    execute: async (value, context) => {
      const file = safePath(
        context.workspace,
        String((value as { path: string }).path),
      );
      const original = await fs.readFile(file, "utf8").catch(() => "");
      const approved = await context.approve(workspaceTools()[3], {
        path: file,
        original,
        proposed: String((value as { content: string }).content),
      });
      if (!approved)
        return { content: "User rejected file change.", isError: true };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        String((value as { content: string }).content),
        "utf8",
      );
      return { content: `Applied change to ${file}` };
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a SEARCH/REPLACE patch to a workspace file after approval.",
    permission: "moderate",
    inputSchema: input({
      path: { type: "string" },
      search: { type: "string" },
      replace: { type: "string" },
    }),
    execute: async (value, context) => {
      const data = value as { path: string; search: string; replace: string };
      const file = safePath(context.workspace, data.path);
      const original = await fs.readFile(file, "utf8");
      if (!original.includes(data.search))
        return {
          content: "Patch search text was not found; file was not changed.",
          isError: true,
        };
      const proposed = original.replace(data.search, data.replace);
      const approved = await context.approve(workspaceTools()[4], {
        path: file,
        original,
        proposed,
      });
      if (!approved) return { content: "User rejected patch.", isError: true };
      await fs.writeFile(file, proposed, "utf8");
      return { content: `Applied patch to ${file}` };
    },
  },
  {
    name: "run_command",
    description:
      "Run a command in the workspace. Dangerous commands require explicit approval.",
    permission: "moderate",
    inputSchema: input({
      command: { type: "string" },
      cwd: { type: "string" },
    }),
    execute: async (value, context) => {
      const data = value as { command: string; cwd?: string };
      const cwd = safePath(context.workspace, data.cwd ?? ".");
      const dangerous =
        /(^|\s)(rm|del|format|sudo)|git\s+(reset|clean|push)|npm\s+install/i.test(
          data.command,
        );
      const tool = workspaceTools()[5];
      if (
        dangerous ||
        !(await context.approve(tool, { command: data.command, cwd }))
      )
        return { content: "User denied command execution.", isError: true };
      const execution = spawnCommand(data.command, cwd, context.signal);
      const result = await execution.wait();
      return {
        content: JSON.stringify(result),
        isError: result.exitCode !== 0,
        exitCode: result.exitCode,
      };
    },
  },
];
