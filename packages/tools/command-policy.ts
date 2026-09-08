export type CommandRisk =
  | "READ_ONLY"
  | "LOCAL_SAFE"
  | "MODIFYING"
  | "NETWORK"
  | "DEPENDENCY_CHANGE"
  | "DESTRUCTIVE"
  | "PRIVILEGED"
  | "UNKNOWN";
export function classifyCommand(command: string): CommandRisk[] {
  const normalized = command.trim().toLowerCase();
  const risks = new Set<CommandRisk>();
  if (/\b(sudo|doas|runas)\b/.test(normalized)) risks.add("PRIVILEGED");
  if (
    /(^|\s)(rm|rmdir|del|format|mkfs)\b|git\s+(reset|clean)|\b(drop|truncate)\b/.test(
      normalized,
    )
  )
    risks.add("DESTRUCTIVE");
  if (
    /\b(npm|pip|cargo|go|get|mvn|gradle)\s+(install|add|get|dependency|get)\b/.test(
      normalized,
    )
  )
    risks.add("DEPENDENCY_CHANGE");
  if (/\b(curl|wget|nc|ssh|scp)\b|https?:\/\//.test(normalized))
    risks.add("NETWORK");
  if (/\b(test|check|build|lint|status|diff|log|branch)\b/.test(normalized))
    risks.add("LOCAL_SAFE");
  if (
    /\b(git\s+(status|diff|log|branch)|pwd|ls|dir|cat|type)\b/.test(normalized)
  )
    risks.add("READ_ONLY");
  if (/\b(chmod|chown|service|launchctl|systemctl)\b/.test(normalized))
    risks.add("MODIFYING");
  if (!risks.size) risks.add("UNKNOWN");
  return [...risks];
}
