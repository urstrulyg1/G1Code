import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../ai/types";
import type { AgentState } from "./runtime";
import { contentHash } from "../tools/changes";
import { safeRealPath } from "../tools/workspace";
import type { ChangeService } from "../tools/change-service";

export type ToolClassification = "READ_ONLY" | "IDEMPOTENT" | "SIDE_EFFECTING" | "NON_REPLAYABLE";

export const TOOL_CLASSIFICATIONS: Record<string, ToolClassification> = {
  read_file: "READ_ONLY",
  list_directory: "READ_ONLY",
  search_files: "READ_ONLY",
  find_by_name: "READ_ONLY",
  git_status: "READ_ONLY",
  git_diff: "READ_ONLY",
  run_tests: "IDEMPOTENT",
  apply_patch: "SIDE_EFFECTING",
  write_file: "SIDE_EFFECTING",
  run_command: "NON_REPLAYABLE",
  git_commit: "SIDE_EFFECTING",
};

export function classifyTool(toolName: string): ToolClassification {
  return TOOL_CLASSIFICATIONS[toolName] ?? "NON_REPLAYABLE";
}

export type SideEffectEvidence = {
  id: string;
  toolName: string;
  argumentsHash: string;
  changeId?: string;
  filePath?: string;
  resultStatus?: string;
  executedAt: string;
};

export type SafeCheckpoint = {
  sessionId: string;
  state: AgentState;
  iteration: number;
  toolCalls: number;
  messages: ChatMessage[];
  sideEffects: SideEffectEvidence[];
  fileHashes: Record<string, string>;
  resumable: boolean;
  nextAction?: string;
  savedAt: string;
};

export function hashArguments(args: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
}

export async function snapshotFiles(workspace: string, relativePaths: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const rel of relativePaths) {
    try {
      const fullPath = await safeRealPath(workspace, rel);
      const content = await fs.readFile(fullPath, "utf8");
      hashes[rel] = contentHash(content);
    } catch {
      hashes[rel] = "DELETED";
    }
  }
  return hashes;
}

export type ResumeReconciliationResult = {
  safeToResume: boolean;
  reason?: string;
  modifiedFiles: string[];
  pendingChangeIds: string[];
  replayedSideEffects: number;
};

export async function reconcileCheckpoint(
  checkpoint: SafeCheckpoint,
  workspace: string,
  changeService?: ChangeService,
): Promise<ResumeReconciliationResult> {
  const modifiedFiles: string[] = [];

  // Verify file hashes against current disk state
  for (const [relPath, expectedHash] of Object.entries(checkpoint.fileHashes)) {
    try {
      const fullPath = await safeRealPath(workspace, relPath);
      const content = await fs.readFile(fullPath, "utf8");
      const currentHash = contentHash(content);
      if (expectedHash !== currentHash) {
        modifiedFiles.push(relPath);
      }
    } catch {
      if (expectedHash !== "DELETED") {
        modifiedFiles.push(relPath);
      }
    }
  }

  // Check pending changes
  const pendingChangeIds: string[] = [];
  if (changeService) {
    const pending = changeService.listPendingChanges(checkpoint.sessionId);
    for (const c of pending) {
      if (c.status === "PENDING" || c.status === "APPROVED") {
        pendingChangeIds.push(c.id);
      }
    }
  }

  if (modifiedFiles.length > 0) {
    return {
      safeToResume: false,
      reason: `External modifications detected in: ${modifiedFiles.join(", ")}`,
      modifiedFiles,
      pendingChangeIds,
      replayedSideEffects: 0,
    };
  }

  return {
    safeToResume: true,
    modifiedFiles: [],
    pendingChangeIds,
    replayedSideEffects: checkpoint.sideEffects.length,
  };
}
