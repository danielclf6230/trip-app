# Windows — build on your Windows PC

## Ask Codex to do it

Open the project in Codex on Windows, then paste:

```text
Release the next Windows update using WINDOWS_GUIDE.md. Update the version (reuse it if already prepared), build with my existing updater signing key, upload to S3, prepare the Windows update manifest, and verify the result. Tell me what to push and give me the setup EXE. Preserve same-version Mac entries. If tools or access are missing, say what is blocked. Do not replace signing keys.
```

## Do it yourself

### Set up a new Windows build PC

Install Node.js 22.12 or newer, then run these commands in PowerShell:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --accept-package-agreements --accept-source-agreements --silent --override '--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
winget install --id Rustlang.Rustup --exact --source winget --accept-package-agreements --accept-source-agreements --silent --override '-y --default-host x86_64-pc-windows-msvc --profile minimal'
```

Open a new PowerShell window after installation so `cargo` is on PATH. WebView2 must also be installed; it is already present on the personal build PC.

Keep the Windows updater private key at `$HOME\.tauri\trip-tools.key` and make a secure backup outside the repository. On another build PC, transfer this same key rather than generating another one. The `.pub` file alone cannot sign releases.

Windows version **1.0.5** uses a replacement updater key created on the personal build PC. Existing Windows installations signed with the previous key must run this version's setup EXE manually once before receiving future automatic updates. The Mac updater key is separate and remains unchanged.

### Build the installer

1. Get the latest project changes. For a new release, increase the version in `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` to the same number. Reuse it if already prepared.
2. Open PowerShell in your project's **`frontend`** folder:

   ```powershell
   npm ci
   $env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $HOME '.tauri\trip-tools.key'
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
   npm run desktop:build
   explorer.exe .\src-tauri\target\release\bundle\nsis
   ```

3. Run the new **setup EXE** to update the app. The command requires the Windows updater key matching `frontend/src-tauri/tauri.windows.conf.json` at `$HOME\.tauri\trip-tools.key` and the Windows build tools installed.

<details>
<summary>Publish it so users see “Update available”</summary>

From the same PowerShell, with AWS CLI and your `trip-tools-release` profile available:

```powershell
$releaseVersion = (Get-Content .\src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$installer = Get-ChildItem .\src-tauri\target\release\bundle\nsis\*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
aws s3 cp $installer.FullName "s3://trip-tools-daniel-2026/releases/$releaseVersion/Trip-Tools-setup.exe" --profile trip-tools-release --region us-east-2
npm run desktop:update:manifest -- --platform windows-x86_64 --s3-key "releases/$releaseVersion/Trip-Tools-setup.exe" --signature "$($installer.FullName).sig" --notes "App improvements"
```

Commit/push the version files, `Cargo.lock`, and `backend/desktop-updates.json`. Wait for Render to show **Live**. Older updater-enabled x64 Windows apps can then offer the update.

</details>
