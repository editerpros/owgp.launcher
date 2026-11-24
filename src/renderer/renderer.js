const $ = id => document.getElementById(id);
const playButton = $('play');
const installButton = $('install');
const repairButton = $('repair');
let isBusy = false;
let currentStatus = null;

function setMessage(message) {
  $('status-message').textContent = message;
}

function setProgress(progress) {
  if (typeof progress.percent === 'number') {
    const percent = Math.max(0, Math.min(100, progress.percent));
    $('progress-bar').style.width = `${percent}%`;
    $('percent').textContent = `${Math.round(percent)}%`;
  } else if (progress.phase === 'verify' || progress.phase === 'extract' || progress.phase === 'repair') {
    $('percent').textContent = '…';
  }
  if (progress.message) setMessage(progress.message);
  if (progress.phase === 'complete') $('progress-bar').style.width = '100%';
}

function setBusy(value) {
  isBusy = Boolean(value);
  updateButtons();
}

function updateButtons() {
  const s = currentStatus;
  playButton.disabled = isBusy || !s?.installed;
  installButton.disabled = isBusy || !s?.releaseAvailable;
  repairButton.disabled = isBusy || !s?.releaseAvailable;

  if (!s) return;
  $('install-state').textContent = s.installed ? `INSTALLED ${s.installedVersion}` : 'NOT INSTALLED';
  $('version').textContent = s.releaseAvailable ? `LATEST VERSION ${s.latestVersion}` : 'GAME RELEASE NOT FOUND';
  $('connection').textContent = s.releaseAvailable ? 'GITHUB CONNECTED' : 'RELEASE UNAVAILABLE';
  $('connection').previousElementSibling.style.background = s.releaseAvailable ? '#39c985' : '#e3a43b';

  if (!s.releaseAvailable) {
    installButton.textContent = 'DOWNLOAD GAME';
    if (!s.installed) repairButton.textContent = 'REPAIR';
    return;
  }
  installButton.textContent = !s.installed ? 'DOWNLOAD GAME' : (s.updateAvailable ? 'UPDATE GAME' : 'REINSTALL GAME');
  repairButton.textContent = 'VERIFY / REPAIR';
}

async function refreshStatus() {
  try {
    setMessage('Checking your installation and GitHub Releases…');
    currentStatus = await window.launcher.getStatus();
    updateButtons();

    if (currentStatus.releaseAvailable) {
      setMessage(currentStatus.updateAvailable
        ? (currentStatus.installed ? 'A new OWGP update is available.' : 'OWGP is ready to download.')
        : 'OWGP is up to date. Ready to race.');
    } else if (currentStatus.installed) {
      setMessage(`You can still play your installed game. ${currentStatus.releaseError || ''}`);
    } else {
      setMessage(currentStatus.releaseError || 'No downloadable game release is available yet.');
    }
  } catch (error) {
    setMessage(error.message);
  }
}

async function perform(action) {
  try {
    await action();
    await refreshStatus();
  } catch (error) {
    setMessage(`Error: ${error.message}`);
  }
}

playButton.addEventListener('click', () => perform(() => window.launcher.play()));
installButton.addEventListener('click', () => perform(() => window.launcher.install()));
repairButton.addEventListener('click', () => perform(() => window.launcher.repair()));

$('check-launcher').addEventListener('click', async () => {
  $('launcher-update-status').textContent = 'Checking for launcher updates…';
  try {
    const result = await window.launcher.checkLauncherUpdates();
    if (!result?.updateInfo) $('launcher-update-status').textContent = result?.message || 'Launcher update check started.';
  } catch (error) {
    $('launcher-update-status').textContent = error.message;
  }
});

$('repo-link').addEventListener('click', event => {
  event.preventDefault();
  window.launcher.openExternal('https://github.com/Imagine-Cloud-Service/owgp-source');
});

window.launcher.onProgress(setProgress);
window.launcher.onBusy(setBusy);
window.launcher.onLauncherUpdate(data => {
  const messages = {
    checking: 'Checking for launcher updates…',
    current: 'Launcher is up to date.',
    available: `Launcher update ${data.version} found. Downloading…`,
    downloading: `Downloading launcher update… ${data.percent}%`,
    downloaded: `Launcher ${data.version} downloaded. It will install when you close the launcher.`,
    error: `Launcher update: ${data.message}`
  };
  $('launcher-update-status').textContent = messages[data.state] || data.state;
});

refreshStatus();
