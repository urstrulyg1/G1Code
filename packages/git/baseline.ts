import { spawnCommand } from "../tools/command";

export type GitBaseline = {
  branch: string;
  head: string;
  status: string;
  diff: string;
  modifiedFiles: string[];
  capturedAt: string;
};

export type GitAttribution = {
  preExisting: string[];
  agent: string[];
  overlapping: string[];
};

export function attributeFiles(baseline: GitBaseline, agentFiles: string[], currentStatus: string): GitAttribution {
  const before = new Set(baseline.modifiedFiles);
  const current = new Set(currentStatus.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()));
  const agent = new Set(agentFiles);
  const preExisting: string[] = [];
  const overlapping: string[] = [];
  for (const file of current) {
    if (agent.has(file) && before.has(file)) overlapping.push(file);
    else if (agent.has(file)) continue;
    else if (before.has(file)) preExisting.push(file);
  }
  return { preExisting: preExisting.sort(), agent: [...agent].filter((file) => current.has(file) && !before.has(file)).sort(), overlapping: overlapping.sort() };
}

export async function captureGitBaseline(workspace: string, signal?: AbortSignal): Promise<GitBaseline> {
  const run = async (command: string) => (await spawnCommand(command, workspace, signal).wait()).stdout;
  const [branch, head, status, diff] = await Promise.all([
    run("git branch --show-current"),
    run("git rev-parse HEAD"),
    run("git --no-pager status --short"),
    run("git --no-pager diff --no-ext-diff"),
  ]);
  return {
    branch: branch.trim(),
    head: head.trim(),
    status,
    diff,
    modifiedFiles: status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()),
    capturedAt: new Date().toISOString(),
  };
}
