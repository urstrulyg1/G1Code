import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  truncated: boolean;
};
export type CommandExecution = {
  id: string;
  process: ChildProcessWithoutNullStreams;
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  wait(): Promise<CommandResult>;
  cancel(): Promise<void>;
};
async function* chunks(stream: NodeJS.ReadableStream) {
  for await (const chunk of stream) yield String(chunk);
}
export function spawnCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): CommandExecution {
  const child = spawn(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-lc", command],
    { cwd, windowsHide: true },
  );
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const limit = 1_000_000;
  const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
    const value = chunk.toString();
    if (target === "stdout") stdout += value;
    else stderr += value;
    if (stdout.length + stderr.length > limit) {
      stdout = stdout.slice(0, 500_000);
      stderr = stderr.slice(0, 500_000);
      truncated = true;
      child.kill();
    }
  };
  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  const cancel = () => {
    if (!child.killed) child.kill();
  };
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  }
  const wait = () =>
    new Promise<CommandResult>((resolve) =>
      child.once("close", (code) =>
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          duration: Date.now() - started,
          truncated,
        }),
      ),
    );
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    process: child,
    stdout: chunks(child.stdout),
    stderr: chunks(child.stderr),
    wait,
    cancel: async () => cancel(),
  };
}
