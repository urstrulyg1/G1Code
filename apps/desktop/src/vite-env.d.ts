interface Window {
  g1code: {
    chooseWorkspace(): Promise<string | null>;
    listDirectory(directory: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, contents: string): Promise<boolean>;
    runCommand(command: string, cwd: string): Promise<{ output: string; exitCode: number }>;
    getSettings(): Promise<{ provider: string; endpoint: string; model: string; temperature: number; maxTokens: number; apiKeyConfigured: boolean }>;
    saveSettings(settings: Record<string, unknown>): Promise<unknown>;
    getModels(): Promise<Array<{ id: string; name: string; supportsTools?: boolean }>>;
    testProvider(model?: string): Promise<{ connected: boolean; model?: string; models: Array<{ id: string; name: string }> }>;
    startAgent(input: { workspace: string; prompt: string; mode: 'ask' | 'plan' | 'agent' }): Promise<{ sessionId: string }>;
    stopAgent(sessionId: string): void;
    listSessions(workspace: string): Promise<Array<{ id: string; title: string; mode: string; status: string }>>;
    loadSessionEvents(sessionId: string): Promise<Array<{ eventType: string; payload: unknown; timestamp: string }>>;
    respondPermission(requestId: string, allowed: boolean): void;
    onAgentEvent(listener: (event: unknown) => void): () => void;
    onPermissionRequest(listener: (event: unknown) => void): () => void;
  };
}
