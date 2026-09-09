/**
 * Secret Redaction Utility
 * Redacts sensitive credentials, tokens, API keys, passwords, and private keys
 * before they reach the UI, event streams, or persistence layer.
 */

const SENSITIVE_KEY_REGEX =
  /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|secret|password|passwd|passphrase|explabs[_-]?api[_-]?key)["']?\s*[:=]\s*["']?)[^"'\s,;}{]{4,}(["']?)/gi;

const BEARER_TOKEN_REGEX = /(Bearer\s+)[A-Za-z0-9_\-.~+/]{8,}=*/gi;
const AUTH_HEADER_REGEX =
  /(Authorization:\s*(?:Bearer\s+|Basic\s+)?)[\w\-.~+/]{8,}=*/gi;
const PREFIXED_KEY_REGEX =
  /\b(sk-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9\-]{20,})\b/g;
const PRIVATE_KEY_REGEX =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/**
 * Returns a list of environment secret values that should be sanitized if present.
 */
function getKnownSecretValues(): string[] {
  const secrets: string[] = [];
  const env = process.env;
  for (const [key, val] of Object.entries(env)) {
    if (
      val &&
      val.length >= 8 &&
      /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)
    ) {
      secrets.push(val);
    }
  }
  return secrets;
}

/**
 * Redacts secrets from a single string.
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== "string") return input;

  let redacted = input;

  // 1. Redact Private Key blocks
  redacted = redacted.replace(
    PRIVATE_KEY_REGEX,
    "-----BEGIN PRIVATE KEY-----\n********\n-----END PRIVATE KEY-----",
  );

  // 2. Redact Authorization headers
  redacted = redacted.replace(AUTH_HEADER_REGEX, "$1********");

  // 3. Redact Bearer tokens
  redacted = redacted.replace(BEARER_TOKEN_REGEX, "$1********");

  // 4. Redact known prefixes (sk-..., ghp_..., xox-...)
  redacted = redacted.replace(PREFIXED_KEY_REGEX, (match) => {
    const prefix = match.split(/[_\-]/)[0];
    return `${prefix}-********`;
  });

  // 5. Redact key-value pairs (apiKey: "...", password = "...")
  redacted = redacted.replace(SENSITIVE_KEY_REGEX, "$1********$2");

  // 6. Redact known environment secret values if present
  try {
    const knownSecrets = getKnownSecretValues();
    for (const secret of knownSecrets) {
      if (secret && secret.length >= 8 && redacted.includes(secret)) {
        redacted = redacted.split(secret).join("********");
      }
    }
  } catch {
    // ignore
  }

  return redacted;
}

/**
 * Recursively redacts sensitive values from an object, array, or string.
 */
export function redactObject<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item)) as unknown as T;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) {
        if (typeof val === "string" && val.length > 0) {
          result[key] = "********";
        } else {
          result[key] = redactObject(val);
        }
      } else {
        result[key] = redactObject(val);
      }
    }
    return result as T;
  }

  return value;
}
