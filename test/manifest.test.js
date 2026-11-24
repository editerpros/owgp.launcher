const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest, isSafeRelativePath } = require('../src/services/github');

const digest = 'a'.repeat(64);

function goodManifest() {
  return {
    version: '1.0.0',
    platform: 'win32-x64',
    archive: 'OWGP-win-x64.zip',
    sha256: digest,
    entryPoint: 'OWGP.exe',
    files: { 'OWGP.exe': digest }
  };
}

test('accepts a valid Windows x64 manifest', () => {
  assert.doesNotThrow(() => validateManifest(goodManifest()));
});

test('rejects an unsafe relative path', () => {
  assert.equal(isSafeRelativePath('../outside.exe'), false);
  assert.equal(isSafeRelativePath('folder/../outside.exe'), false);
  assert.equal(isSafeRelativePath('C:/outside.exe'), false);
  assert.equal(isSafeRelativePath('folder\\outside.exe'), false);
});

test('requires executable checksum in files map', () => {
  const manifest = goodManifest();
  manifest.files = { 'data.dat': digest };
  assert.throws(() => validateManifest(manifest), /must include the game executable/);
});

test('rejects invalid SHA-256 checksum', () => {
  const manifest = goodManifest();
  manifest.sha256 = 'not-a-hash';
  assert.throws(() => validateManifest(manifest), /SHA-256/);
});
