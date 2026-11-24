const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('launcher', {
  getStatus: () => ipcRenderer.invoke('game:status'),
  install: () => ipcRenderer.invoke('game:install'),
  repair: () => ipcRenderer.invoke('game:repair'),
  play: () => ipcRenderer.invoke('game:play'),
  getConfig: () => ipcRenderer.invoke('app:getConfig'),
  checkLauncherUpdates: () => ipcRenderer.invoke('app:checkLauncherUpdates'),
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  onProgress: callback => subscribe('progress', callback),
  onBusy: callback => subscribe('busy', callback),
  onLauncherUpdate: callback => subscribe('launcher-update', callback)
});
