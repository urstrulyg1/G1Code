import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "./types";

export const DEFAULT_MAX_CHAT_STORAGE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface ChatMessageItem {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
}

export interface ChatExportData {
  id: string;
  workspaceId: string;
  title: string;
  mode: string;
  model: string;
  provider: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageItem[];
  summary?: string;
}

export interface ChatIndexEntry {
  id: string;
  title: string;
  mode: string;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  jsonFile: string;
  markdownFile: string;
}

export class ChatStorage {
  private static evictionListeners = new Set<(sessionId: string) => void>();

  /**
   * Registers a callback fired when an old chat is evicted due to storage limits.
   */
  public static onSessionEvicted(listener: (sessionId: string) => void): () => void {
    this.evictionListeners.add(listener);
    return () => {
      this.evictionListeners.delete(listener);
    };
  }

  private static notifyEviction(sessionId: string): void {
    for (const listener of this.evictionListeners) {
      try {
        listener(sessionId);
      } catch (err) {
        console.error("[ChatStorage] Eviction listener error:", err);
      }
    }
  }

  /**
   * Returns the maximum total storage limit in bytes for stored chats.
   * Defaults to 100 MB (104,857,600 bytes), configurable via G1CODE_MAX_CHAT_STORAGE_BYTES.
   */
  public static getMaxStorageLimit(): number {
    if (process.env.G1CODE_MAX_CHAT_STORAGE_BYTES) {
      const val = parseInt(process.env.G1CODE_MAX_CHAT_STORAGE_BYTES, 10);
      if (!Number.isNaN(val) && val > 0) return val;
    }
    return DEFAULT_MAX_CHAT_STORAGE_BYTES;
  }

