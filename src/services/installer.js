const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const extractZip = require('extract-zip');
const { app } = require('electron');
const config = require('../config');
const { getLatestGameRelease, isSafeRelativePath } = require('./github');
const logger = require('./logger');

const gameDir = path.join(app.getPath('userData'), config.gameDirectoryName);
const localManifestPath = path.join(gameDir, 'game-manifest.json');

function report(send, payload) {
  try {
    if (typeof send === 'function') send('progress', payload);
  } catch (error) {
    logger.logError('Could not send install progress to UI', error);
  }
}

function resolveInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error(`Unsafe game file path: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Game file path escapes the installation directory: ${relativePath}`);
  }
  return resolved;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadFile(url, destination, onProgress = () => {}) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') throw new Error('Game downloads must use HTTPS.');

  let response;
  try {
    response = await fetch(parsedUrl, {
      headers: { 'User-Agent': 'OWGP-Launcher' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30 * 60 * 1000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new Error('The game download timed out after 30 minutes. Check your connection and retry.');
    }
    throw new Error(`The game download could not connect: ${error.message || 'Check your internet connection.'}`);
  }

  if (!response.ok || !response.body) {
    throw new Error(`Game download failed (HTTP ${response.status}). Check that the release asset is publicly accessible.`);
  }
  if (new URL(response.url).protocol !== 'https:') throw new Error('GitHub returned an insecure download URL.');

  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;
  let lastProgressAt = 0;
  let lastPercent = -1;
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const percent = total > 0 ? Math.min(100, Math.round(received / total * 100)) : null;
      const now = Date.now();
      // Avoid flooding Electron IPC with one message for every download chunk.
      // The UI still receives every percentage change, with a 150 ms throttle.
      if (percent !== lastPercent || now - lastProgressAt >= 150 || received === total) {
        lastProgressAt = now;
        if (percent !== null) lastPercent = percent;
        onProgress({ received, total, percent });
      }
      callback(null, chunk);
    }
  });

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      progressStream,
      fs.createWriteStream(destination)
    );
  } catch (error) {
    await fsp.rm(destination, { force: true }).catch(() => {});
    throw new Error(`Game download was interrupted: ${error.message}`);
  }

  const stat = await fsp.stat(destination);
  if (stat.size === 0) throw new Error('GitHub returned an empty game archive.');
  if (total > 0 && stat.size !== total) {
    throw new Error(`The game download is incomplete (${stat.size} of ${total} bytes received).`);
  }
}

async function getInstalledInfo() {
  try {
    const manifest = JSON.parse(await fsp.readFile(localManifestPath, 'utf8'));
    if (!manifest || typeof manifest.version !== 'string' || !isSafeRelativePath(manifest.entryPoint)) {
      return { installed: false, version: null, entryPoint: null, executableExists: false };
    }
    const executable = resolveInside(gameDir, manifest.entryPoint);
    await fsp.access(executable);
    return { installed: true, version: manifest.version, entryPoint: manifest.entryPoint, executableExists: true };
  } catch {
    return { installed: false, version: null, entryPoint: null, executableExists: false };
  }
}

async function verifyInstalledFiles(manifest, root = gameDir) {
  const problems = [];
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    try {
      const filePath = resolveInside(root, relativePath);
      const actualHash = await hashFile(filePath);
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) problems.push(relativePath);
    } catch {
      problems.push(relativePath);
    }
  }
  return problems;
}

