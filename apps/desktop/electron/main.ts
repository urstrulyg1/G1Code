import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { registerRuntimeHandlers } from './runtime';
import { safePath } from '../../../packages/tools/workspace';

const execFileAsync = promisify(execFile);
const root = __dirname;
let selectedWorkspace: string | undefined;

function createWindow() {
  const window = new BrowserWindow({ width: 1480, height: 920, minWidth: 1000, minHeight: 640, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (!app.isPackaged) window.loadURL('http://localhost:5173');
  else window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
}

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  selectedWorkspace = path.resolve(result.filePaths[0]);
  return selectedWorkspace;
});
ipcMain.handle('workspace:list', async (_event, directory: string) => {
  if (!selectedWorkspace) throw new Error('Open a workspace first');
  const entries = await fs.readdir(selectedWorkspace ? safePath(selectedWorkspace, path.relative(selectedWorkspace, directory)) : directory, { withFileTypes: true });
  return entries.filter((entry) => !entry.name.startsWith('.') || entry.name === '.g1code').map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })).sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
});
ipcMain.handle('file:read', async (_event, filePath: string) => { if (!selectedWorkspace) throw new Error('Open a workspace first'); return fs.readFile(safePath(selectedWorkspace, path.relative(selectedWorkspace, filePath)), 'utf8'); });
ipcMain.handle('file:write', async (_event, filePath: string, contents: string) => { if (!selectedWorkspace) throw new Error('Open a workspace first'); if (typeof contents !== 'string' || contents.length > 10_000_000) throw new Error('Invalid file contents'); await fs.writeFile(safePath(selectedWorkspace, path.relative(selectedWorkspace, filePath)), contents, 'utf8'); return true; });
ipcMain.handle('terminal:run', async (_event, command: string, cwd: string) => {
  if (typeof command !== 'string' || command.length > 10_000) throw new Error('Invalid command');
  if (!selectedWorkspace) throw new Error('Open a workspace first');
  const workingDirectory = safePath(selectedWorkspace, path.relative(selectedWorkspace, cwd));
  try { const result = await execFileAsync(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command], { cwd: workingDirectory, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }); return { output: `${result.stdout}${result.stderr}`, exitCode: 0 }; }
  catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; return { output: `${failure.stdout ?? ''}${failure.stderr ?? String(error)}`, exitCode: failure.code ?? 1 }; }
});
app.whenReady().then(() => { registerRuntimeHandlers(() => BrowserWindow.getAllWindows()[0], () => selectedWorkspace); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
