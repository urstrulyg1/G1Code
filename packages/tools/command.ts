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
export type ExecutableCommand = { executable: string; args?: string[]; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number };
export type CommandSpec = ExecutableCommand | { shellCommand: string; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number };
function streamQueue(stream: NodeJS.ReadableStream, append: (value: string) => void) {
  const values: string[] = [];
  const waiters: Array<(result: IteratorResult<string>) => void> = [];
  let ended = false;
  stream.on("data", (chunk: Buffer) => {
    const value = chunk.toString();
    append(value);
    const waiter = waiters.shift();
    if (waiter) waiter({ value, done: false });
    else values.push(value);
  });
  stream.once("end", () => {
    ended = true;
    while (waiters.length) waiters.shift()!({ value: undefined, done: true });
  });
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (values.length) yield values.shift()!;
        else if (ended) return;
        else {
          const next = await new Promise<IteratorResult<string>>((resolve) => waiters.push(resolve));
          if (next.done) return;
          yield next.value;
        }
      }
    },
  } as AsyncIterable<string>;
}
export function spawnCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): CommandExecution {
  const safeEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH)/i.test(key)),
  );
  const child = spawn(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-lc", command],
    { cwd, windowsHide: true, env: safeEnvironment, detached: process.platform !== "win32" },
  );
  const started = Date.now();
  let collectedStdout = "";
  let collectedStderr = "";
  let truncated = false;
  const limit = 1_000_000;
  const collect = (target: "stdout" | "stderr") => (value: string) => {
    if (target === "stdout") collectedStdout += value;
    else collectedStderr += value;
    if (collectedStdout.length + collectedStderr.length > limit) {
      collectedStdout = collectedStdout.slice(0, 500_000);
      collectedStderr = collectedStderr.slice(0, 500_000);
      truncated = true;
      child.kill();
    }
  };
  const stdout = streamQueue(child.stdout, collect("stdout"));
  const stderr = streamQueue(child.stderr, collect("stderr"));
  const cancel = () => {
    if (!child.killed) {
      try {
        if (process.platform !== "win32") process.kill(-child.pid!, "SIGTERM");
        else child.kill();
      } catch {
        // The process may have exited between the check and signal delivery.
      }
    }
  };
  const timeout = setTimeout(() => cancel(), 120_000);
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  }
  const wait = () =>
    new Promise<CommandResult>((resolve) =>
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve({
          stdout: collectedStdout,
          stderr: collectedStderr,
          exitCode: code ?? 1,
          duration: Date.now() - started,
          truncated,
        });
      }),
    );
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    process: child,
    stdout,
    stderr,
    wait,
    cancel: async () => cancel(),
  };
}

export function spawnExecutable(command: ExecutableCommand, signal?: AbortSignal): CommandExecution {
  return spawnSpec(command, signal);
}

export function spawnShell(command: { shellCommand: string; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }, signal?: AbortSignal): CommandExecution {
  return spawnSpec(command, signal);
}

function spawnSpec(command: CommandSpec, signal?: AbortSignal): CommandExecution {
  const executable = "executable" in command ? command.executable : process.platform === "win32" ? "cmd.exe" : "sh";
  const args = "executable" in command ? command.args ?? [] : process.platform === "win32" ? ["/d", "/s", "/c", command.shellCommand] : ["-lc", command.shellCommand];
  const safeEnvironment = Object.fromEntries(Object.entries(command.env ?? process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH)/i.test(key)));
  const child = spawn(executable, args, { cwd: command.cwd, windowsHide: true, env: safeEnvironment, detached: process.platform !== "win32" });
  const started = Date.now();
  let stdoutText = "";
  let stderrText = "";
  let truncated = false;
  const limit = 1_000_000;
  const collect = (target: "stdout" | "stderr") => (value: string) => {
    if (target === "stdout") stdoutText += value; else stderrText += value;
    if (stdoutText.length + stderrText.length > limit) { stdoutText = stdoutText.slice(0, 500_000); stderrText = stderrText.slice(0, 500_000); truncated = true; cancel(); }
  };
  const stdout = streamQueue(child.stdout, collect("stdout"));
  const stderr = streamQueue(child.stderr, collect("stderr"));
  const cancel = () => { if (!child.killed) { try { process.platform === "win32" ? child.kill() : process.kill(-child.pid!, "SIGTERM"); } catch { /* exited */ } } };
  const timeout = setTimeout(cancel, command.timeoutMs ?? 120_000);
  if (signal) { if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true }); }
  const wait = () => new Promise<CommandResult>((resolve) => child.once("close", (code) => { clearTimeout(timeout); resolve({ stdout: stdoutText, stderr: stderrText, exitCode: code ?? 1, duration: Date.now() - started, truncated }); }));
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, process: child, stdout, stderr, wait, cancel: async () => cancel() };
}
