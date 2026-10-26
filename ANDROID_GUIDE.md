# Android — build on this Mac

## Update all my apps together

Copy and paste this into the chat after finishing your code changes:

```text
Release all my finished changes for Android, Mac, Windows, and iPhone. Do the complete release from this Mac, not just give instructions.

- Use one shared version. Continue an already prepared, unfinished release without bumping again. If these are new changes after a published release, increase the patch version once. Keep the JSON, TOML, Cargo.lock, and iPhone versions consistent.
- Run the checks and fix build errors. Keep the app identifiers and original Android, Mac, and Windows signing keys. Never replace keys or print passwords/private keys.
- Build and verify the release-signed Android APK and Apple Silicon Mac app/DMG. Run the configured Windows GitHub Actions workflow for the same version and wait for its result. Do not stop after starting the workflow.
- Upload verified release files to the existing private S3 bucket. Publish the correct update manifests, preserving same-version Windows and Mac entries. Never advertise an older installer as a newer version. Coordinate publishing so a Mac update does not remove the working Windows update entry.
- Commit and push the necessary app, version, and manifest changes using the existing GitHub access. Wait for Render and the web frontend deployments. Verify the live update endpoints and actual downloads for Windows, Mac, and Android before calling them live. Source pushes alone are not releases.
- Do not install Windows, Mac, or Android for me. Make their Update available button work in older updater-enabled apps after reopening. Build and install the iPhone update on my connected phone with my existing Personal Team, keeping its local data. iPhone has no in-app updater in this setup.
- Finish all independent work if a phone, key, account, or service is unavailable. Ask only for the specific missing information or device action needed. Never claim a build, upload, deployment, or installation succeeded without checking it.

Report each platform separately: version, build status, installer location/download link, update live or blocked, and device installation status. Include the Windows installer link. Tell me if anything still needs pushing or setup; otherwise say no further push is needed. Keep the report short.
```

## Ask Codex to do it

Copy and paste into this chat:

```text
Release the next Android update using ANDROID_GUIDE.md. Update the version (reuse it if already prepared), build with my existing signing key, upload to S3, prepare the update manifest, and verify the result. Tell me what to push and give me the APK. If access is missing, say exactly what is blocked. Do not replace signing keys.
```

## Do it yourself

1. For a new release, increase the version in `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` to the same number. Skip this if that release's version is already prepared.
2. In Terminal:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   npm run android:build:release:mac
   open ./src-tauri/gen/android/app/build/outputs/apk/universal/release
   ```

3. The installer is **`app-universal-release.apk`**. Open it on the phone to update the existing app.

<details>
<summary>Publish it so users see “Update available”</summary>

From the same Terminal, with your `trip-tools-release` AWS profile signed in:

```bash
release_version=$(node -p "require('./src-tauri/tauri.conf.json').version")
aws s3 cp "./src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk" "s3://trip-tools-daniel-2026/releases/$release_version/Trip-Tools.apk" --profile trip-tools-release --region us-east-2
npm run desktop:update:manifest -- --platform android --s3-key "releases/$release_version/Trip-Tools.apk" --notes "App improvements"
```

Commit/push the version files, `Cargo.lock`, and `backend/android-update.json`. Wait for Render to show **Live**. Users reopen the app, tap **Update available**, download the APK, and approve installation. Their installed app must already contain the updater.

</details>
