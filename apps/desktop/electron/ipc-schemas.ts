/**
 * Phase 4: strict IPC validation.
 *
 * The renderer is not a trusted source. Before this module every Electron IPC
 * handler forwarded whatever the renderer sent straight to the backend (or to
 * the filesystem), so a compromised renderer could send an object where a
 * string was expected, a 100 MB payload, or an unknown action string.
 *
 * Every channel now declares a validator. Validation is intentionally
 * dependency-free: a tiny schema combinator set keeps the security review
 * surface small and avoids adding a runtime dependency.
 */

export class IpcValidationError extends Error {
  constructor(
    readonly channel: string,
    message: string,
  ) {
    super(`Invalid IPC payload for ${channel}: ${message}`);
    this.name = "IpcValidationError";
  }
}

export type Validator<T> = (value: unknown, channel: string) => T;

const fail = (channel: string, message: string): never => {
  throw new IpcValidationError(channel, message);
};

/** Absolute path, bounded, no control characters. */
export const absolutePath = (
  maxLength = 4096,
): Validator<string> =>
  (value, channel) => {
    if (typeof value !== "string") return fail(channel, "expected a string path");
    if (value.length === 0) return fail(channel, "path is empty");
    if (value.length > maxLength) return fail(channel, "path is too long");
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(value))
      return fail(channel, "path contains control characters");
    return value;
  };

export const boundedString = (
  name: string,
  maxLength: number,
  options: { allowEmpty?: boolean } = {},
): Validator<string> =>
  (value, channel) => {
    if (typeof value !== "string")
      return fail(channel, `${name} must be a string`);
    if (value.length > maxLength)
      return fail(channel, `${name} exceeds ${maxLength} characters`);
    if (!options.allowEmpty && value.trim().length === 0)
      return fail(channel, `${name} must not be empty`);
    return value;
  };

export const optional = <T>(
  validator: Validator<T>,
): Validator<T | undefined> =>
  (value, channel) =>
    value === undefined || value === null ? undefined : validator(value, channel);

export const boolean = (name: string): Validator<boolean> =>
  (value, channel) =>
    typeof value === "boolean"
      ? value
      : fail(channel, `${name} must be a boolean`);

export const boundedNumber = (
  name: string,
  min: number,
  max: number,
): Validator<number> =>
  (value, channel) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      return fail(channel, `${name} must be a finite number`);
    if (value < min || value > max)
      return fail(channel, `${name} must be between ${min} and ${max}`);
    return value;
  };

export const oneOf = <T extends string>(
  name: string,
  allowed: readonly T[],
): Validator<T> =>
  (value, channel) =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fail(channel, `${name} must be one of: ${allowed.join(", ")}`);

export function object<T extends Record<string, unknown>>(
  shape: { [K in keyof T]: Validator<T[K]> },
  options: { allowUnknown?: boolean; name?: string } = {},
): Validator<T> {
  return (value, channel) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail(channel, `${options.name ?? "payload"} must be an object`);
    const source = value as Record<string, unknown>;
    if (!options.allowUnknown) {
      for (const key of Object.keys(source)) {
        if (!(key in shape))
          return fail(channel, `unknown field "${key}" is not allowed`);
      }
    }
    const result: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(shape) as Array<
      [string, Validator<unknown>]
    >) {
      if (!(key in source) || source[key] === undefined) {
        const validated = validator(undefined, channel);
        if (validated === undefined) continue;
        result[key] = validated;
        continue;
      }
      result[key] = validator(source[key], channel);
    }
    return result as T;
  };
}

export const arrayOf = <T>(
  item: Validator<T>,
  name: string,
  maxItems = 256,
): Validator<T[]> =>
  (value, channel) => {
    if (!Array.isArray(value)) return fail(channel, `${name} must be an array`);
    if (value.length > maxItems)
      return fail(channel, `${name} cannot exceed ${maxItems} items`);
    return value.map((entry, index) => item(entry, `${channel}[${index}]`));
  };

/** No payload expected: rejects anything that is not undefined/null. */
export const none: Validator<undefined> = (value, channel) => {
  if (value === undefined || value === null) return undefined;
  return fail(channel, "does not accept a payload");
};

