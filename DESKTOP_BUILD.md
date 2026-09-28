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
