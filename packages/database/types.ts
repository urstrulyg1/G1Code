export type SessionStatus =
  "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED" | "INTERRUPTED";
export type ChangeStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "APPLIED" | "REVERTED" | "CONFLICT";
export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  mode: string;
  model: string;
  provider: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
};
export type AgentEventRecord = {
  id: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  timestamp: string;
};
export type FileChange = {
  id: string;
  sessionId: string;
  path: string;
  originalHash: string;
  proposedHash: string;
  patch: string;
  status: ChangeStatus;
  createdAt: string;
  updatedAt: string;
};
