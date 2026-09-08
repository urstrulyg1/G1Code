export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED"
  | "CANCELLED"
  | "INTERRUPTED";
export type ChangeStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "APPLYING"
  | "APPLIED"
  | "REVERTED"
  | "CONFLICT";
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
  originalContent: string;
  proposedContent: string;
  appliedContent?: string | null;
  patch: string;
  status: ChangeStatus;
  createdAt: string;
  updatedAt: string;
};
export type ChangeBatchStatus =
  | "PENDING"
  | "PREPARING"
  | "APPLYING"
  | "APPLIED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "PARTIAL_FAILURE"
  | "CONFLICT"
  | "FAILED";
export type ChangeBatch = {
  id: string;
  sessionId: string;
  workspaceId: string;
  status: ChangeBatchStatus;
  failureReason?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};
