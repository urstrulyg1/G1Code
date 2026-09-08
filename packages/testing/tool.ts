import { detectProject } from "./detector";
import { discoverTests } from "./discovery";
import { runTests } from "./runner";
import { classifyCommand } from "../tools/command-policy";
import type { AgentTool } from "../tools/types";

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
          type: "COMMAND_STARTED",
          message: `Running ${command}`,
        });
        const run = await runTests(
          project,
          context.workspace,
          candidates,
          context.signal,
          (stream, chunk) => {
            context.emit({
              type: stream === "stdout" ? "COMMAND_STDOUT" : "COMMAND_STDERR",
              message: chunk,
            });
          },
        );
        context.recordTestRun?.({
          command: run.command,
          cwd: run.cwd,
          targeted: run.targeted,
          exitCode: run.exitCode,
          passed: run.passed,
          stdout: run.result?.stdout,
          stderr: run.result?.stderr,
          duration: run.result?.duration,
        });
        context.emit({
          type: run.passed ? "COMMAND_COMPLETED" : "COMMAND_FAILED",
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
            stdout: run.result?.stdout,
            stderr: run.result?.stderr,
            tests: candidates,
          }),
          isError: !run.passed,
          exitCode: run.exitCode,
        };
      },
    },
  ];
}
