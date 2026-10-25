# Mac — build on this Mac

## Ask Codex to do it

Copy and paste into this chat:

```text
Release the next Mac update using MACOS_GUIDE.md. Update the version (reuse it if already prepared), build with my existing updater signing key, upload to S3, prepare the Mac update manifest, and verify the result. Tell me what to push and give me the DMG. Preserve same-version Windows entries. State any build, publishing, or Apple signing limitations. Do not replace signing keys.
```

## Do it yourself

1. For a new release, increase the version in `frontend/src-tauri/tauri.conf.json` and `frontend/src-tauri/Cargo.toml` to the same number. Skip this if that release's version is already prepared.
2. In Terminal:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/trip-tools.key"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
   npm run desktop:build
   open ./src-tauri/target/release/bundle/dmg
   ```

3. Open the **DMG**, quit the old app, and drag **Trip Tools** into **Applications** to replace it. This builds for your Apple Silicon Mac.

<details>
<summary>Publish it so users see “Update available”</summary>

From the same Terminal, with your `trip-tools-release` AWS profile signed in:

```bash
release_version=$(node -p "require('./src-tauri/tauri.conf.json').version")
aws s3 cp "./src-tauri/target/release/bundle/macos/Trip Tools.app.tar.gz" "s3://trip-tools-daniel-2026/releases/$release_version/Trip-Tools.app.tar.gz" --profile trip-tools-release --region us-east-2
npm run desktop:update:manifest -- --platform darwin-aarch64 --s3-key "releases/$release_version/Trip-Tools.app.tar.gz" --signature "./src-tauri/target/release/bundle/macos/Trip Tools.app.tar.gz.sig" --notes "App improvements"
```

Commit/push the version files, `Cargo.lock`, and `backend/desktop-updates.json`. Wait for Render to show **Live**. Older updater-enabled Apple Silicon Mac apps can then offer the update. Developer ID signing/notarization is separate from the updater signature.

</details>
