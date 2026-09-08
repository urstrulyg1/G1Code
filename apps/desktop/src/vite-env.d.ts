interface Window {
  g1code: {
    chooseWorkspace(): Promise<string | null>;
    listDirectory(
      directory: string,
    ): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, contents: string): Promise<boolean>;
    runCommand(
      command: string,
      cwd: string,
    ): Promise<{ output: string; exitCode: number }>;
    getSettings(): Promise<{
      provider: string;
      endpoint: string;
      model: string;
      temperature: number;
      maxTokens: number;
      apiKeyConfigured: boolean;
    }>;
    saveSettings(settings: Record<string, unknown>): Promise<unknown>;
    getModels(): Promise<
      Array<{ id: string; name: string; supportsTools?: boolean }>
    >;
    testProvider(model?: string): Promise<{
      connected: boolean;
      model?: string;
      models: Array<{ id: string; name: string }>;
    }>;
    startAgent(input: {
      workspace: string;
      prompt: string;
      mode: "ask" | "plan" | "agent";
    }): Promise<{ sessionId: string }>;
    stopAgent(sessionId: string): void;
    listSessions(
      workspace: string,
    ): Promise<
      Array<{ id: string; title: string; mode: string; status: string }>
    >;
    rebuildIndex(workspace: string): Promise<{ files: number }>;
    searchSymbols(workspace: string, query: string): Promise<Array<{ symbol: string; kind: string; path: string; line: number; column: number; parent?: string }>>;
    loadSessionEvents(
      workspace: string,
      sessionId: string,
    ): Promise<
      Array<{ eventType: string; payload: unknown; timestamp: string }>
    >;
    loadSession(workspace: string, sessionId: string): Promise<{
      session: { id: string; title: string; mode: string; status: string };
      messages: Array<{ role: string; content: string }>;
      events: Array<{ eventType: string; payload: unknown; timestamp: string }>;
      changes: Array<{ id: string; path: string; patch: string; status: string }>;
      testRuns: Array<{ id: string; command: string; exitCode?: number; passed?: number; duration: number }>;
      repairs: Array<{ id: string; attemptNumber: number; diagnosis: string; result: string }>;
      summary?: { task: string; status: string; summary: string };
      checkpoint?: { state: string; checkpoint: { resumable?: boolean; nextAction?: string } };
    }>;
    listChanges(workspace: string, sessionId?: string): Promise<Array<{
      id: string;
      sessionId: string;
      path: string;
      originalHash: string;
      proposedHash: string;
      originalContent: string;
      proposedContent: string;
      appliedContent?: string | null;
      patch: string;
      status: string;
    }>>;
    change(workspace: string, sessionId: string, id: string, action: "approve" | "reject" | "apply" | "revert"): Promise<unknown>;
    approveAllChanges(workspace: string, sessionId: string): Promise<unknown>;
    rejectAllChanges(workspace: string, sessionId: string): Promise<unknown>;
    discardSession(workspace: string, sessionId: string): Promise<unknown>;
    respondPermission(requestId: string, allowed: boolean): void;
    onAgentEvent(listener: (event: unknown) => void): () => void;
    onPermissionRequest(listener: (event: unknown) => void): () => void;
  };
}
