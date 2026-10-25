# Android — build on this Mac

## Update all my apps together

Copy and paste this into the chat after finishing your code changes:

```text
Release my updates for Android, Mac, Windows, and iPhone together from this Mac. Use one shared version, reusing it if already prepared for this release. Use my existing signing keys. Build and verify the Android APK and Apple Silicon Mac installer, upload their update files to S3, and prepare their update manifests. Build and install the iPhone app on my connected phone using my existing Personal Team; keep its bundle identifier and local data. Fix errors and tell me what to push, where the installers are, and which updates are actually live. If a phone, credential, or service is unavailable, finish the independent work and report what is blocked. Run the configured Windows GitHub Actions workflow for that same version, wait for its result, and verify its live update entry. Include the Windows installer link in the report. Do not replace signing keys or claim success without checking.
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
