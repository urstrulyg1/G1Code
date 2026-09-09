export function requireBoundedString(
  value: unknown,
  name: string,
  maxLength = 4096,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

export function requireObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

export function requireAction(
  value: unknown,
  actions: readonly string[],
): string {
  if (typeof value !== "string" || !actions.includes(value))
    throw new Error("Invalid action");
  return value;
}

export * from "./redaction";
