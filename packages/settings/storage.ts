import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { OpenAICompatibleProvider } from "../ai/providers/openai-compatible";

export type Settings = {
  provider: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyConfigured: boolean;
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
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
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
    if (electron?.safeStorage?.isEncryptionAvailable && electron.safeStorage.isEncryptionAvailable()) {
      return electron.safeStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function readSettings(customDir?: string): Promise<Settings> {
  const dir = getAppDataDir(customDir);
  const defaults: Settings = {
    provider: "experimental-labs",
    endpoint: "https://api.openai.com/v1",
    model: "",
    temperature: 0.2,
    maxTokens: 4096,
    apiKeyConfigured: false,
  };
  try {
    const raw = await fs.readFile(settingsPath(dir), "utf8");
    const parsed = JSON.parse(raw);
    const keyExists = await fs
      .stat(keyPath(dir))
      .then(() => true)
      .catch(() => false);
    return {
      ...defaults,
      ...parsed,
      apiKeyConfigured: keyExists,
    };
  } catch {
    return defaults;
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
    provider: String(input.provider ?? current.provider),
    endpoint: String(input.endpoint ?? current.endpoint),
    model: String(input.model ?? current.model),
    temperature: Number(input.temperature ?? current.temperature),
    maxTokens: Number(input.maxTokens ?? current.maxTokens),
  };

  if (input.apiKey && typeof input.apiKey === "string" && input.apiKey.trim().length > 0) {
    await fs.mkdir(dir, { recursive: true });
    const safeStorage = getElectronSafeStorage();
    if (safeStorage) {
      await fs.writeFile(keyPath(dir), safeStorage.encryptString(input.apiKey.trim()));
    } else {
      const encrypted = encryptSecretNode(input.apiKey.trim(), dir);
      await fs.writeFile(keyPath(dir), encrypted, { mode: 0o600 });
    }
    next.apiKeyConfigured = true;
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(settingsPath(dir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function getApiKey(customDir?: string): Promise<string | null> {
  const dir = getAppDataDir(customDir);
  try {
    const data = await fs.readFile(keyPath(dir));
    const safeStorage = getElectronSafeStorage();
    if (safeStorage) {
      try {
        return safeStorage.decryptString(data);
      } catch {
        // May have been encrypted by Node fallback
        return decryptSecretNode(data, dir);
      }
    } else {
      return decryptSecretNode(data, dir);
    }
  } catch {
    return null;
  }
}

export async function configuredProvider(customDir?: string) {
  const dir = getAppDataDir(customDir);
  const settings = await readSettings(dir);
  const key = await getApiKey(dir);
  if (!settings.apiKeyConfigured || !key) {
    throw new Error("Configure an API key first");
  }
  return {
    settings,
    provider: new OpenAICompatibleProvider(settings.endpoint, key),
  };
}
