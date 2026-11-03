'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { FileStore } = require('./fileStore.cjs');

// 開発時: `npm run dev` で起動した Vite のアドレスを ELECTRON_DEV_URL に入れると、そこを開く
// 保存先はアプリ名に左右されないよう固定する(開発時と配布版で同じ場所になる)
const APP_NAME = 'racing-line-lab';
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

const DEV_URL = process.env.ELECTRON_DEV_URL || '';
let store;
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'Racing Line Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 外部リンク(地図の出典など)は既定のブラウザで開く。アプリの中では開かない
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(DEV_URL && url.startsWith(DEV_URL))) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); }
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  store = new FileStore(settingsFile);

  ipcMain.on('storage:get', (e, key) => { e.returnValue = typeof key === 'string' ? store.get(key) : null; });
  ipcMain.on('storage:clear', (e) => { store.clear(); e.returnValue = true; });
  ipcMain.on('storage:set', (_e, key, value) => { if (typeof key === 'string' && typeof value === 'string') store.set(key, value); });

  ipcMain.handle('file:save-text', async (_e, fileName, text) => {
    if (typeof fileName !== 'string' || typeof text !== 'string') return { ok: false };
    const safe = path.basename(fileName);
    const r = await dialog.showSaveDialog(win ?? undefined, { defaultPath: path.join(app.getPath('documents'), safe) });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(r.filePath, text, 'utf8'); return { ok: true, path: r.filePath }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // 前回の走行ログの自動読み込み: .vbo だけ、大きすぎないものだけを読む
  ipcMain.handle('file:read-text', async (_e, p) => {
    try {
      if (typeof p !== 'string' || !/\.vbo$/i.test(p) || !path.isAbsolute(p)) return null;
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > 500 * 1024 * 1024) return null;
      return fs.readFileSync(p, 'utf8');
    } catch { return null; }
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { store?.flush(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