async function installLatest(send = () => {}) {
  const tempRoot = path.join(app.getPath('temp'), `owgp-launcher-${crypto.randomUUID()}`);
  const archivePath = path.join(tempRoot, 'game.zip');
  const stagingPath = path.join(tempRoot, 'staging');
  const backupPath = `${gameDir}.backup`;
  let movedOld = false;

  try {
    report(send, { phase: 'prepare', message: 'Checking the latest OWGP release…' });
    await logger.writeLog('info', 'Starting OWGP installation');
    const { manifest, archiveUrl } = await getLatestGameRelease();
    await logger.writeLog('info', 'Latest OWGP release resolved', { version: manifest.version, archive: manifest.archive, fileCount: Object.keys(manifest.files).length, entryPoint: manifest.entryPoint });

    await fsp.mkdir(stagingPath, { recursive: true });
    report(send, { phase: 'download', message: 'Downloading OWGP game files…', percent: 0 });
    await downloadFile(archiveUrl, archivePath, progress => report(send, { phase: 'download', ...progress }));
    await logger.writeLog('info', 'OWGP archive download completed', { archivePath, bytes: (await fsp.stat(archivePath)).size });

    report(send, { phase: 'verify', message: 'Verifying the downloaded package…' });
    const archiveHash = await hashFile(archivePath);
    await logger.writeLog('info', 'OWGP archive SHA-256 calculated', { actual: archiveHash, expected: manifest.sha256 });
    if (archiveHash.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error('The downloaded archive failed its SHA-256 check. Your current installation has not been changed. Please re-upload the matching ZIP and manifest to the same GitHub release.');
    }

    report(send, { phase: 'extract', message: 'Extracting game files…' });
    await extractZip(archivePath, { dir: stagingPath });
    await logger.writeLog('info', 'OWGP archive extracted', { stagingPath });

    report(send, { phase: 'verify', message: 'Verifying installed game files…' });
    for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
      const filePath = resolveInside(stagingPath, relativePath);
      let actualHash;
      try {
        actualHash = await hashFile(filePath);
      } catch {
        throw new Error(`A required game file is missing from the ZIP: ${relativePath}. Rebuild and re-upload the game archive.`);
      }
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(`Extracted file verification failed: ${relativePath}. The ZIP and manifest do not match.`);
      }
    }
    await logger.writeLog('info', 'OWGP manifest files verified', { fileCount: Object.keys(manifest.files).length });

    const executable = resolveInside(stagingPath, manifest.entryPoint);
    await fsp.access(executable);
    await fsp.writeFile(path.join(stagingPath, 'game-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    await fsp.mkdir(path.dirname(gameDir), { recursive: true });
    await fsp.rm(backupPath, { recursive: true, force: true });
    try {
      await fsp.rename(gameDir, backupPath);
      movedOld = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not move the previous OWGP installation. Close the game and try again. (${error.message})`);
    }

    try {
      await fsp.rename(stagingPath, gameDir);
    } catch (error) {
      if (movedOld) await fsp.rename(backupPath, gameDir).catch(restoreError => logger.logError('Could not restore previous OWGP installation', restoreError));
      throw new Error(`Could not place the new OWGP files. Close the game and check folder permissions. (${error.message})`);
    }

    await fsp.rm(backupPath, { recursive: true, force: true }).catch(error => logger.logError('Could not remove previous OWGP backup folder', error));
    await logger.writeLog('info', 'OWGP installation completed', { version: manifest.version, gameDir });
    report(send, { phase: 'complete', message: `OWGP ${manifest.version} is installed and ready.`, percent: 100 });
    return { success: true, version: manifest.version };
  } catch (error) {
    report(send, { phase: 'error', message: error.message || 'OWGP installation failed.' });
    await logger.logError('OWGP game installation failed', error);
    throw error;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(error => logger.logError('Could not clean temporary install files', error));
  }
}

async function checkStatus() {
  const installed = await getInstalledInfo();
  let latestVersion = null;
  let releaseAvailable = false;
  let releaseError = null;

  try {
    const latest = await getLatestGameRelease();
    latestVersion = latest.manifest.version;
    releaseAvailable = true;
  } catch (error) {
    releaseError = error.message;
  }

  return {
    installed: installed.installed,
    installedVersion: installed.version,
    entryPoint: installed.entryPoint,
    latestVersion,
    releaseAvailable,
    releaseError,
    updateAvailable: releaseAvailable && (!installed.installed || installed.version !== latestVersion),
    gameDirectory: gameDir
  };
}

async function repair(send = () => {}) {
  const { manifest } = await getLatestGameRelease();
  const installed = await getInstalledInfo();
  if (!installed.installed) {
    report(send, { phase: 'repair', message: 'Game installation is missing. Installing a fresh copy…' });
    return { ...(await installLatest(send)), repaired: true };
  }

  report(send, { phase: 'verify', message: 'Checking installed OWGP files…' });
  const problems = await verifyInstalledFiles(manifest);
  if (installed.version === manifest.version && problems.length === 0) {
    report(send, { phase: 'complete', message: 'All OWGP game files are healthy.', percent: 100 });
    return { success: true, version: manifest.version, repaired: false };
  }

  const message = problems.length
    ? `Found ${problems.length} missing or modified file(s). Reinstalling the verified game…`
    : `OWGP ${manifest.version} is available. Updating the game…`;
  report(send, { phase: 'repair', message });
  return { ...(await installLatest(send)), repaired: true };
}

async function getExecutablePath() {
  const raw = await fsp.readFile(localManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest || !isSafeRelativePath(manifest.entryPoint) || !manifest.entryPoint.toLowerCase().endsWith('.exe')) {
    throw new Error('The installed game manifest is invalid. Use Repair to reinstall OWGP.');
  }
  const executable = resolveInside(gameDir, manifest.entryPoint);
  await fsp.access(executable);
  return executable;
}

module.exports = { checkStatus, installLatest, repair, getExecutablePath, gameDir };
