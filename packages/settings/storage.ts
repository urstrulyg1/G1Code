import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  ExperientialLabsProvider,
  EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
} from "../ai/experiential-labs";
import { ArenaAIProvider, ARENA_DEFAULT_ENDPOINT } from "../ai/arena";
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
const keyPath = (dir: string, provider = "experiential-labs") =>
  provider === "arena.ai" || provider === "arena"
    ? path.join(dir, "g1code-arena-api-key.bin")
    : path.join(dir, "g1code-api-key.bin");
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
  if (trimmed.startsWith("arena_")) {
    return "arena_" + "•".repeat(Math.max(16, trimmed.length - 6));
  }
  if (trimmed.startsWith("ar_")) {
    return "ar_" + "•".repeat(Math.max(16, trimmed.length - 3));
  }
  return "•".repeat(Math.max(20, trimmed.length));
}

export async function readSettings(customDir?: string): Promise<Settings> {
  const dir = getAppDataDir(customDir);
  const defaults: Settings = {
    provider: "experiential-labs",
    endpoint: EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
    model: "gpt-6-astra",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  };
  try {
    const raw = await fs.readFile(settingsPath(dir), "utf8");
    const parsed = JSON.parse(raw);
    const activeProvider =
      parsed.provider === "arena" || parsed.provider === "arena.ai"
        ? "arena.ai"
        : "experiential-labs";

    const defaultEndpoint =
      activeProvider === "arena.ai"
        ? ARENA_DEFAULT_ENDPOINT
        : EXPERIENTIAL_LABS_DEFAULT_ENDPOINT;
    const defaultModel =
      activeProvider === "arena.ai" ? "arena-agent-v1" : "gpt-6-astra";

    const key = await getApiKey(dir, activeProvider);
    const keyExists = Boolean(key);
    return {
      ...defaults,
      ...parsed,
      provider: activeProvider,
      endpoint:
        parsed.endpoint === "https://api.openai.com/v1" || !parsed.endpoint
          ? defaultEndpoint
          : parsed.endpoint,
      model: parsed.model || defaultModel,
      apiKeyConfigured: keyExists,
      apiKeyMasked: maskApiKey(key),
    };
  } catch {
    const key = await getApiKey(dir, defaults.provider);
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

  const newProvider = input.provider
    ? input.provider === "arena" || input.provider === "arena.ai"
      ? "arena.ai"
      : "experiential-labs"
    : current.provider;
  const isProviderChanged = newProvider !== current.provider;

  const defaultEndpoint =
    newProvider === "arena.ai"
      ? ARENA_DEFAULT_ENDPOINT
      : EXPERIENTIAL_LABS_DEFAULT_ENDPOINT;
  const defaultModel =
    newProvider === "arena.ai" ? "arena-agent-v1" : "gpt-6-astra";

  const next: Settings = {
    ...current,
    provider: newProvider,
    endpoint:
      isProviderChanged && !input.endpoint
        ? defaultEndpoint
        : String(input.endpoint ?? current.endpoint),
    model:
      isProviderChanged && !input.model
        ? defaultModel
        : String(input.model ?? current.model),
    temperature: Number(input.temperature ?? current.temperature),
    maxTokens: Number(input.maxTokens ?? current.maxTokens),
  };

  if (
    input.apiKey &&
    typeof input.apiKey === "string" &&
    input.apiKey.trim().length > 0
  ) {
    await fs.mkdir(dir, { recursive: true });
    const targetFile = keyPath(dir, newProvider);
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

  const activeKey = await getApiKey(dir, newProvider);
  next.apiKeyConfigured = Boolean(activeKey);
  next.apiKeyMasked = maskApiKey(activeKey);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(settingsPath(dir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function getApiKey(
  customDir?: string,
  provider?: string,
): Promise<string | null> {
  const dir = getAppDataDir(customDir);
  let targetProvider = provider;
  if (!targetProvider) {
    try {
      const raw = await fs.readFile(settingsPath(dir), "utf8");
      const parsed = JSON.parse(raw);
      targetProvider = parsed.provider;
    } catch {
      targetProvider = "experiential-labs";
    }
  }

  const isArena = targetProvider === "arena.ai" || targetProvider === "arena";

  try {
    const data = await fs.readFile(keyPath(dir, targetProvider));
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
    // Fall back to environment variable if configured in shell
    if (isArena) {
      const envKey =
        process.env.ARENA_API_KEY ||
        process.env.ARENAAI_API_KEY ||
        process.env.ARENA_KEY;
      if (envKey && envKey.trim().length > 0) {
        return envKey.trim();
      }
      return null;
    }

    const envKey =
      process.env.EXPLABS_API_KEY ||
      process.env.EXPERIENTIAL_LABS_API_KEY ||
      process.env.XPL_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      return envKey.trim();
    }
    return null;
  }
}

export async function configuredProvider(
  customDir?: string,
  providerId?: string,
): Promise<{
  settings: Settings;
  provider: AIProvider;
}> {
  const dir = getAppDataDir(customDir);
  const settings = await readSettings(dir);
  const targetProvider =
    providerId || settings.provider || "experiential-labs";
  const key = await getApiKey(dir, targetProvider);
  if (!key) {
    throw new Error(`Configure an API key for ${targetProvider} first`);
  }
  return {
    settings: {
      ...settings,
      provider: targetProvider,
    },
    provider: globalProviderRegistry.create(
      targetProvider,
      settings.endpoint,
      key,
    ),
  };
}

