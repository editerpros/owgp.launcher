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

const gameDir = path.join(app.getPath('userData'), config.gameDirectoryName);
const localManifestPath = path.join(gameDir, 'game-manifest.json');

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
      redirect: 'follow'
    });
  } catch {
    throw new Error('The game download could not connect. Check your internet connection and retry.');
  }
  if (!response.ok || !response.body) throw new Error(`Game download failed (HTTP ${response.status}).`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('GitHub returned an insecure download URL.');

  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress({
        received,
        total,
        percent: total > 0 ? Math.round(received / total * 100) : null
      });
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
    let filePath;
    try {
      filePath = resolveInside(root, relativePath);
      const actualHash = await hashFile(filePath);
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) problems.push(relativePath);
    } catch {
      problems.push(relativePath);
    }
  }
  return problems;
}

async function installLatest(send) {
  const { manifest, archiveUrl } = await getLatestGameRelease();
  const tempRoot = path.join(app.getPath('temp'), `owgp-launcher-${crypto.randomUUID()}`);
  const archivePath = path.join(tempRoot, 'game.zip');
  const stagingPath = path.join(tempRoot, 'staging');
  const backupPath = `${gameDir}.backup`;

  await fsp.mkdir(stagingPath, { recursive: true });
  try {
    send('progress', { phase: 'download', message: 'Downloading OWGP game files…', percent: 0 });
    await downloadFile(archiveUrl, archivePath, progress => send('progress', { phase: 'download', ...progress }));

    send('progress', { phase: 'verify', message: 'Verifying the downloaded package…' });
    const archiveHash = await hashFile(archivePath);
    if (archiveHash.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error('The downloaded archive failed its SHA-256 check. Your current installation has not been changed.');
    }

    send('progress', { phase: 'extract', message: 'Extracting game files…' });
    await extractZip(archivePath, { dir: stagingPath });

    send('progress', { phase: 'verify', message: 'Verifying installed game files…' });
    for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
      const filePath = resolveInside(stagingPath, relativePath);
      const actualHash = await hashFile(filePath).catch(() => null);
      if (!actualHash || actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(`Extracted file verification failed: ${relativePath}`);
      }
    }

    const executable = resolveInside(stagingPath, manifest.entryPoint);
    await fsp.access(executable);
    await fsp.writeFile(path.join(stagingPath, 'game-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    await fsp.mkdir(path.dirname(gameDir), { recursive: true });
    await fsp.rm(backupPath, { recursive: true, force: true });
    let movedOld = false;
    try {
      await fsp.rename(gameDir, backupPath);
      movedOld = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    try {
      await fsp.rename(stagingPath, gameDir);
    } catch (error) {
      if (movedOld) await fsp.rename(backupPath, gameDir).catch(() => {});
      throw error;
    }

    await fsp.rm(backupPath, { recursive: true, force: true });
    send('progress', { phase: 'complete', message: `OWGP ${manifest.version} is installed and ready.`, percent: 100 });
    return { success: true, version: manifest.version };
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
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

async function repair(send) {
  const { manifest } = await getLatestGameRelease();
  const installed = await getInstalledInfo();
  if (!installed.installed) {
    send('progress', { phase: 'repair', message: 'Game installation is missing. Installing a fresh copy…' });
    return { ...(await installLatest(send)), repaired: true };
  }

  send('progress', { phase: 'verify', message: 'Checking installed OWGP files…' });
  const problems = await verifyInstalledFiles(manifest);
  if (installed.version === manifest.version && problems.length === 0) {
    send('progress', { phase: 'complete', message: 'All OWGP game files are healthy.', percent: 100 });
    return { success: true, version: manifest.version, repaired: false };
  }

  const message = problems.length
    ? `Found ${problems.length} missing or modified file(s). Reinstalling the verified game…`
    : `OWGP ${manifest.version} is available. Updating the game…`;
  send('progress', { phase: 'repair', message });
  return { ...(await installLatest(send)), repaired: true };
}

async function getExecutablePath() {
  const raw = await fsp.readFile(localManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  return resolveInside(gameDir, manifest.entryPoint);
}

module.exports = { checkStatus, installLatest, repair, getExecutablePath, gameDir };
