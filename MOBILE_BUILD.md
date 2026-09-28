# Trip Tools mobile builds

Trip Tools uses one React/Tauri codebase for Windows, Android, and iOS. All builds connect to:

`https://tools-backend-v3um.onrender.com`

The permanent application identifier is `com.danielchow.triptools` and the publisher is Daniel Chow.

## Android test installation

The current test APK supports ARM64 phones running Android 7.0 or newer:

`Trip-Tools-0.1.1-android-arm64-debug.apk`

1. Send the APK to the phone using Google Drive, email, USB, or another private file-sharing method.
2. Open the APK on the phone.
3. If Android blocks it, open the displayed Settings page and enable **Allow from this source** for the app that opened the file.
4. Return to the installer and tap **Install**.
5. Open **Trip Tools** and log in normally.

This is a debug-signed test application. A production Play Store release must use the release application ID and a permanent private signing key.

## Build another Android test APK

From `frontend`:

```powershell
npm run android:build:debug
```

The APK is generated under:

`src-tauri/gen/android/app/build/outputs/apk/universal/debug/`

Before distributing an update, increase the version in both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Android will update an existing installation only when the application ID and signing certificate remain the same and the version code increases.

## Recommended private Android distribution

Use Google Play internal or closed testing instead of repeatedly sending APK files:

1. Create a Google Play Console developer account.
2. Create Trip Tools with package ID `com.danielchow.triptools`.
3. Create and securely back up a permanent Android upload keystore. Never commit it or its password to Git.
4. Configure release signing and build an Android App Bundle:

   ```powershell
   npm run android:build:aab
   ```

5. In Play Console, create an internal or closed test and add the approved users' Google Account email addresses.
6. Upload the signed `.aab`, publish the test release, and send the opt-in link to those users.

Approved users install from Google Play and receive later updates through Google Play. The app is not searchable by ordinary users while it remains on an internal or closed test track.

## iPhone and iPad build

Apple requires the final iOS build and signing to run on a Mac with Xcode. Also required:

- An Apple Developer Program membership
- Xcode signed into that developer account
- Node.js, Rust, and CocoaPods on the Mac

On the Mac:

1. Clone or copy the TripApp repository.
2. Open Terminal in `frontend`.
3. Run:

   ```bash
   npm ci
   rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
   brew install cocoapods
   npm run ios:init
   npm run ios:build
   ```

4. Open the generated Xcode project, select Daniel Chow's Apple development team, and confirm the bundle identifier `com.danielchow.triptools`.
5. Archive the application in Xcode and upload it to App Store Connect.

## Unlisted App Store distribution

Trip Tools will use Apple's Unlisted App distribution:

1. Create the Trip Tools app record in App Store Connect.
2. Upload the signed iOS build from Xcode.
3. Complete the required app information, privacy details, screenshots, and review information.
4. State in the App Review notes that Trip Tools is intended for unlisted distribution.
5. Submit the app for App Review and submit Apple's unlisted-app request.
6. After approval, Apple provides a direct App Store link.
7. Send that link only to the intended users.

The application does not appear in App Store search, categories, charts, or recommendations. Anyone who receives the direct link can view the listing, so Trip Tools login remains the access-control layer.

## iPhone installation and updates

1. The user opens the private App Store link on their iPhone.
2. They tap **Get** and authenticate with Face ID, Touch ID, or their Apple Account password.
3. Trip Tools installs like a normal App Store application.

For later updates, increase the app version, build and upload a new iOS archive, and submit it for App Review. Users receive the update through the App Store; automatic updates work normally when enabled.

## Android updates

- Direct APK: send a newly signed APK with the same application ID/signing key and a higher version code. Opening it updates the installed application.
- Google Play internal/closed testing: upload a signed AAB with a higher version code. Approved testers receive the update through Google Play.

