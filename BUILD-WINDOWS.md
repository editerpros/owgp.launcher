# Build OWGP Launcher on Windows

1. Install Node.js 22 or later from https://nodejs.org/.
2. Extract this project to a writable folder.
3. Open PowerShell in the extracted `OWGP-Launcher-Starter` folder.
4. Run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Build-OWGP-Launcher.ps1
```

The script installs dependencies, runs the automated tests, and builds the Windows x64 NSIS setup file. The output will be in `release/` as `OWGP-Launcher-Setup-1.0.0.exe`.

The installer can open and show the launcher UI before the game release is published. For the Download and Repair buttons to work, publish `OWGP-win-x64.zip` and a real `game-manifest.json` as assets in a stable release of `Imagine-Cloud-Service/owgp-source`.

To enable launcher self-updates, create the separate public repository `Imagine-Cloud-Service/owgp-launcher`, push this project to it, and publish a `launcher-v1.0.0` tag using the included GitHub Actions workflow.
