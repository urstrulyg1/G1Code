import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentTool } from "./types";
import { spawnCommand } from "./command";
import { redactSecrets } from "../security/redaction";
const exec = promisify(execFile);
export function safePath(workspace: string, requested: string) {
  const windowsStyle = /^[A-Za-z]:[\\/]/.test(workspace);
  const pathApi = windowsStyle ? path.win32 : path;
  const resolved = pathApi.resolve(workspace, requested);
  const root = pathApi.resolve(workspace);
  if (windowsStyle) {
    const normResolved = resolved.toLowerCase();
    const normRoot = root.toLowerCase();
    if (
      normResolved !== normRoot &&
      !normResolved.startsWith(`${normRoot}${pathApi.sep}`)
    ) {
      throw new Error("Path is outside the selected workspace");
    }
  } else {
    if (resolved !== root && !resolved.startsWith(`${root}${pathApi.sep}`)) {
      throw new Error("Path is outside the selected workspace");
    }
  }
  return resolved;
}
export async function safeRealPath(workspace: string, requested: string) {
  const candidate = safePath(workspace, requested);
  const root = await fs.realpath(workspace);
  let existing = await fs.realpath(candidate).catch(() => null);
  if (!existing) {
    existing = candidate;
    while (true) {
      try {
        const realParent = await fs.realpath(path.dirname(existing));
        existing = path.join(realParent, path.basename(existing));
        break;
      } catch {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        existing = parent;
      }
    }
  }
  if (existing !== root && !existing.startsWith(`${root}${path.sep}`))
    throw new Error("Path resolves outside the selected workspace");
  return candidate;
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
      if (typeof data?.path !== "string") {
        throw new TypeError("The 'path' argument must be a string.");
      }
      const file = await safeRealPath(context.workspace, data.path);
      let stat: any;
      try {
        stat = await fs.stat(file);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return {
            content: `File not found: "${data.path}". Check directory contents with list_directory or search with search_files to find the exact path.`,
            isError: true,
          };
        }
        return {
          content: `Failed to access file "${data.path}": ${err.message}`,
          isError: true,
        };
      }
      if (stat.isDirectory()) {
        return {
          content: `"${data.path}" is a directory, not a file. Use list_directory to inspect its contents.`,
          isError: true,
        };
      }
      if (stat.size > 2_000_000 && data.startLine === undefined)
        return {
          content: `File is too large (${stat.size} bytes); provide startLine and endLine.`,
          isError: true,
        };
      let full: string;
      try {
        full = await fs.readFile(file, "utf8");
      } catch (err: any) {
        return {
          content: `Failed to read file "${data.path}": ${err.message}`,
          isError: true,
        };
      }
      const lines = full.split(/\r?\n/);
      const start = Math.max(1, data.startLine ?? 1);
      const end = Math.min(lines.length, data.endLine ?? lines.length);
      const relPath = path.relative(context.workspace, file);
      return {
        content: JSON.stringify({
          path: relPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          startLine: start,
          endLine: end,
          lineCount: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
        }),
        path: relPath,
        lineCount: lines.length,
      };
    },
  },
  {
    name: "list_directory",
    description: "List files and directories inside the workspace.",
    permission: "safe",
    inputSchema: input({ path: { type: "string" } }),
    execute: async (value, context) => {
      let directory: string;
      try {
        directory = await safeRealPath(
          context.workspace,
          String((value as { path: string }).path ?? "."),
        );
      } catch (err) {
        return {
          content: `Path error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
      let entries: any[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (err: any) {
        return {
          content: `Failed to list directory: ${err.message}`,
          isError: true,
        };
      }
      const IGNORE = new Set([
        "node_modules",
        ".git",
        ".next",
        "dist",
        "dist-electron",
        ".cache",
        "coverage",
      ]);
      return {
        content: JSON.stringify(
          entries
            .filter(
              (entry) => !IGNORE.has(entry.name) && !entry.name.startsWith("."),
            )
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? "directory" : "file",
            })),
        ),
      };
    },
  },
  {
    name: "get_project_info",
    description:
      "Returns project metadata: package.json (name, scripts, dependencies) and README excerpt. Use this at the start of any task to understand the project structure before diving in.",
    permission: "safe",
    inputSchema: { type: "object", properties: {} },
    execute: async (_value, context) => {
      const results: Record<string, unknown> = {};
      try {
        const pkgRaw = await fs.readFile(
          path.join(context.workspace, "package.json"),
          "utf8",
        );
        const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
        results.package = {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          scripts: pkg.scripts,
          dependencies: Object.keys(
            (pkg.dependencies as Record<string, string>) || {},
          ).slice(0, 20),
          devDependencies: Object.keys(
            (pkg.devDependencies as Record<string, string>) || {},
          ).slice(0, 20),
        };
      } catch {
        results.package = null;
      }
      try {
        const readme = await fs.readFile(
          path.join(context.workspace, "README.md"),
          "utf8",
        );
        results.readme = readme.slice(0, 1500);
      } catch {
        results.readme = null;
      }
      try {
        const entries = await fs.readdir(context.workspace, {
          withFileTypes: true,
        });
        const IGNORE = new Set([
          "node_modules",
          ".git",
          ".next",
          "dist",
          "dist-electron",
          "coverage",
        ]);
        results.rootFiles = entries
          .filter((e) => !IGNORE.has(e.name))
          .map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? "directory" : "file",
          }));
      } catch {
        results.rootFiles = [];
      }
      return { content: JSON.stringify(results, null, 2) };
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
      const directory = await safeRealPath(
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
      const output = result.stdout || "No matches found.";
      const lines =
        output.trim() && !output.includes("No matches found")
          ? output
              .trim()
              .split("\n")
              .filter((l) => Boolean(l.trim()))
          : [];
      return {
        content: output,
        matchesCount: lines.length,
      };
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
      const file = await safeRealPath(
        context.workspace,
        String((value as { path: string }).path),
      );
      const original = await fs.readFile(file, "utf8").catch(() => "");
      if (!context.changeService || !context.sessionId)
        return {
          content: "Change service is unavailable; file was not changed.",
          isError: true,
        };
      const proposed = String((value as { content: string }).content);
      const change = await context.changeService.proposeChange(
        context.sessionId,
        path.relative(context.workspace, file),
        proposed,
      );
      context.emit({
        type: "CHANGE_PROPOSED",
        message: `Waiting for approval: ${change.path}`,
        detail: change.id,
      });
      return {
        content: JSON.stringify({
          status: "pending_approval",
          changeId: change.id,
          path: change.path,
          diff: change.patch,
          message: "Waiting for user approval.",
        }),
        status: "pending_approval",
        changeId: change.id,
        path: change.path,
        diff: change.patch,
      };
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
      const file = await safeRealPath(context.workspace, data.path);
      const original = await fs.readFile(file, "utf8");
      if (!original.includes(data.search))
        return {
          content: "Patch search text was not found; file was not changed.",
          isError: true,
        };
      const proposed = original.replace(data.search, data.replace);
      if (!context.changeService || !context.sessionId)
        return {
          content: "Change service is unavailable; file was not changed.",
          isError: true,
        };
      const change = await context.changeService.proposeChange(
        context.sessionId,
        data.path,
        proposed,
      );
      context.emit({
        type: "CHANGE_PROPOSED",
        message: `Waiting for approval: ${change.path}`,
        detail: change.id,
      });
      return {
        content: JSON.stringify({
          status: "pending_approval",
          changeId: change.id,
          path: change.path,
          diff: change.patch,
          message: "Waiting for user approval.",
        }),
        status: "pending_approval",
        changeId: change.id,
        path: change.path,
        diff: change.patch,
      };
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the workspace directory (e.g. npm test, npm run build, tsc, git status). Use for running tests, linting, builds, or inspecting command output. Requires user approval for destructive commands. Output is truncated at 30KB.",
    permission: "moderate",
    inputSchema: input({
      command: { type: "string" },
      cwd: { type: "string" },
    }),
    execute: async (value, context) => {
      const data = value as { command: string; cwd?: string };
      const cwd = await safeRealPath(context.workspace, data.cwd ?? ".");
      const dangerous =
        /(^|\s)(rm|del|format|sudo)|git\s+(reset|clean|push)|npm\s+install/i.test(
          data.command,
        );
      const self = workspaceTools().find((t) => t.name === "run_command")!;
      if (
        dangerous ||
        !(await context.approve(self, { command: data.command, cwd }))
      )
        return { content: "User denied command execution.", isError: true };
      const execution = spawnCommand(data.command, cwd, context.signal);
      context.emit({
        type: "command",
        toolCallId: context.toolCallId,
        action: "started",
        command: data.command,
        message: `COMMAND_STARTED ${data.command}`,
      });
      const MAX_OUTPUT = 30_000;
      const drain = async (
        stream: AsyncIterable<string>,
        streamType: "stdout" | "stderr",
      ) => {
        let buffered = "";
        let total = 0;
        for await (const chunk of stream) {
          if (total >= MAX_OUTPUT) break;
          const redactedChunk = redactSecrets(chunk);
          buffered += redactedChunk;
          total += redactedChunk.length;
          if (buffered.length >= 2048) {
            context.emit({
              type: "command",
              toolCallId: context.toolCallId,
              action: "chunk",
              command: data.command,
              stream: streamType,
              chunk: buffered,
              message: buffered,
            });
            buffered = "";
          }
        }
        if (buffered) {
          context.emit({
            type: "command",
            toolCallId: context.toolCallId,
            action: "chunk",
            command: data.command,
            stream: streamType,
            chunk: buffered,
            message: buffered,
          });
        }
      };
      const [result] = await Promise.all([
        execution.wait(),
        drain(execution.stdout, "stdout"),
        drain(execution.stderr, "stderr"),
      ]);
      const redactedStdout = redactSecrets(result.stdout || "");
      const redactedStderr = redactSecrets(result.stderr || "");
      const isSuccess = result.exitCode === 0;
      context.emit({
        type: "command",
        toolCallId: context.toolCallId,
        action: isSuccess ? "completed" : "failed",
        command: data.command,
        exitCode: result.exitCode,
        duration: result.duration,
        message: isSuccess
          ? "COMMAND_COMPLETED exit 0"
          : `COMMAND_FAILED exit ${result.exitCode}`,
      });
      const truncatedStdout = redactedStdout.slice(0, MAX_OUTPUT);
      const truncatedStderr = redactedStderr.slice(0, MAX_OUTPUT);
      return {
        content: JSON.stringify({
          ...result,
          stdout: truncatedStdout,
          stderr: truncatedStderr,
        }),
        isError: !isSuccess,
        exitCode: result.exitCode,
        duration: result.duration,
        stdout: truncatedStdout,
        stderr: truncatedStderr,
      };
    },
  },
];
