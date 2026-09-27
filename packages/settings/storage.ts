import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  ExperientialLabsProvider,
  EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
} from "../ai/experiential-labs";
import { globalProviderRegistry } from "../ai/provider-registry";
import type { AIProvider } from "../ai/provider";

export type Settings = {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  // Agent Behaviour Settings
  agentMode: "review" | "auto" | "plan" | "readonly";
  autoExecution: "always" | "ask" | "never";
  reviewPolicy: "always" | "ask" | "never";
  autoFixLints: boolean;
  toolPermissions: {
    readFiles: boolean;
    searchRepository: boolean;
    editFiles: boolean;
    createFiles: boolean;
    deleteFiles: boolean;
    renameFiles: boolean;
    runTests: boolean;
    runBuilds: boolean;
    runCommands: boolean;
    networkTools: boolean;
  };
  commandTimeoutMs: number;
  toolTimeoutMs: number;
  maxAgentSteps: number;
  maxConcurrentTools: number;
  maxRetries: number;
  contextBudgetChars: number;
  ignoredPaths: string[];
  // Tab / Inline Suggestion Settings
  suggestionsInEditor: boolean;
  tabGitignoreAccess: boolean;
  tabSpeed: "fast" | "normal" | "slow";
  tabToImport: boolean;
  tabToJump: boolean;
};

export function getAppDataDir(customDir?: string): string {
  if (customDir) return customDir;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    if (electron?.app?.getPath) {
      return electron.app.getPath("userData");
    }
  } catch {
    // Not running inside electron
  }
  const defaultDir = path.join(os.homedir(), ".g1code");
  fsSync.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

const settingsPath = (dir: string) => path.join(dir, "g1code-settings.json");
const keyPath = (dir: string) => path.join(dir, "g1code-api-key.bin");
const nodeSecretPath = (dir: string) => path.join(dir, ".g1code.secret");

