# Windows app — simple guide

Build this on your **Windows computer**.

## Copy this into the Codex chat

```text
Follow WINDOWS_GUIDE.md to build the Windows release installer only. If this is a new release, increase the patch version in tauri.conf.json and Cargo.toml; if the version was already prepared for this release, reuse it. Keep Cargo.lock consistent. Use the existing desktop updater signing key and application ID. Run the checks, fix build errors, and give me the exact setup EXE location and matching updater signature. If S3 upload and Render access are configured, upload the installer and publish its Windows update entry; otherwise tell me what is missing. Preserve other platforms' entries for the same release. Never replace signing keys or claim the update is live before verifying it.
```

## One-time setup

- Install Node.js 22.12 or newer, Rust with the MSVC toolchain, and Visual Studio Build Tools with **Desktop development with C++**.
- Securely copy the existing desktop updater key from your Mac's `~/.tauri/trip-tools.key` to `C:\Users\daniel.chow\.tauri\trip-tools.key`. Do not generate a new key. Do not put it in Git.

## Build it yourself

1. Get the latest project changes on Windows.
2. For a **new release**, increase the version in these two files to the same number, for example `1.0.5` → `1.0.6`:
   - `frontend/src-tauri/tauri.conf.json`
   - `frontend/src-tauri/Cargo.toml`

   If that version was already prepared for this release, keep it. The build updates the app entry in `Cargo.lock`.

3. Open **PowerShell** and run:

   ```powershell
   cd C:\Users\daniel.chow\Documents\TripApp\frontend
   npm ci
   $env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $HOME '.tauri\trip-tools.key'
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
   npm run desktop:build
   ```

   These commands use the existing key's empty password. If you changed its password, use that password instead.

4. After the build succeeds, open the installer folder:

   ```powershell
   explorer.exe .\src-tauri\target\release\bundle\nsis
   ```

5. Run the new setup `.exe` to install or update Trip Tools. Keep its matching `.exe.sig` for publishing updates.

The output folder is `frontend/src-tauri/target/release/bundle/nsis/`. It appears after a successful build.

## Let users use the update button

Once the shared [AWS/Render setup](ANDROID_GUIDE.md#one-time-aws-and-render-setup) is complete:

1. Upload the setup EXE to `trip-tools-daniel-2026` as `releases/VERSION/Trip-Tools-setup.exe`, replacing `VERSION` with the app version.
2. Run the following from `frontend`. Replace `ACTUAL-INSTALLER.exe.sig` with the matching signature filename in the installer folder:

   ```powershell
   $releaseVersion = (Get-Content .\src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
   npm run desktop:update:manifest -- --platform windows-x86_64 --s3-key "releases/$releaseVersion/Trip-Tools-setup.exe" --signature ".\src-tauri\target\release\bundle\nsis\ACTUAL-INSTALLER.exe.sig" --notes "App improvements"
   ```

3. Commit/push the version files, `Cargo.lock`, and `backend/desktop-updates.json`. Wait for Render to deploy. The updated backend code must also have been deployed once.
4. Older updater-enabled Windows apps show **Update available** after their automatic check. Users confirm installation; the app closes during the update.

This example is for the usual x64 Windows build. Users whose installation predates the updater need one manual installation first. Updater signing and Windows publisher code signing are separate.
