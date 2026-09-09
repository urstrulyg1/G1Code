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
  autoExecution: "always" | "ask" | "never";
  reviewPolicy: "always" | "ask" | "never";
  autoFixLints: boolean;
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

export async function readSettings(customDir?: string): Promise<Settings> {
  const dir = getAppDataDir(customDir);
  const defaults: Settings = {
    provider: "experiential-labs",
    endpoint: EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
    autoExecution: "always",
    reviewPolicy: "always",
    autoFixLints: true,
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
    return {
      ...defaults,
      ...parsed,
      provider: "experiential-labs",
      endpoint:
        parsed.endpoint === "https://api.openai.com/v1" || !parsed.endpoint
          ? EXPERIENTIAL_LABS_DEFAULT_ENDPOINT
          : parsed.endpoint,
      model: parsed.model || "",
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

  const next: Settings = {
    ...current,
    provider: "experiential-labs",
    endpoint: String(input.endpoint ?? current.endpoint),
    model: String(input.model ?? current.model),
    temperature: Number(input.temperature ?? current.temperature),
    maxTokens: Number(input.maxTokens ?? current.maxTokens),
    autoExecution: (input.autoExecution ??
      current.autoExecution ??
      "always") as Settings["autoExecution"],
    reviewPolicy: (input.reviewPolicy ??
      current.reviewPolicy ??
      "always") as Settings["reviewPolicy"],
    autoFixLints: Boolean(input.autoFixLints ?? current.autoFixLints ?? true),
    suggestionsInEditor: Boolean(
      input.suggestionsInEditor ?? current.suggestionsInEditor ?? true,
    ),
    tabGitignoreAccess: Boolean(
      input.tabGitignoreAccess ?? current.tabGitignoreAccess ?? true,
    ),
    tabSpeed: (input.tabSpeed ??
      current.tabSpeed ??
      "fast") as Settings["tabSpeed"],
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
    const home = os.homedir();
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
    const home = os.homedir();
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
