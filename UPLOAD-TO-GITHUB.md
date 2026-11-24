# Publish the OWGP Launcher project to GitHub

Create a **new public repository** named `owgp-launcher` under `Imagine-Cloud-Service`. Do not use `owgp-source` for this project: that repository contains the game's own release stream.

Then open PowerShell inside the extracted launcher project folder and run:

```powershell
git init -b main
git add .
git commit -m "Initial OWGP Launcher"
git remote add origin https://github.com/Imagine-Cloud-Service/owgp-launcher.git
git push -u origin main
```

The push to `main` starts the Windows build workflow. When it completes successfully, open the repository's **Actions** tab, open the latest **Build OWGP Launcher (Windows)** run, and download the `OWGP-Launcher-Windows-x64` artifact. It contains the setup EXE.

To publish a permanent auto-update release after the build has been tested, create and push the matching version tag:

```powershell
git tag launcher-v1.0.0
git push origin launcher-v1.0.0
```

The release workflow publishes the installer and update metadata. Future launcher releases require increasing `version` in `package.json`, committing the change, and pushing a matching `launcher-vX.Y.Z` tag.

If you cannot create repositories under `Imagine-Cloud-Service`, create `owgp-launcher` under your own GitHub account instead, then change the `owner` and `repo` in both `src/config.js` and `package.json` (`build.publish`). Keep the repository public for anonymous launcher updates.
