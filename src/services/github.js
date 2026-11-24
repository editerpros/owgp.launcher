const config = require('../config');

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'OWGP-Launcher'
};

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: API_HEADERS,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error(`${label} timed out. Check your internet connection and try again.`);
    throw new Error(`${label} could not connect to GitHub. Check your internet connection.`);
  }

  if (response.status === 404) {
    throw new Error('No stable OWGP game release was found. Publish a release containing OWGP-win-x64.zip and game-manifest.json, then try again.');
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub rate limit reached. Wait a little and try again.');
  }
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`);

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function getLatestGameRelease() {
  const { owner, repo } = config.gameRepository;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
  const release = await fetchJson(url, 'GitHub game release check');

  if (release.draft || release.prerelease) {
    throw new Error('The latest game release is not a stable published release.');
  }

  const assets = new Map((release.assets || []).map(asset => [asset.name, asset.browser_download_url]));
  const manifestUrl = assets.get(config.gameAssets.manifest);
  const archiveUrl = assets.get(config.gameAssets.archive);
  if (!manifestUrl || !archiveUrl) {
    throw new Error(`GitHub release ${release.tag_name || ''} must contain ${config.gameAssets.manifest} and ${config.gameAssets.archive}.`);
  }

  const manifest = await fetchJson(manifestUrl, 'OWGP game manifest download');
  validateManifest(manifest);
  if (manifest.archive !== config.gameAssets.archive) {
    throw new Error(`The manifest archive must be named ${config.gameAssets.archive}.`);
  }

  return { release, manifest, manifestUrl, archiveUrl };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('The OWGP game manifest is invalid.');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error('Manifest version must look like 1.0.0.');
  }
  if (manifest.platform !== 'win32-x64') throw new Error('This release is not a Windows x64 game build.');
  if (typeof manifest.archive !== 'string' || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    throw new Error('Manifest must contain the archive filename and its 64-character SHA-256 hash.');
  }
  if (typeof manifest.entryPoint !== 'string' || !isSafeRelativePath(manifest.entryPoint) || !manifest.entryPoint.toLowerCase().endsWith('.exe')) {
    throw new Error('Manifest entryPoint must be a safe relative path to the game .exe.');
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || Object.keys(manifest.files).length === 0) {
    throw new Error('Manifest must contain a non-empty files map so Repair can verify the game.');
  }
  if (!Object.hasOwn(manifest.files, manifest.entryPoint)) {
    throw new Error('Manifest files must include the game executable listed in entryPoint.');
  }
  for (const [relativePath, digest] of Object.entries(manifest.files)) {
    if (!isSafeRelativePath(relativePath) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
      throw new Error(`Invalid file path or SHA-256 value in manifest: ${relativePath}`);
    }
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  const parts = value.split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
}

module.exports = { getLatestGameRelease, validateManifest, isSafeRelativePath };
