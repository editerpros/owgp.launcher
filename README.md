# Open Wheel Grand Prix (OWGP) Launcher

A Windows x64 Electron launcher for Open Wheel Grand Prix. The launcher downloads the game from GitHub Releases, validates the ZIP and installed files with SHA-256, installs updates safely, repairs damaged installations, and checks for separate launcher updates.

## Branding

- `src/renderer/assets/game-logo.jpg` — supplied OWGP logo
- `src/renderer/assets/racing-banner.webp` — supplied racing hero image
- `build/icon.ico` — Windows application and installer icon generated from the supplied logo

## GitHub repositories

### Game distribution

- Repository: `Imagine-Cloud-Service/owgp-source`
- Latest stable release must contain:
  - `OWGP-win-x64.zip`
  - `game-manifest.json`

The ZIP must contain the complete packaged game at its root, including the executable and all runtime resources. The manifest must contain the archive SHA-256 and a `files` map of SHA-256 checksums for every file Repair should verify.

Generate these two release assets with the supplied `Generate-OWGP-Release.ps1` script. Example:

```powershell
.\Generate-OWGP-Release.ps1 `
  -BuildDirectory ".\dist\win-unpacked" `
  -Version "1.0.0" `
  -EntryPoint "OWGP.exe"
```

Change `-BuildDirectory` and `-EntryPoint` to match your real Electron game build output. The script creates `OWGP-Release/OWGP-win-x64.zip` and `OWGP-Release/game-manifest.json`; upload both to the same stable GitHub Release in `owgp-source`.

### Launcher self-updates

The launcher's own updates use a separate public repository configured in:

- `src/config.js`
- `package.json` under `build.publish`

The current configuration expects `Imagine-Cloud-Service/owgp-launcher`. Create this repository before publishing launcher updates. Do not point this updater at `owgp-source`, because game and launcher versions/releases are independent.

When the launcher repository exists, push a tag such as:

```powershell
git tag launcher-v1.0.1
git push origin launcher-v1.0.1
```

GitHub Actions builds the Windows x64 NSIS installer and publishes the update metadata used by `electron-updater`.

## Requirements

- Windows 10/11 x64 for the installed launcher and game
- Node.js 22 or later for development/building
- A public game repository and at least one stable game release for cloud installation

## Run during development

```powershell
npm ci
npm start
```

## Build the Windows installer locally

On Windows with Node.js 22 or later, run PowerShell in this folder:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Build-OWGP-Launcher.ps1
```

The script installs dependencies, runs the tests, and builds `release/OWGP-Launcher-Setup-1.0.1.exe`. You can also run `npm run dist` after `npm install`.

## Publish launcher updates

After creating `Imagine-Cloud-Service/owgp-launcher` and pushing this project to it:

```powershell
git tag launcher-v1.0.1
git push origin launcher-v1.0.1
```

GitHub Actions will run tests, build the NSIS installer, and publish release assets. The built launcher then checks this repository for launcher updates on startup.

## Installation and repair behavior

- Game files are installed under Electron's per-user application data directory in `OpenWheelGrandPrix`.
- The archive is downloaded over HTTPS and checked against the manifest's SHA-256.
- Every file listed in `manifest.files` is verified after extraction.
- New game files are staged first; the existing installation is backed up during the directory swap and restored if the swap fails.
- Repair checks the latest release's file hashes and reinstalls the latest verified version if files are missing, modified, or outdated.
- An already installed game remains launchable when GitHub is temporarily unavailable.
- Game updates are managed by this launcher; launcher updates are managed independently by `electron-updater`.

## Security notes

- Only public GitHub repositories are supported. Never put a personal access token in the distributed launcher.
- SHA-256 detects corruption and mismatched files. It does not protect against a compromised repository account because the manifest and ZIP are published together. Signed releases are a stronger future improvement.
- Review the exact game executable name/path in the manifest before publishing.

## GitHub Actions build artifact

After pushing this project to the `main` branch of the launcher repository, the `Build OWGP Launcher (Windows)` workflow runs tests and creates the setup EXE. Download it from the successful Actions run under **Artifacts**. The artifact is retained for 14 days. The separate `Build and publish OWGP Launcher` workflow publishes permanent launcher releases when a `launcher-v*` tag is pushed.

## v1.0.1 IPC install hotfix

- Installation and repair IPC handlers now catch errors and always return a plain serializable response.
- Download progress events are throttled to avoid flooding Electron IPC during large downloads.
- Installation errors are written to the launcher log at `%APPDATA%\owgp-launcher\logs\launcher.log` (the exact folder depends on Electron's userData path).
- The UI displays the underlying install error instead of the opaque IPC reply failure when the handler can report it.
