# Mac app — simple guide

Build this on your **Mac**. These steps use your existing Apple Silicon Mac setup.

## Copy this into the Codex chat

```text
Follow MACOS_GUIDE.md to build the Mac release only. If this is a new release, increase the patch version in tauri.conf.json and Cargo.toml; if the version was already prepared for this release, reuse it. Keep Cargo.lock consistent. Use the existing desktop updater signing key and application ID. Run the checks, fix build errors, and give me the exact DMG, app, updater archive, and signature locations. If S3 upload and Render access are configured, upload the archive and publish its Mac update entry; otherwise tell me what is missing. Preserve other platforms' entries for the same release. State which Mac architecture was built and whether Apple signing/notarization is configured. Never replace signing keys or claim the update is live before verifying it.
```

## One-time setup

- Install/open Xcode and accept its license. If prompted in Terminal, run `sudo xcodebuild -license` and follow the instructions.
- Node.js and Rust must be installed. Keep your existing updater key at `~/.tauri/trip-tools.key`.

## Build it yourself

1. Get the latest project changes on your Mac.
2. For a **new release**, increase the version in these two files to the same number, for example `1.0.5` → `1.0.6`:
   - `frontend/src-tauri/tauri.conf.json`
   - `frontend/src-tauri/Cargo.toml`

   If that version was already prepared for this release, keep it. The build updates the app entry in `Cargo.lock`.

3. Open **Terminal** and run:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/trip-tools.key"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
   npm run desktop:build
   ```

   These commands use the existing key's empty password. If you changed its password, use that password instead.

4. After the build succeeds, open the installer folder:

   ```bash
   open ./src-tauri/target/release/bundle/dmg
   ```

5. Open the `.dmg`, quit the old Trip Tools app, and drag the new **Trip Tools** into **Applications**, replacing the previous copy.

Files are created under `frontend/src-tauri/target/release/bundle/`:

- `dmg/`: the `.dmg` installer.
- `macos/`: `Trip Tools.app`, `Trip Tools.app.tar.gz`, and `Trip Tools.app.tar.gz.sig`.

This builds for your Mac's architecture. An Apple Silicon build does not provide a separate Intel build. The updater signature is separate from Apple's Developer ID signing/notarization; the latter needs its own setup for distribution to other users.

## Let users use the update button

Once the shared [AWS/Render setup](ANDROID_GUIDE.md#one-time-aws-and-render-setup) is complete:

1. Upload `Trip Tools.app.tar.gz` to `trip-tools-daniel-2026` as `releases/VERSION/Trip-Tools.app.tar.gz`, replacing `VERSION` with the app version. Upload the DMG too if you want a download for first installs.
2. From `frontend`, run:

   ```bash
   release_version=$(node -p "require('./src-tauri/tauri.conf.json').version")
   npm run desktop:update:manifest -- --platform darwin-aarch64 --s3-key "releases/$release_version/Trip-Tools.app.tar.gz" --signature "./src-tauri/target/release/bundle/macos/Trip Tools.app.tar.gz.sig" --notes "App improvements"
   ```

3. Commit/push the version files, `Cargo.lock`, and `backend/desktop-updates.json`. Wait for Render to deploy. The updated backend code must also have been deployed once.
4. Older updater-enabled Apple Silicon Mac apps show **Update available** after their automatic check. Users confirm installation and restart the app.

Users whose installation predates the updater need one manual installation first.
