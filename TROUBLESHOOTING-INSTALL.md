# OWGP Launcher install troubleshooting (v1.0.1)

This build hardens the `game:install` IPC handler so errors are returned to the UI as a serializable `{ success: false, error, logPath }` response. Download progress is throttled to avoid flooding Electron IPC during large downloads.

## If install still fails

1. Close OWGP Launcher completely.
2. Install the v1.0.1 launcher build.
3. Open OWGP Launcher and retry **Download Game** once.
4. Open the `launcher.log` path displayed in the error message. The usual Windows location is under `%APPDATA%\\owgp-launcher\\logs\\launcher.log`; use the exact path shown by the launcher if it differs.
5. Share the log contents to identify whether the failure happens during GitHub metadata lookup, archive download, SHA-256 verification, extraction, file verification, or the final directory swap.

## Check the game release

The public game release should contain both assets in the same stable release:

- `OWGP-win-x64.zip`
- `game-manifest.json`

The ZIP's archive SHA-256 in the manifest must match the ZIP that is uploaded. The `files` object should include a SHA-256 entry for every game file to be verified by Repair. Generate both release assets from the same complete unpacked build folder using `Generate-OWGP-Release.ps1`.

Do not change the game release version or replace its files until a mismatch is confirmed in `launcher.log`.
