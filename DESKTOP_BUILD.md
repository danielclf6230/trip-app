# Trip Tools desktop build

The desktop application uses Tauri 2 around the existing React/Vite frontend. The Express API remains hosted on Render and continues to access the existing AWS MySQL database. Database credentials stay on the backend and are never packaged in the Windows application.

## One-time Windows setup

1. Install Node.js 22.12 or newer.
2. Install Rust with `rustup` and select the stable MSVC toolchain.
3. Install Visual Studio Build Tools 2022 with **Desktop development with C++**.
4. Ensure Microsoft Edge WebView2 Runtime is installed. It is normally included with current Windows releases.

Verify the tools:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## Install dependencies

```powershell
cd C:\Users\daniel.chow\Documents\TripApp\frontend
npm install
```

## Run in desktop development mode

Start the existing Express backend in one terminal:

```powershell
cd C:\Users\daniel.chow\Documents\TripApp\backend
npm install
npm start
```

Start the desktop application in another terminal:

```powershell
cd C:\Users\daniel.chow\Documents\TripApp\frontend
npm run desktop:dev
```

Development mode uses `http://localhost:3000`. Release builds use `https://tools-backend-v3um.onrender.com`.

## Deploy the backend compatibility change

The backend CORS allowlist includes `http://tauri.localhost`, which is the origin used by a Tauri 2 Windows release. Commit and push `backend/server.js` to the branch connected to Render, then wait for the Render deployment to finish.

Confirm it with this preflight request:

```powershell
$headers = @{
  Origin = 'http://tauri.localhost'
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'authorization,content-type'
}
Invoke-WebRequest -Uri 'https://tools-backend-v3um.onrender.com/api/auth/login' -Method Options -Headers $headers
```

The response must include `Access-Control-Allow-Origin: http://tauri.localhost`.

## Build the installer

Desktop builds now create signed updater artifacts. Set `TAURI_SIGNING_PRIVATE_KEY` as described in the update section below before building.

```powershell
cd C:\Users\daniel.chow\Documents\TripApp\frontend
npm run desktop:build
```

The NSIS setup executable is produced under:

```text
frontend\src-tauri\target\release\bundle\nsis\
```

Install that executable on a test Windows account, log in, load a trip, save a harmless test edit, log out, and log back in before distributing it.

## Release checklist

- Render `/health` returns HTTP 200 with database status true.
- The desktop-origin CORS preflight succeeds.
- Login, registration by invitation, password changes, trip loading, saves, invitations, and administration behave as they do on the website.
- No `.env` file or database password exists under `frontend`, `dist`, or the installer bundle.
- Replace the unsigned installer with a code-signed build before wider distribution.


## In-app updates for Windows and macOS

The header's **Updates** button checks the Render backend, asks before installing, downloads a signed update, and restarts the desktop app. It is also available on the login screen. Website and iPhone builds do not show this control. The first installer containing this feature must be installed manually once.

The updater signing key was generated on this Mac at `~/.tauri/trip-tools.key`; the public key is in `tauri.windows.conf.json` and `tauri.macos.conf.json`. Back up the private key securely, and copy it securely to your Windows build machine. Keep it out of Git. This key is separate from Windows code signing, Apple signing, and the Android keystore. Losing it prevents existing installations from accepting future updates signed with a new key.

### Build a desktop release

1. Increase the version in `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` together. Version 1.0.4 introduces this feature.
2. Set the signing environment variables in the terminal used to build. The generated key has no password; protect the file and its backups.

Windows PowerShell (replace the key path with your secure copy):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = 'C:\secure\trip-tools.key'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run desktop:build
```

macOS Terminal:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/trip-tools.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
npm run desktop:build
```

Windows produces an NSIS `.exe` and `.exe.sig`; macOS produces `.app.tar.gz` and `.app.tar.gz.sig`, plus a DMG for first installs. Build Windows on Windows and macOS on macOS. A macOS release distributed to other users should be signed with Developer ID and notarized; the updater signature does not replace Apple's signing/notarization requirements.

### Publish an update

1. Upload the Windows `.exe` or macOS `.app.tar.gz` to a permanent HTTPS download location accessible to app users. Use versioned filenames. A private GitHub repository's download URL will not work without authentication; do not embed GitHub tokens in the application. An expiring S3 URL is also unsuitable for a permanent release.
2. From `frontend`, generate the manifest using the matching artifact's `.sig` file:

```bash
npm run desktop:update:manifest -- --platform windows-x86_64 --url https://YOUR-DOWNLOAD-HOST/Trip-Tools-1.0.5-setup.exe --signature path/to/installer.exe.sig --notes "Describe the changes"
```

Use `darwin-aarch64` for Apple Silicon Macs or `darwin-x86_64` for Intel Macs. Run the command for each platform at the same version to combine entries. When the version changes, previous platform entries are cleared so an old installer is never advertised as a new version. Platforms without a release receive no update.

3. Commit and deploy `backend/desktop-updates.json` and the backend route to Render. Until a release is published, the manifest is `null` and the endpoint returns HTTP 204 (no release).
4. Test from an older installed app: click **Updates**, confirm installation, verify the new version starts, and check login and trip data. Test canceling, offline behavior, and a failed signature as well. Test macOS and Windows separately on actual devices before distributing.

No release files are uploaded or deployed automatically by these scripts. Future updates still require you to build, upload, and deploy the release manifest, but users do not need you to send another installer individually.