  /**
   * Calculates the total storage consumed by all files in the chats directory.
   */
  public static getDirectoryStorageBytes(chatsDir: string): number {
    if (!fs.existsSync(chatsDir)) return 0;
    let totalBytes = 0;
    try {
      const entries = fs.readdirSync(chatsDir);
      for (const entry of entries) {
        const fullPath = path.join(chatsDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            totalBytes += stat.size;
          }
        } catch {
          // ignore individual stat errors
        }
      }
    } catch {
      // ignore
    }
    return totalBytes;
  }

  /**
   * Enforces the maximum storage limit on the given chats directory.
   * If total storage exceeds maxBytes, the oldest chats are automatically deleted
   * until storage is back within limit.
   *
   * The active session (activeSessionId) is strictly protected and never deleted.
   * Files outside the chats directory are completely untouched.
   */
  public static enforceStorageLimit(
    chatsDir: string,
    activeSessionId?: string,
    maxBytes: number = this.getMaxStorageLimit(),
  ): { deletedSessions: string[]; totalBytesAfter: number } {
    if (!fs.existsSync(chatsDir)) {
      return { deletedSessions: [], totalBytesAfter: 0 };
    }

    let totalBytes = this.getDirectoryStorageBytes(chatsDir);
    const deletedSessions: string[] = [];

    if (totalBytes <= maxBytes) {
      return { deletedSessions, totalBytesAfter: totalBytes };
    }

    // 1. Read index.json to retrieve timestamps
    const indexPath = path.join(chatsDir, "index.json");
    let index: ChatIndexEntry[] = [];
    try {
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf8");
        index = JSON.parse(raw);
        if (!Array.isArray(index)) index = [];
      }
    } catch {
      index = [];
    }

    // 2. Discover all chat sessions in the directory (indexed and unindexed)
    const sessionMap = new Map<string, { id: string; timestamp: number }>();
    for (const entry of index) {
      const ts =
        new Date(entry.updatedAt || entry.createdAt).getTime() ||
        Date.now();
      sessionMap.set(entry.id, { id: entry.id, timestamp: ts });
    }

    try {
      const files = fs.readdirSync(chatsDir);
      for (const file of files) {
        if (file.endsWith(".json") && file !== "index.json") {
          const id = file.slice(0, -5);
          if (!sessionMap.has(id)) {
            try {
              const stat = fs.statSync(path.join(chatsDir, file));
              sessionMap.set(id, { id, timestamp: stat.mtimeMs });
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Sort candidate sessions from oldest to newest (ascending timestamp)
    const sortedSessions = Array.from(sessionMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    let indexModified = false;

    // 4. Delete oldest chats first until total storage is back within maxBytes
    for (const candidate of sortedSessions) {
      if (totalBytes <= maxBytes) {
        break;
      }

      // CRITICAL: Protect the currently active chat from being deleted
      if (activeSessionId && candidate.id === activeSessionId) {
        continue;
      }

      let freedBytes = 0;
      const jsonPath = path.join(chatsDir, `${candidate.id}.json`);
      const mdPath = path.join(chatsDir, `${candidate.id}.md`);

      if (fs.existsSync(jsonPath)) {
        try {
          freedBytes += fs.statSync(jsonPath).size;
          fs.unlinkSync(jsonPath);
        } catch {
          // ignore
        }
      }

      if (fs.existsSync(mdPath)) {
        try {
          freedBytes += fs.statSync(mdPath).size;
          fs.unlinkSync(mdPath);
        } catch {
          // ignore
        }
      }

      // Also remove any other auxiliary files strictly matching this session ID
      try {
        const files = fs.readdirSync(chatsDir);
        for (const file of files) {
          if (file.startsWith(`${candidate.id}.`)) {
            const fp = path.join(chatsDir, file);
            try {
              freedBytes += fs.statSync(fp).size;
              fs.unlinkSync(fp);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }

      totalBytes = Math.max(0, totalBytes - freedBytes);
      deletedSessions.push(candidate.id);
      this.notifyEviction(candidate.id);

      // Remove from index
      const originalCount = index.length;
      index = index.filter((item) => item.id !== candidate.id);
      if (index.length !== originalCount) {
        indexModified = true;
      }
    }

    // 5. Update index.json if any entries were removed
    if (indexModified) {
      try {
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
      } catch (err) {
        console.error(`[ChatStorage] Error updating index.json after cleanup:`, err);
      }
    }

    return {
      deletedSessions,
      totalBytesAfter: this.getDirectoryStorageBytes(chatsDir),
    };
  }

  /**
   * Enforces storage limits across all resolved G1Code chat directories.
   */
  public static enforceAllStorageLimits(
    workspaceId?: string,
    activeSessionId?: string,
    maxBytes: number = this.getMaxStorageLimit(),
  ): Record<string, string[]> {
    const dirs = this.getG1CodeDirectories(workspaceId);
    const result: Record<string, string[]> = {};
    for (const dir of dirs) {
      const chatsDir = path.join(dir, "chats");
      if (fs.existsSync(chatsDir)) {
        const { deletedSessions } = this.enforceStorageLimit(
          chatsDir,
          activeSessionId,
          maxBytes,
        );
        if (deletedSessions.length > 0) {
          result[chatsDir] = deletedSessions;
        }
      }
    }
    return result;
  }

  /**
   * Resolves target G1Code directories where chats must be stored.
   * Ensures the G1Code folder is always created in:
   * 1. The workspace root (if active)
   * 2. The project root (process.cwd())
   * 3. The user home root directory (os.homedir()/G1Code)
   */
  public static getG1CodeDirectories(workspaceId?: string): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();

    const add = (baseDir: string | undefined | null) => {
      if (!baseDir || typeof baseDir !== "string") return;
      try {
        const resolved = path.resolve(baseDir);
        const target = path.join(resolved, "G1Code");
        if (!seen.has(target)) {
          seen.add(target);
          dirs.push(target);
        }
      } catch {
        // ignore invalid paths
      }
    };

    if (workspaceId && workspaceId !== "No workspace open") {
      add(workspaceId);
    }
    add(process.cwd());
    add(os.homedir());

    return dirs;
  }

  /**
   * Returns the primary chats directory for the active workspace or project root.
   */
  public static getPrimaryChatsDirectory(workspaceId?: string): string {
    const dirs = this.getG1CodeDirectories(workspaceId);
    return path.join(dirs[0] || path.join(process.cwd(), "G1Code"), "chats");
  }

  /**
   * Persists a chat session and its full message history into the local G1Code/chats/ folders.
   * Generates both structured JSON and a clean, readable Markdown transcript.
   * Automatically enforces the 100 MB storage limit, pruning oldest chats first
   * while strictly preserving the currently active chat session.
   */
  public static persistChat(
    session: Session,
    messages: ChatMessageItem[],
    summary?: string,
  ): void {
    if (!session || !session.id) return;

    const chatData: ChatExportData = {
      id: session.id,
      workspaceId: session.workspaceId || process.cwd(),
      title: session.title || "Untitled Session",
      mode: session.mode || "agent",
      model: session.model || "default",
      provider: session.provider || "experiential-labs",
      status: session.status || "RUNNING",
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || new Date().toISOString(),
      messages: messages || [],
      summary,
    };

    const markdownContent = this.generateMarkdown(chatData);
    const jsonContent = JSON.stringify(chatData, null, 2);
    const targets = this.getG1CodeDirectories(session.workspaceId);
    const limit = this.getMaxStorageLimit();

    for (const g1Dir of targets) {
      try {
        const chatsDir = path.join(g1Dir, "chats");
        if (!fs.existsSync(chatsDir)) {
          fs.mkdirSync(chatsDir, { recursive: true });
        }

        // 1. Structured JSON
        const jsonPath = path.join(chatsDir, `${session.id}.json`);
        fs.writeFileSync(jsonPath, jsonContent, "utf8");

        // 2. Human-readable Markdown
        const mdPath = path.join(chatsDir, `${session.id}.md`);
        fs.writeFileSync(mdPath, markdownContent, "utf8");

        // 3. Index registry
        this.updateIndex(chatsDir, chatData);

        // 4. Automatically enforce the maximum storage limit (oldest first, protecting active session)
        this.enforceStorageLimit(chatsDir, session.id, limit);
      } catch (err) {
        // Safe failover across target directories
        console.error(`[ChatStorage] Error writing to ${g1Dir}:`, err);
      }
    }
  }

  /**
   * Generates a GitHub-flavored Markdown transcript of the chat.
   */
  public static generateMarkdown(data: ChatExportData): string {
    const lines: string[] = [
      `# G1Code Chat: ${data.title || "Untitled Session"}`,
      "",
      `> **Session ID**: \`${data.id}\`  `,
      `> **Date**: ${data.createdAt}  `,
      `> **Status**: ${data.status}  `,
      `> **Mode**: \`${data.mode}\`  `,
      `> **Model**: \`${data.model}\` (${data.provider})  `,
      `> **Workspace**: \`${data.workspaceId}\`  `,
      "",
      "---",
      "",
    ];

    if (data.summary) {
      lines.push("## Summary", "", data.summary, "", "---", "");
    }

    lines.push("## Messages", "");

    if (!data.messages || data.messages.length === 0) {
      lines.push("*(No messages recorded yet)*", "");
    } else {
      for (const msg of data.messages) {
        const isUser = msg.role.toLowerCase() === "user";
        const roleIcon = isUser ? "👤" : "🤖";
        const roleLabel = isUser ? "User" : `Assistant (${data.model})`;
        const timeStr = msg.createdAt
          ? ` *(${new Date(msg.createdAt).toLocaleTimeString()})*`
          : "";

        lines.push(`### ${roleIcon} ${roleLabel}${timeStr}`, "");
        lines.push(msg.content ? msg.content.trim() : "*(empty message)*", "");
        lines.push("---", "");
      }
    }

    return lines.join("\n");
  }

  /**
   * Maintains an index.json in the chats folder listing all chats in reverse chronological order.
   */
  private static updateIndex(chatsDir: string, data: ChatExportData): void {
    const indexPath = path.join(chatsDir, "index.json");
    let index: ChatIndexEntry[] = [];

    try {
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf8");
        index = JSON.parse(raw);
        if (!Array.isArray(index)) index = [];
      }
    } catch {
      index = [];
    }

    const entry: ChatIndexEntry = {
      id: data.id,
      title: data.title,
      mode: data.mode,
      model: data.model,
      status: data.status,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      messageCount: data.messages.length,
      jsonFile: `${data.id}.json`,
      markdownFile: `${data.id}.md`,
    };

    const existingIdx = index.findIndex((item) => item.id === data.id);
    if (existingIdx >= 0) {
      index[existingIdx] = entry;
    } else {
      index.unshift(entry);
    }

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  }

  /**
   * Reads all chat entries from the chats directory index.
   */
  public static listChats(workspaceId?: string): ChatIndexEntry[] {
    const chatsDir = this.getPrimaryChatsDirectory(workspaceId);
    const indexPath = path.join(chatsDir, "index.json");
    try {
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list;
      }
    } catch {
      // ignore
    }
    return [];
  }
}
