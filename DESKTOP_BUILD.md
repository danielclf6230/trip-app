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

## Build a permanent Mac application

Build the Mac application on your Mac. Before the first build, install and open Xcode, accept its license, install its requested components, and install Node.js and Rust. If Terminal says the Xcode license has not been accepted, run `sudo xcodebuild -license` and follow the prompts before continuing.

1. For a new release, increase the version in both `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` to the same value, for example `1.0.5`. If you already increased it for this release, keep that version for the Windows and Android builds too.
2. Open **Terminal** and run:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/trip-tools.key"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
   npm run desktop:build
   ```

3. Wait for the build to finish successfully. The `release` folder is created by the build; pushing to GitHub does not create it.
4. Open the installer folder:

   ```bash
   open /Users/daniel/Documents/trip-app/frontend/src-tauri/target/release/bundle/dmg
   ```

5. Open the generated `.dmg`, then drag **Trip Tools** into **Applications**. Quit the existing app before replacing it.

The generated files are under these folders, relative to the project root:

| File | Folder | Purpose |
| --- | --- | --- |
| `.dmg` | `frontend/src-tauri/target/release/bundle/dmg/` | First installation or manual update |
| `Trip Tools.app` | `frontend/src-tauri/target/release/bundle/macos/` | Mac application |
| `.app.tar.gz` and `.app.tar.gz.sig` | `frontend/src-tauri/target/release/bundle/macos/` | Files used by the in-app updater |

Installer filenames include the version and architecture; use the files produced by this build. A normal build targets your Mac's architecture. Intel and Apple Silicon releases need matching builds. These paths assume the default command above, without a custom target/output directory.

The updater key must exist at `~/.tauri/trip-tools.key`. Keep using the original key and back it up securely. The updater signature is separate from Apple Developer ID signing and notarization; complete those for distribution to other Mac users.

## Build a permanent Windows application

Build the Windows application on your Windows computer, using the one-time Windows setup above.

Before the first updater-enabled Windows build, securely copy the **same desktop updater key** from the Mac's `~/.tauri/trip-tools.key` to `C:\Users\daniel.chow\.tauri\trip-tools.key` on Windows. Create the `.tauri` folder if necessary. Do not generate a different key or put the private key in the repository.

1. Get the latest project changes on your Windows machine before building. For a new release, increase the version in both `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` to the same value. Keep the same release version across platforms.
2. Open **PowerShell** and run:

   ```powershell
   cd C:\Users\daniel.chow\Documents\TripApp\frontend
   npm ci
   $env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $HOME '.tauri\trip-tools.key'
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
   npm run desktop:build
   ```

3. Wait for the build to finish successfully, then open the installer folder:

   ```powershell
   explorer.exe .\src-tauri\target\release\bundle\nsis
   ```

4. Open the generated setup `.exe` to install or update Trip Tools. Keep the same application identifier when building updates.

The generated installer and its matching `.exe.sig` updater signature are under:

```text
frontend\src-tauri\target\release\bundle\nsis\
```

Use the newly generated `.exe` for first installs/manual updates, and its matching `.exe.sig` when publishing an in-app update. Filenames include the release version and architecture.

Install the executable on a test Windows account, log in, load a trip, save a harmless test edit, log out, and log back in before distributing it. The updater signature is separate from Windows code signing.

Both sets of commands assume the original updater key has an empty password. If you protect the key with a password, set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to that password in your build terminal without committing it.

## Release checklist

- Render `/health` returns HTTP 200 with database status true.
- The desktop-origin CORS preflight succeeds.
- Login, registration by invitation, password changes, trip loading, saves, invitations, and administration behave as they do on the website.
- No `.env` file or database password exists under `frontend`, `dist`, or the installer bundle.
- Replace the unsigned installer with a code-signed build before wider distribution.


## In-app updates for Windows and macOS

The app checks the Render backend automatically on launch, every 15 minutes while visible, and when returning to the app or reconnecting (at most once per minute). The header's **Update available** button appears only after a newer release is found. It asks before installing, downloads a signed update, and restarts the desktop app. It also appears on the login screen when an update is available. If the app is current, no release is published, or a background check fails, the button stays hidden. Website and iPhone builds do not show this control. The first installer containing this feature must be installed manually once.

The updater signing key was generated on this Mac at `~/.tauri/trip-tools.key`; the public key is in `tauri.windows.conf.json` and `tauri.macos.conf.json`. Back up the private key securely, and copy it securely to your Windows build machine. Keep it out of Git. This key is separate from Windows code signing, Apple signing, and the Android keystore. Losing it prevents existing installations from accepting future updates signed with a new key.

### Build a desktop release

Follow **Build a permanent Mac application** or **Build a permanent Windows application** above. Those sections include the signing environment variables required in each new terminal session, the complete build commands, and the output locations.

Building creates the installer and updater files locally. To make a release available through the **Update available** button, also complete the publishing steps below. Users must manually install an updater-enabled version once before receiving later releases this way.

### Publish an update

1. Upload the Windows `.exe` or macOS `.app.tar.gz` to a permanent HTTPS download location accessible to app users. Use versioned filenames. A private GitHub repository's download URL will not work without authentication; do not embed GitHub tokens in the application. An expiring S3 URL is also unsuitable for a permanent release.
2. From `frontend`, generate the manifest using the matching artifact's `.sig` file:

```bash
npm run desktop:update:manifest -- --platform windows-x86_64 --url https://YOUR-DOWNLOAD-HOST/Trip-Tools-1.0.5-setup.exe --signature path/to/installer.exe.sig --notes "Describe the changes"
```

Use `darwin-aarch64` for Apple Silicon Macs or `darwin-x86_64` for Intel Macs. Run the command for each platform at the same version to combine entries. When the version changes, previous platform entries are cleared so an old installer is never advertised as a new version. Platforms without a release receive no update.

3. Commit and deploy `backend/desktop-updates.json` and the backend route to Render. Until a release is published, the manifest is `null` and the endpoint returns HTTP 204 (no release).
4. Test from an older installed app: click **Update available**, confirm installation, verify the new version starts, and check login and trip data. Test canceling, offline behavior, and a failed signature as well. Test macOS and Windows separately on actual devices before distributing.

No release files are uploaded or deployed automatically by these scripts. Future updates still require you to build, upload, and deploy the release manifest, but users do not need you to send another installer individually.
