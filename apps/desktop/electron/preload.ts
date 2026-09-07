import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('g1code', {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose') as Promise<string | null>,
  listDirectory: (directory: string) => ipcRenderer.invoke('workspace:list', directory) as Promise<Array<{ name: string; kind: 'file' | 'directory' }>>,
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
  writeFile: (filePath: string, contents: string) => ipcRenderer.invoke('file:write', filePath, contents) as Promise<boolean>,
  runCommand: (command: string, cwd: string) => ipcRenderer.invoke('terminal:run', command, cwd) as Promise<{ output: string; exitCode: number }>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<{ provider: string; endpoint: string; model: string; temperature: number; maxTokens: number; apiKeyConfigured: boolean }>,
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:save', settings),
  getModels: () => ipcRenderer.invoke('provider:models'),
  testProvider: (model?: string) => ipcRenderer.invoke('provider:test', model),
  startAgent: (input: { workspace: string; prompt: string; mode: 'ask' | 'plan' | 'agent' }) => ipcRenderer.invoke('agent:start', input),
  stopAgent: (sessionId: string) => ipcRenderer.send('agent:stop', sessionId),
  listSessions: (workspace: string) => ipcRenderer.invoke('agent:sessions', workspace),
  loadSessionEvents: (sessionId: string) => ipcRenderer.invoke('agent:events', sessionId),
  respondPermission: (requestId: string, allowed: boolean) => ipcRenderer.send('permission:response', { requestId, allowed }),
  onAgentEvent: (listener: (event: unknown) => void) => { const callback = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value); ipcRenderer.on('agent:event', callback); return () => ipcRenderer.removeListener('agent:event', callback); },
  onPermissionRequest: (listener: (event: unknown) => void) => { const callback = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value); ipcRenderer.on('permission:request', callback); return () => ipcRenderer.removeListener('permission:request', callback); }
});