export const anyValue: Validator<unknown> = (value) => value;

/** Global ceiling for any single IPC payload (JSON serialised size). */
export const MAX_IPC_PAYLOAD_BYTES = 1_000_000;
/** The editor write path legitimately sends larger content. */
export const MAX_EDITOR_CONTENT_BYTES = 10_000_000;

export function assertPayloadSize(
  value: unknown,
  channel: string,
  maxBytes = MAX_IPC_PAYLOAD_BYTES,
): void {
  if (value === undefined || value === null) return;
  let size = 0;
  try {
    size =
      typeof value === "string" ? value.length : (JSON.stringify(value)?.length ?? 0);
  } catch {
    throw new IpcValidationError(channel, "payload is not serialisable");
  }
  if (size > maxBytes)
    throw new IpcValidationError(
      channel,
      `payload of ${size} bytes exceeds the ${maxBytes} byte limit`,
    );
}

// ---------------------------------------------------------------------------
// Channel schemas
// ---------------------------------------------------------------------------

export const IPC_SCHEMAS = {
  "workspace:set": object({ path: absolutePath() }),
  "workspace:choose": none,
  "workspace:get-current": none,
  "workspace:open-native-folder": object({ path: optional(absolutePath()) }),
  "workspace:list": object({ directory: absolutePath() }),
  "file:read": object({ path: absolutePath() }),
  "file:write": object({
    path: absolutePath(),
    contents: boundedString("contents", MAX_EDITOR_CONTENT_BYTES, {
      allowEmpty: true,
    }),
    expectedHash: optional(boundedString("expectedHash", 128)),
  }),
  "terminal:run": object({
    command: boundedString("command", 10_000),
    cwd: optional(absolutePath()),
  }),
  "settings:get": none,
  "settings:save": object({}, { allowUnknown: true, name: "settings" }),
  "provider:models": object({ provider: optional(boundedString("provider", 64)) }),
  "provider:models:free": object({
    provider: optional(boundedString("provider", 64)),
  }),
  "provider:usage-limits": none,
  "provider:usage-limits:simulate": object({
    modelId: boundedString("modelId", 256),
    resetInSeconds: optional(boundedNumber("resetInSeconds", 1, 86_400)),
    type: optional(oneOf("type", ["hourly", "daily"] as const)),
    reset: optional(boolean("reset")),
  }),
  "provider:test": object({
    model: optional(boundedString("model", 256)),
    provider: optional(boundedString("provider", 64)),
  }),
  "provider:verify": object({
    provider: optional(boundedString("provider", 64)),
  }),
  "provider:refresh": object({
    provider: optional(boundedString("provider", 64)),
  }),
  "agent:start": object({
    workspace: absolutePath(),
    prompt: boundedString("prompt", 200_000),
    mode: oneOf("mode", ["ask", "plan", "agent"] as const),
    sessionId: optional(boundedString("sessionId", 256)),
    model: optional(boundedString("model", 256)),
    reasoning: optional(boundedString("reasoning", 64)),
    reasoningEffort: optional(boundedString("reasoningEffort", 64)),
    executionMode: optional(
      oneOf("executionMode", ["review", "auto", "plan", "readonly"] as const),
    ),
    attachedContext: optional(
      arrayOf(boundedString("context entry", 200_000), "attachedContext", 100),
    ),
    openFile: optional(boundedString("openFile", 4096)),
    selection: optional(boundedString("selection", 200_000)),
    autoContext: optional(boolean("autoContext")),
  }),
  "agent:session-model": object({
    sessionId: boundedString("sessionId", 256),
    model: boundedString("model", 256),
    workspace: optional(absolutePath()),
  }),
  "agent:stop": object({
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:sessions": object({ workspace: absolutePath() }),
  "agent:session": object({
    workspace: absolutePath(),
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:session:update": object({
    workspace: absolutePath(),
    sessionId: boundedString("sessionId", 256),
    action: oneOf("action", ["rename", "archive", "unarchive", "delete"] as const),
    title: optional(boundedString("title", 200)),
  }),
  "agent:events": object({
    workspace: absolutePath(),
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:changes": object({
    workspace: absolutePath(),
    sessionId: optional(boundedString("sessionId", 256)),
  }),
  "agent:change": object({
    workspace: optional(absolutePath()),
    sessionId: boundedString("sessionId", 256),
    id: boundedString("id", 256),
    action: oneOf("action", ["approve", "reject", "apply", "revert"] as const),
  }),
  "agent:approve-all-changes": object({
    workspace: optional(absolutePath()),
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:reject-all-changes": object({
    workspace: optional(absolutePath()),
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:discard-session": object({
    workspace: optional(absolutePath()),
    sessionId: boundedString("sessionId", 256),
  }),
  "agent:get-pending-permissions": optional(boundedString("sessionId", 256)),
  "agent:get-session": object({
    workspace: optional(absolutePath()),
    sessionId: boundedString("sessionId", 256),
  }),
  "permission:response": object({
    requestId: boundedString("requestId", 512),
    allowed: boolean("allowed"),
  }),
  "git:commit": object({
    workspace: optional(absolutePath()),
    message: boundedString("message", 5000),
  }),
  "git:generate-commit-msg": object({
    workspace: optional(absolutePath()),
    model: optional(boundedString("model", 256)),
  }),
  "git:status": object({ workspace: optional(absolutePath()) }),
  "git:blame": object({
    workspace: optional(absolutePath()),
    path: absolutePath(),
    startLine: optional(boundedNumber("startLine", 1, 1_000_000)),
    endLine: optional(boundedNumber("endLine", 1, 1_000_000)),
  }),
  "git:file-history": object({
    workspace: optional(absolutePath()),
    path: absolutePath(),
    limit: optional(boundedNumber("limit", 1, 200)),
  }),
  "problems:get": object({ workspace: optional(absolutePath()) }),
  "workspace:search": object({
    workspace: optional(absolutePath()),
    query: boundedString("query", 500, { allowEmpty: true }),
  }),
  "repository:search": object({
    workspace: optional(absolutePath()),
    query: boundedString("query", 500),
    limit: optional(boundedNumber("limit", 1, 100)),
    kind: optional(
      oneOf("kind", ["mixed", "filename", "symbol", "text", "recent"] as const),
    ),
  }),
  "repository:index": none,
  "repository:status": object({ workspace: optional(absolutePath()) }),
  "context:assemble": object({
    workspace: optional(absolutePath()),
    prompt: boundedString("prompt", 200_000),
    openFile: optional(boundedString("openFile", 4096)),
    selection: optional(boundedString("selection", 200_000)),
    budget: optional(boundedNumber("budget", 1000, 500_000)),
  }),
  "verification:run": object({
    workspace: optional(absolutePath()),
    sessionId: optional(boundedString("sessionId", 256)),
    paths: optional(
      arrayOf(boundedString("changed path", 4096), "paths", 500),
    ),
    level: optional(
      oneOf("level", ["targeted", "full", "typecheck", "build"] as const),
    ),
  }),
  "verification:list": object({
    workspace: optional(absolutePath()),
    sessionId: optional(boundedString("sessionId", 256)),
  }),
  "diagnostics:get": object({ workspace: optional(absolutePath()) }),
  "index:rebuild": object({ workspace: optional(absolutePath()) }),
  "index:search": object({
    workspace: optional(absolutePath()),
    query: boundedString("query", 500),
  }),
} as const;

export type IpcChannel = keyof typeof IPC_SCHEMAS;

/**
 * Validate a payload for a channel. `undefined`/`null` inputs are passed through
 * the schema so `none`, `optional` and full-object schemas behave consistently.
 */
export function validateIpcPayload<T = unknown>(
  channel: string,
  value: unknown,
): T {
  const schema = (IPC_SCHEMAS as Record<string, Validator<unknown> | undefined>)[
    channel
  ];
  assertPayloadSize(value, channel);
  if (!schema) {
    // Failing closed is the whole point: an unregistered channel is a bug, not
    // permission to forward raw renderer input.
    throw new IpcValidationError(channel, "no schema registered for this channel");
  }
  return schema(value, channel) as T;
}
