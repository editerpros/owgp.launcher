const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const game = require('./services/installer');
const config = require('./config');

let mainWindow;
let busy = false;

app.setAppUserModelId('com.imaginecloud.owgp.launcher');

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 660,
    backgroundColor: '#090b10',
    title: 'OWGP Launcher',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function runExclusive(task) {
  if (busy) throw new Error('Another launcher operation is already running.');
  busy = true;
  send('busy', true);
  try {
    return await task();
  } finally {
    busy = false;
    send('busy', false);
  }
}

ipcMain.handle('game:status', async () => game.checkStatus());
ipcMain.handle('game:install', () => runExclusive(() => game.installLatest(send)));
ipcMain.handle('game:repair', () => runExclusive(() => game.repair(send)));
ipcMain.handle('game:play', async () => {
  const executable = await game.getExecutablePath();
  const workingDirectory = path.dirname(executable);
  const child = spawn(executable, [], {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.once('error', error => send('progress', { phase: 'error', message: `Could not start OWGP: ${error.message}` }));
  child.unref();
  return { success: true };
});
ipcMain.handle('app:openExternal', async (_event, url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links are allowed.');
  await shell.openExternal(parsed.toString());
});
ipcMain.handle('app:checkLauncherUpdates', async () => {
  if (!app.isPackaged) {
    return { available: false, message: 'Launcher self-updates are available after the launcher is packaged and published.' };
  }
  return autoUpdater.checkForUpdates();
});
ipcMain.handle('app:getConfig', async () => ({
  gameRepository: `https://github.com/${config.gameRepository.owner}/${config.gameRepository.repo}`,
  launcherRepository: `https://github.com/${config.launcherRepository.owner}/${config.launcherRepository.repo}`
}));

function configureLauncherUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => send('launcher-update', { state: 'checking' }));
  autoUpdater.on('update-available', info => send('launcher-update', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send('launcher-update', { state: 'current' }));
  autoUpdater.on('download-progress', progress => send('launcher-update', { state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => send('launcher-update', { state: 'downloaded', version: info.version }));
  autoUpdater.on('error', error => send('launcher-update', { state: 'error', message: error.message }));

  autoUpdater.checkForUpdatesAndNotify().catch(error => {
    send('launcher-update', { state: 'error', message: error.message });
  });
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) configureLauncherUpdater();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
