import {
  spawnExecutable,
  type CommandExecution,
  type CommandResult,
} from "../tools/command";
import { Project } from "./detector";
import { TestCandidate } from "./discovery";
import { targetedCommand, targetedExecutable } from "./selector";

export type TestRun = {
  command: string;
  cwd: string;
  targeted: boolean;
  exitCode?: number;
  passed?: boolean;
  result?: CommandResult;
};
export async function runTests(
  project: Project,
  cwd: string,
  candidates: TestCandidate[],
  signal?: AbortSignal,
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void,
  /** Phase 4: lets the caller register the child process for cancellation. */
  onExecution?: (execution: CommandExecution) => void,
): Promise<TestRun> {
  const targeted = candidates.length > 0;
  const command = targetedCommand(project, candidates);
  const execution = spawnExecutable(
    { ...targetedExecutable(project, candidates), cwd, timeoutMs: 120_000 },
    signal,
  );
  onExecution?.(execution);
  const drain = async (
    stream: AsyncIterable<string>,
    kind: "stdout" | "stderr",
  ) => {
    for await (const chunk of stream) onOutput?.(kind, chunk);
  };
  const [result] = await Promise.all([
    execution.wait(),
    drain(execution.stdout, "stdout"),
    drain(execution.stderr, "stderr"),
  ]);
  return {
    command,
    cwd,
    targeted,
    exitCode: result.exitCode,
    passed: result.exitCode === 0,
    result,
  };
}
