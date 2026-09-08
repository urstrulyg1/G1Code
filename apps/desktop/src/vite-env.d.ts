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
      apiKeyMasked?: string;
    }>;
    saveSettings(settings: Record<string, unknown>): Promise<unknown>;
    getModels(provider?: string): Promise<
      Array<{
        id: string;
        name: string;
        provider?: string;
        contextWindow?: number;
        contextWindowFormatted?: string;
        supportsTools?: boolean;
        supportsStreaming?: boolean;
        supportsVision?: boolean;
        isPromotional?: boolean;
        description?: string;
      }>
    >;
    getFreeModels(provider?: string): Promise<
      Array<{
        id: string;
        name: string;
        provider?: string;
        contextWindow?: number;
        contextWindowFormatted?: string;
        supportsTools?: boolean;
        supportsStreaming?: boolean;
        supportsVision?: boolean;
        isPromotional?: boolean;
        description?: string;
      }>
    >;
    testProvider(
      model?: string,
      provider?: string,
    ): Promise<{
      connected: boolean;
      model?: string;
      working?: boolean;
      latencyMs?: number;
      ttftMs?: number;
      output?: string;
      error?: string;
    }>;
    verifyProvider(provider?: string): Promise<{
      connected: boolean;
      modelCount: number;
      message: string;
      error?: string;
    }>;
    refreshModels(provider?: string): Promise<{
      success: boolean;
      models: any[];
      count: number;
      error?: string;
    }>;
    startAgent(input: {
      workspace: string;
      prompt: string;
      mode: "ask" | "plan" | "agent";
      model?: string;
    }): Promise<{ sessionId: string; model?: string }>;
    setSessionModel(
      sessionId: string,
      model: string,
    ): Promise<{ success: boolean; model: string }>;
    commitGit(
      workspace: string,
      message: string,
    ): Promise<{ success: boolean; output: string }>;
    generateCommitMsg(
      workspace: string,
      model?: string,
    ): Promise<{ message: string }>;
    searchWorkspace(
      workspace: string,
      query: string,
    ): Promise<Array<{ file: string; line: number; content: string }>>;
    getGitStatus(workspace: string): Promise<{
      branch: string;
      head: string;
      status: string;
      diff: string;
      modifiedFiles: string[];
      recentCommits: string[];
    }>;
    getProblems(workspace: string): Promise<{
      problems: Array<{
        id: string;
        source: "test" | "conflict" | "agent" | "security";
        severity: "error" | "warning" | "info";
        message: string;
        file?: string;
        line?: number;
      }>;
      count: number;
    }>;
    stopAgent(sessionId: string): void;
    listSessions(
      workspace: string,
    ): Promise<
      Array<{
        id: string;
        title: string;
        mode: string;
        status: string;
        model?: string;
      }>
    >;
    rebuildIndex(workspace: string): Promise<{ files: number }>;
    searchSymbols(
      workspace: string,
      query: string,
    ): Promise<
      Array<{
        symbol: string;
        kind: string;
        path: string;
        line: number;
        column: number;
        parent?: string;
      }>
    >;
    loadSessionEvents(
      workspace: string,
      sessionId: string,
    ): Promise<
      Array<{ eventType: string; payload: unknown; timestamp: string }>
    >;
    loadSession(
      workspace: string,
      sessionId: string,
    ): Promise<{
      session: {
        id: string;
        title: string;
        mode: string;
        status: string;
        model?: string;
      };
      messages: Array<{ role: string; content: string }>;
      events: Array<{ eventType: string; payload: unknown; timestamp: string }>;
      changes: Array<{
        id: string;
        path: string;
        patch: string;
        status: string;
      }>;
      testRuns: Array<{
        id: string;
        command: string;
        exitCode?: number;
        passed?: number;
        duration: number;
      }>;
      repairs: Array<{
        id: string;
        attemptNumber: number;
        diagnosis: string;
        result: string;
      }>;
      summary?: { task: string; status: string; summary: string };
      checkpoint?: {
        state: string;
        checkpoint: { resumable?: boolean; nextAction?: string };
      };
    }>;
    listChanges(
      workspace: string,
      sessionId?: string,
    ): Promise<
      Array<{
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
      }>
    >;
    change(
      workspace: string,
      sessionId: string,
      id: string,
      action: "approve" | "reject" | "apply" | "revert",
    ): Promise<unknown>;
    approveAllChanges(workspace: string, sessionId: string): Promise<unknown>;
    rejectAllChanges(workspace: string, sessionId: string): Promise<unknown>;
    discardSession(workspace: string, sessionId: string): Promise<unknown>;
    respondPermission(requestId: string, allowed: boolean): void;
    onAgentEvent(listener: (event: unknown) => void): () => void;
    onPermissionRequest(listener: (event: unknown) => void): () => void;
  };
}