function getOrCreateNodeSecret(dir: string): Buffer {
  const secretFile = nodeSecretPath(dir);
  if (fsSync.existsSync(secretFile)) {
    return fsSync.readFileSync(secretFile);
  }
  const secret = crypto.randomBytes(32);
  fsSync.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

function encryptSecretNode(plainText: string, dir: string): Buffer {
  const secret = getOrCreateNodeSecret(dir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: [12 bytes IV][16 bytes Tag][Encrypted Data]
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptSecretNode(cipherBuffer: Buffer, dir: string): string {
  const secret = getOrCreateNodeSecret(dir);
  const iv = cipherBuffer.subarray(0, 12);
  const tag = cipherBuffer.subarray(12, 28);
  const encrypted = cipherBuffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", secret, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

function getElectronSafeStorage() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    if (
      electron?.safeStorage?.isEncryptionAvailable &&
      electron.safeStorage.isEncryptionAvailable()
    ) {
      return electron.safeStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function maskApiKey(key: string | null): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (trimmed.startsWith("xpl_")) {
    return "xpl_" + "•".repeat(Math.max(16, trimmed.length - 4));
  }
  return "•".repeat(Math.max(20, trimmed.length));
}

function normalizeSettings(raw: unknown, defaults: Settings): Settings {
  const parsed =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const permissionInput =
    parsed.toolPermissions && typeof parsed.toolPermissions === "object"
      ? (parsed.toolPermissions as Record<string, unknown>)
      : {};
  const bool = (key: keyof Settings["toolPermissions"]) =>
    typeof permissionInput[key] === "boolean"
      ? (permissionInput[key] as boolean)
      : defaults.toolPermissions[key];
  const enumValue = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  const numberValue = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.floor(n)))
      : fallback;
  };
  const ignored = Array.isArray(parsed.ignoredPaths)
    ? parsed.ignoredPaths
        .filter((v): v is string => typeof v === "string")
        .slice(0, 200)
    : defaults.ignoredPaths;
  return {
    ...defaults,
    provider: "experiential-labs",
    endpoint:
      typeof parsed.endpoint === "string" &&
      parsed.endpoint.trim() &&
      parsed.endpoint !== "https://api.openai.com/v1"
        ? parsed.endpoint.trim()
        : defaults.endpoint,
    model: typeof parsed.model === "string" ? parsed.model : defaults.model,
    temperature: numberValue(parsed.temperature, 0, 2, defaults.temperature),
    maxTokens: numberValue(parsed.maxTokens, 256, 32768, defaults.maxTokens),
    agentMode: enumValue(
      parsed.agentMode,
      ["review", "auto", "plan", "readonly"] as const,
      defaults.agentMode,
    ),
    autoExecution: enumValue(
      parsed.autoExecution,
      ["always", "ask", "never"] as const,
      defaults.autoExecution,
    ),
    reviewPolicy: enumValue(
      parsed.reviewPolicy,
      ["always", "ask", "never"] as const,
      defaults.reviewPolicy,
    ),
    autoFixLints:
      typeof parsed.autoFixLints === "boolean"
        ? parsed.autoFixLints
        : defaults.autoFixLints,
    toolPermissions: {
      readFiles: bool("readFiles"),
      searchRepository: bool("searchRepository"),
      editFiles: bool("editFiles"),
      createFiles: bool("createFiles"),
      deleteFiles: bool("deleteFiles"),
      renameFiles: bool("renameFiles"),
      runTests: bool("runTests"),
      runBuilds: bool("runBuilds"),
      runCommands: bool("runCommands"),
      networkTools: bool("networkTools"),
    },
    commandTimeoutMs: numberValue(
      parsed.commandTimeoutMs,
      1000,
      10 * 60 * 1000,
      defaults.commandTimeoutMs,
    ),
    toolTimeoutMs: numberValue(
      parsed.toolTimeoutMs,
      1000,
      10 * 60 * 1000,
      defaults.toolTimeoutMs,
    ),
    maxAgentSteps: numberValue(
      parsed.maxAgentSteps,
      1,
      200,
      defaults.maxAgentSteps,
    ),
    maxConcurrentTools: numberValue(
      parsed.maxConcurrentTools,
      1,
      16,
      defaults.maxConcurrentTools,
    ),
    maxRetries: numberValue(parsed.maxRetries, 0, 8, defaults.maxRetries),
    contextBudgetChars: numberValue(
      parsed.contextBudgetChars,
      4000,
      500000,
      defaults.contextBudgetChars,
    ),
    ignoredPaths: ignored,
    suggestionsInEditor:
      typeof parsed.suggestionsInEditor === "boolean"
        ? parsed.suggestionsInEditor
        : defaults.suggestionsInEditor,
    tabGitignoreAccess:
      typeof parsed.tabGitignoreAccess === "boolean"
        ? parsed.tabGitignoreAccess
        : defaults.tabGitignoreAccess,
    tabSpeed: enumValue(
      parsed.tabSpeed,
      ["fast", "normal", "slow"] as const,
      defaults.tabSpeed,
    ),
    tabToImport:
      typeof parsed.tabToImport === "boolean"
        ? parsed.tabToImport
        : defaults.tabToImport,
    tabToJump:
      typeof parsed.tabToJump === "boolean"
        ? parsed.tabToJump
        : defaults.tabToJump,
    apiKeyConfigured: defaults.apiKeyConfigured,
    apiKeyMasked: defaults.apiKeyMasked,
  };
}

export async function readSettings(customDir?: string): Promise<Settings> {
  const dir = getAppDataDir(customDir);
  const defaults: Settings = {
    provider: "experiential-labs",
    endpoint: EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
    agentMode: "review",
    autoExecution: "ask",
    reviewPolicy: "ask",
    autoFixLints: true,
    toolPermissions: {
      readFiles: true,
      searchRepository: true,
      editFiles: true,
      createFiles: true,
      deleteFiles: false,
      renameFiles: false,
      runTests: true,
      runBuilds: true,
      runCommands: true,
      networkTools: false,
    },
    commandTimeoutMs: 120000,
    toolTimeoutMs: 120000,
    maxAgentSteps: 50,
    maxConcurrentTools: 4,
    maxRetries: 3,
    contextBudgetChars: 60000,
    ignoredPaths: ["node_modules", ".git", "dist", "dist-electron", "coverage"],
    suggestionsInEditor: true,
    tabGitignoreAccess: true,
    tabSpeed: "fast",
    tabToImport: true,
    tabToJump: true,
  };
  try {
    const raw = await fs.readFile(settingsPath(dir), "utf8");
    const parsed = JSON.parse(raw);

    const key = await getApiKey(dir);
    const keyExists = Boolean(key);
    const normalized = normalizeSettings(parsed, defaults);
    return {
      ...normalized,
      apiKeyConfigured: keyExists,
      apiKeyMasked: maskApiKey(key),
    };
  } catch {
    const key = await getApiKey(dir);
    const keyExists = Boolean(key);
    return {
      ...defaults,
      apiKeyConfigured: keyExists,
      apiKeyMasked: maskApiKey(key),
    };
  }
}

export async function saveSettings(
  input: Partial<Settings> & { apiKey?: string },
  customDir?: string,
): Promise<Settings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid settings");
  }
  const dir = getAppDataDir(customDir);
  const current = await readSettings(dir);

  const allowedModes = new Set(["review", "auto", "plan", "readonly"]);
  const allowedExecution = new Set(["always", "ask", "never"]);
  const allowedSpeeds = new Set(["fast", "normal", "slow"]);
  const clamp = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.floor(n)))
      : fallback;
  };
  const rawPermissions =
    input.toolPermissions && typeof input.toolPermissions === "object"
      ? (input.toolPermissions as Record<string, unknown>)
      : current.toolPermissions;
  const bool = (key: keyof Settings["toolPermissions"], fallback: boolean) =>
    typeof rawPermissions[key] === "boolean"
      ? (rawPermissions[key] as boolean)
      : fallback;
  const requestedMode = String(input.agentMode ?? current.agentMode);
  const requestedExecution = String(
    input.autoExecution ?? current.autoExecution,
  );
  const requestedReview = String(input.reviewPolicy ?? current.reviewPolicy);
  const requestedSpeed = String(input.tabSpeed ?? current.tabSpeed);
  if (!allowedModes.has(requestedMode)) throw new Error("Invalid agentMode");
  if (!allowedExecution.has(requestedExecution))
    throw new Error("Invalid autoExecution");
  if (!allowedExecution.has(requestedReview))
    throw new Error("Invalid reviewPolicy");
  if (!allowedSpeeds.has(requestedSpeed)) throw new Error("Invalid tabSpeed");
  const next: Settings = {
    ...current,
    provider: "experiential-labs",
    endpoint: String(input.endpoint ?? current.endpoint),
    model: String(input.model ?? current.model),
    temperature: Number(input.temperature ?? current.temperature),
    maxTokens: clamp(
      input.maxTokens ?? current.maxTokens,
      256,
      32768,
      current.maxTokens,
    ),
    agentMode: requestedMode as Settings["agentMode"],
    autoExecution: requestedExecution as Settings["autoExecution"],
    reviewPolicy: requestedReview as Settings["reviewPolicy"],
    autoFixLints: Boolean(input.autoFixLints ?? current.autoFixLints ?? true),
    suggestionsInEditor: Boolean(
      input.suggestionsInEditor ?? current.suggestionsInEditor ?? true,
    ),
    tabGitignoreAccess: Boolean(
      input.tabGitignoreAccess ?? current.tabGitignoreAccess ?? true,
    ),
    tabSpeed: requestedSpeed as Settings["tabSpeed"],
    toolPermissions: {
      readFiles: bool("readFiles", current.toolPermissions.readFiles),
      searchRepository: bool(
        "searchRepository",
        current.toolPermissions.searchRepository,
      ),
      editFiles: bool("editFiles", current.toolPermissions.editFiles),
      createFiles: bool("createFiles", current.toolPermissions.createFiles),
      deleteFiles: bool("deleteFiles", current.toolPermissions.deleteFiles),
      renameFiles: bool("renameFiles", current.toolPermissions.renameFiles),
      runTests: bool("runTests", current.toolPermissions.runTests),
      runBuilds: bool("runBuilds", current.toolPermissions.runBuilds),
      runCommands: bool("runCommands", current.toolPermissions.runCommands),
      networkTools: bool("networkTools", current.toolPermissions.networkTools),
    },
    commandTimeoutMs: clamp(
      input.commandTimeoutMs ?? current.commandTimeoutMs,
      1000,
      10 * 60 * 1000,
      120000,
    ),
    toolTimeoutMs: clamp(
      input.toolTimeoutMs ?? current.toolTimeoutMs,
      1000,
      10 * 60 * 1000,
      120000,
    ),
    maxAgentSteps: clamp(
      input.maxAgentSteps ?? current.maxAgentSteps,
      1,
      200,
      50,
    ),
    maxConcurrentTools: clamp(
      input.maxConcurrentTools ?? current.maxConcurrentTools,
      1,
      16,
      4,
    ),
    maxRetries: clamp(input.maxRetries ?? current.maxRetries, 0, 8, 3),
    contextBudgetChars: clamp(
      input.contextBudgetChars ?? current.contextBudgetChars,
      4000,
      500000,
      60000,
    ),
    ignoredPaths: Array.isArray(input.ignoredPaths)
      ? input.ignoredPaths
          .filter((v): v is string => typeof v === "string")
          .slice(0, 200)
      : current.ignoredPaths,
    tabToImport: Boolean(input.tabToImport ?? current.tabToImport ?? true),
    tabToJump: Boolean(input.tabToJump ?? current.tabToJump ?? true),
  };

  if (
    input.apiKey &&
    typeof input.apiKey === "string" &&
    input.apiKey.trim().length > 0
  ) {
    await fs.mkdir(dir, { recursive: true });
    const targetFile = keyPath(dir);
    const safeStorage = getElectronSafeStorage();
    if (safeStorage) {
      await fs.writeFile(
        targetFile,
        safeStorage.encryptString(input.apiKey.trim()),
      );
    } else {
      const encrypted = encryptSecretNode(input.apiKey.trim(), dir);
      await fs.writeFile(targetFile, encrypted, { mode: 0o600 });
    }
  }

  const activeKey = await getApiKey(dir);
  next.apiKeyConfigured = Boolean(activeKey);
  next.apiKeyMasked = maskApiKey(activeKey);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(settingsPath(dir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function extractApiKeyFromContent(content: string): string | null {
  const match = content.match(
    /(?:export\s+)?(?:EXPLABS_API_KEY|EXPERIENTIAL_LABS_API_KEY|XPL_API_KEY|EXPERIENTIAL_API_KEY)\s*=\s*["']?([^"'\s#;]+)["']?/,
  );
  if (match && match[1]) {
    const key = match[1].replace(/^["']|["';\s]+$/g, "").trim();
    if (key.length > 0) return key;
  }
  return null;
}

const SHELL_RC_FILES = [".zshrc", ".zshenv", ".bashrc", ".bash_profile"];

export function readApiKeyFromZshrcSync(): string | null {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    for (const filename of SHELL_RC_FILES) {
      const filePath = path.join(home, filename);
      if (fsSync.existsSync(filePath)) {
        const content = fsSync.readFileSync(filePath, "utf8");
        const key = extractApiKeyFromContent(content);
        if (key) {
          process.env.EXPLABS_API_KEY = key;
          return key;
        }
      }
    }
  } catch {
    // Ignore if shell config cannot be accessed
  }
  return null;
}

export async function readApiKeyFromZshrc(): Promise<string | null> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    for (const filename of SHELL_RC_FILES) {
      const filePath = path.join(home, filename);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const key = extractApiKeyFromContent(content);
        if (key) {
          process.env.EXPLABS_API_KEY = key;
          return key;
        }
      } catch {
        // Continue to next file
      }
    }
  } catch {
    // Ignore if shell config cannot be accessed
  }
  return null;
}

