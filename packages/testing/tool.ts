import { detectProject } from "./detector";
import { discoverTests } from "./discovery";
import { runTests } from "./runner";
import { classifyCommand } from "../tools/command-policy";
import type { AgentTool } from "../tools/types";
import { redactSecrets } from "../security/redaction";

export function testingTools(): AgentTool[] {
  return [
    {
      name: "run_tests",
      description:
        "Detect the project test system, run related tests for the supplied changed paths, and return real streamed test evidence.",
      permission: "moderate",
      inputSchema: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" } } },
        required: ["paths"],
      },
      execute: async (value, context) => {
        const paths = (value as { paths?: unknown }).paths;
        if (
          !Array.isArray(paths) ||
          paths.some((item) => typeof item !== "string" || item.length > 500)
        )
          return { content: "Invalid test paths.", isError: true };
        const project = await detectProject(context.workspace);
        if (!project)
          return {
            content: "No supported project test system was detected.",
            isError: true,
          };
        const candidates = await discoverTests(
          context.workspace,
          paths as string[],
          project,
        );
        const command = candidates.length
          ? `${project.testCommand} (targeted)`
          : project.testCommand;
        if (
          !(await context.approve(testingTools()[0], {
            command,
            cwd: context.workspace,
            targeted: candidates.length > 0,
            risk: classifyCommand(project.testCommand),
          }))
        )
          return { content: "User denied test execution.", isError: true };
        context.emit({
          type: "command",
          toolCallId: context.toolCallId,
          action: "started",
          command,
          message: `Running ${command}`,
        });
        const run = await runTests(
          project,
          context.workspace,
          candidates,
          context.signal,
          (stream, chunk) => {
            const redactedChunk = redactSecrets(chunk);
            context.emit({
              type: "command",
              toolCallId: context.toolCallId,
              action: "chunk",
              command,
              stream: stream === "stdout" ? "stdout" : "stderr",
              chunk: redactedChunk,
              message: redactedChunk,
            });
          },
        );
        const cleanStdout = redactSecrets(run.result?.stdout || "");
        const cleanStderr = redactSecrets(run.result?.stderr || "");
        context.recordTestRun?.({
          command: run.command,
          cwd: run.cwd,
          targeted: run.targeted,
          exitCode: run.exitCode,
          passed: run.passed,
          stdout: cleanStdout,
          stderr: cleanStderr,
          duration: run.result?.duration,
        });
        context.emit({
          type: "command",
          toolCallId: context.toolCallId,
          action: run.passed ? "completed" : "failed",
          command: run.command,
          exitCode: run.exitCode,
          duration: run.result?.duration,
          message: `Test command exited ${run.exitCode}`,
        });
        return {
          content: JSON.stringify({
            project: project.type,
            command: run.command,
            targeted: run.targeted,
            executionSucceeded: run.exitCode !== undefined,
            testsPassed: run.passed,
            exitCode: run.exitCode,
            stdout: cleanStdout,
            stderr: cleanStderr,
            duration: run.result?.duration,
            tests: candidates,
          }),
          isError: !run.passed,
          exitCode: run.exitCode,
          duration: run.result?.duration,
          stdout: cleanStdout,
          stderr: cleanStderr,
        };
      },
    },
  ];
}
