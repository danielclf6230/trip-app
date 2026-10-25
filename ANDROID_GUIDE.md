# Android APK — simple guide

Build on **this Mac**. Windows builds remain possible with your older Windows script.

## Copy this into the Codex chat

```text
Follow ANDROID_GUIDE.md to build the Android release APK only. If this is a new release, increase the patch version in tauri.conf.json and Cargo.toml; if the version was already prepared for this release, reuse it. Keep Cargo.lock consistent. Use the existing release signing key and application ID. Run the checks, fix build errors, and give me the exact APK location. If S3 upload and Render access are configured, upload the APK and publish its Android update manifest; otherwise tell me what is missing. Do not build a debug APK, replace signing keys, or claim the update is live before verifying it.
```

## Build it yourself

1. Get the latest project changes on this Mac.
2. For a **new release**, increase the version in these two files to the same number, for example `1.0.5` → `1.0.6`:
   - `frontend/src-tauri/tauri.conf.json`
   - `frontend/src-tauri/Cargo.toml`

   If that version was already prepared for this release, keep it. The build updates the app entry in `Cargo.lock`.

3. Open **Terminal** and run:

   ```bash
   source ~/.zprofile
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   npm run android:build:release:mac
   ```

4. After the build succeeds, open the APK folder:

   ```bash
   open ./src-tauri/gen/android/app/build/outputs/apk/universal/release
   ```

5. Open the release APK on the phone and approve installation. Keep the same app ID and signing key; do not uninstall the existing app first.

## One-time signing setup on this Mac

1. Securely copy the **original** `trip-tools-release.jks` from your Windows computer's `Documents\TripApp-signing\android` folder into:

   ```text
   /Users/daniel/Library/Application Support/Trip Tools/signing/
   ```

2. Open the private configuration file locally:

   ```bash
   open -a "Visual Studio Code" "$HOME/Library/Application Support/Trip Tools/signing/android-signing.json"
   ```

3. Fill in the original key alias, keystore password, and key password. Keep the configured path pointing to the copied keystore. The Windows encrypted credential XML cannot be used directly on the Mac. Do not paste passwords into chat or Git. Do not create a replacement keystore.

The Mac build command stops if these signing details are missing and verifies the finished APK's signature before reporting success.

## One-time AWS and Render setup

This setup also serves Windows and Mac updates.

1. In AWS Console, open **IAM → Users → the identity used by Render → Permissions**. Add this statement to its existing IAM policy; keep the existing photo permissions:

   ```json
   {
     "Effect": "Allow",
     "Action": "s3:GetObject",
     "Resource": "arn:aws:s3:::trip-tools-daniel-2026/releases/*"
   }
   ```

2. In **S3 → trip-tools-daniel-2026**, keep **Block all public access** enabled. Upload installers into version folders under `releases/`. Your upload account also needs permission to upload there.
3. In Render, open your backend service → **Environment**. Keep its AWS credentials configured, with `AWS_REGION=us-east-2` and `S3_BUCKET=trip-tools-daniel-2026`. Never copy these credentials into the frontend or chat.
4. Push the backend changes to GitHub. In Render → **Events/Deploys**, wait for the latest commit to be live. If automatic deployment is disabled, choose **Manual Deploy → Deploy latest commit**.

## Let users use the update button

Building alone does not publish an update. After the setup above:

1. Upload the new release APK to the private bucket `trip-tools-daniel-2026` as `releases/VERSION/Trip-Tools.apk`, replacing `VERSION` with the app version.
2. From the same Terminal window, run:

   ```bash
   release_version=$(node -p "require('./src-tauri/tauri.conf.json').version")
   npm run desktop:update:manifest -- --platform android --s3-key "releases/$release_version/Trip-Tools.apk" --notes "App improvements"
   ```

3. Commit/push the version files, `Cargo.lock`, and `backend/android-update.json`. Wait for Render to deploy. The updated backend code must also have been deployed once.
4. Users reopen their older updater-enabled app. **Update available** appears when the check finds the newer release. They download the APK, open it, and approve installation. Android may ask them to allow installs from that browser.

Check `https://tools-backend-v3um.onrender.com/desktop-updates/android.json`: HTTP 200 with the new version and a download URL means the manifest is available; HTTP 204 means no published release; HTTP 503 means the manifest, S3 file, credentials, or permission needs checking. Test the actual download and installation too.

If their installed app has no updater, send one updater-enabled APK manually first. The APK does not have the iPhone free-signing seven-day expiration.