// In-memory initialization from ~/.zshrc without logging or exposing
readApiKeyFromZshrcSync();

export async function getApiKey(customDir?: string): Promise<string | null> {
  // 1. Prioritize reading directly from user's ~/.zshrc configuration
  const zshrcKey = await readApiKeyFromZshrc();
  if (zshrcKey) {
    return zshrcKey;
  }

  // 2. Check process environment
  const envKey =
    process.env.EXPLABS_API_KEY ||
    process.env.EXPERIENTIAL_LABS_API_KEY ||
    process.env.XPL_API_KEY ||
    process.env.EXPERIENTIAL_API_KEY;
  if (envKey && envKey.trim().length > 0) {
    return envKey.trim();
  }

  // 3. Fall back to secure storage if configured
  const dir = getAppDataDir(customDir);
  try {
    const data = await fs.readFile(keyPath(dir));
    const safeStorage = getElectronSafeStorage();
    if (safeStorage) {
      try {
        return safeStorage.decryptString(data);
      } catch {
        return decryptSecretNode(data, dir);
      }
    } else {
      return decryptSecretNode(data, dir);
    }
  } catch {
    return null;
  }
}

export async function configuredProvider(
  customDir?: string,
  customProvider?: string,
): Promise<{
  settings: Settings;
  provider: AIProvider;
}> {
  const dir = getAppDataDir(customDir);
  const settings = await readSettings(dir);
  const targetProvider =
    customProvider || settings.provider || "experiential-labs";
  const key = await getApiKey(dir);
  if (!key) {
    throw new Error(
      "Experiential Labs API key not found in ~/.zshrc or environment.",
    );
  }
  return {
    settings,
    provider: globalProviderRegistry.create(
      targetProvider,
      settings.endpoint,
      key,
    ),
  };
}
