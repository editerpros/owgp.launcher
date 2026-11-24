const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const game = require('./services/installer');
const config = require('./config');
const logger = require('./services/logger');

let mainWindow;
let busy = false;

app.setAppUserModelId('com.imaginecloud.owgp.launcher');

function send(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (error) {
    logger.logError(`IPC event send (${channel}) failed`, error);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown launcher error');
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
  mainWindow.webContents.on('unresponsive', () => {
    logger.writeLog('warning', 'Launcher renderer became unresponsive');
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.writeLog('error', 'Launcher renderer process exited', details);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level >= 2) logger.writeLog('warning', 'Renderer console error', { message: details.message, line: details.lineNumber });
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(error => {
    logger.logError('Could not load launcher window', error);
  });
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

// Resolve operation errors as normal IPC responses. This ensures the renderer
// always receives a reply and can show a useful message instead of hanging.
function handleOperation(channel, operation) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await operation(...args);
      return result;
    } catch (error) {
      const message = errorMessage(error);
      await logger.logError(`${channel} failed`, error);
      send('progress', { phase: 'error', message });
      return { success: false, error: message, logPath: logger.getLogPath() };
    }
  });
}

ipcMain.handle('game:status', async () => {
  try {
    return await game.checkStatus();
  } catch (error) {
    await logger.logError('Could not check game status', error);
    return {
      installed: false,
      installedVersion: null,
      latestVersion: null,
      releaseAvailable: false,
      releaseError: errorMessage(error),
      updateAvailable: false,
      gameDirectory: game.gameDir
    };
  }
});

handleOperation('game:install', () => runExclusive(() => game.installLatest(send)));
handleOperation('game:repair', () => runExclusive(() => game.repair(send)));

handleOperation('game:play', async () => {
  const executable = await game.getExecutablePath();
  const workingDirectory = path.dirname(executable);
  const child = spawn(executable, [], {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.once('error', error => {
    logger.logError('Could not start OWGP', error);
    send('progress', { phase: 'error', message: `Could not start OWGP: ${error.message}` });
  });
  child.unref();
  return { success: true };
});

handleOperation('app:openExternal', async url => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links are allowed.');
  await shell.openExternal(parsed.toString());
  return { success: true };
});

handleOperation('app:checkLauncherUpdates', async () => {
  if (!app.isPackaged) {
    return { available: false, message: 'Launcher self-updates are available after the launcher is packaged and published.' };
  }
  const result = await autoUpdater.checkForUpdates();
  return { available: Boolean(result?.updateInfo), updateInfo: result?.updateInfo || null };
});

ipcMain.handle('app:getConfig', async () => ({
  gameRepository: `https://github.com/${config.gameRepository.owner}/${config.gameRepository.repo}`,
  launcherRepository: `https://github.com/${config.launcherRepository.owner}/${config.launcherRepository.repo}`,
  logPath: logger.getLogPath()
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
  autoUpdater.on('error', error => {
    logger.logError('Launcher self-update failed', error);
    send('launcher-update', { state: 'error', message: error.message });
  });

  autoUpdater.checkForUpdatesAndNotify().catch(error => {
    logger.logError('Launcher update check failed', error);
    send('launcher-update', { state: 'error', message: error.message });
  });
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) configureLauncherUpdater();
}).catch(error => logger.logError('Launcher startup failed', error));

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
