# iPhone — simple personal installation guide

Use your **Mac and a USB cable**. These steps install privately on your own iPhone using your free Apple Account; no App Store publishing is needed.

## Copy this into the Codex chat

```text
Follow IPHONE_GUIDE.md to help install Trip Tools on my own iPhone using Xcode and my free Personal Team. Check the Mac tools and whether iOS is already initialized. Prepare a production frontend build, open the Xcode project, and fix any build errors you can. Keep my existing Apple Account/team and bundle identifier com.danielchow.triptools. Guide me through the phone, signing, and Run steps that require my interaction. If I am updating the app, install over the existing copy. If only its seven-day signing expired, renew/reinstall the current version without increasing the app version. Do not delete my installed app, publish to the App Store, or claim installation succeeded before it is verified. If this is a new code release, keep the shared version consistent with the other platforms rather than bumping it again unnecessarily.
```

Tell me whether this is **first installation**, **new app changes**, or **expired signing** when you paste the request.

## First installation — do this once

1. Install/open **Xcode** from the Mac App Store. Accept its license and install the requested iOS components. In **Xcode → Settings → Accounts**, add your Apple Account.
2. Your Mac already uses Node.js and Rust for this project. In Terminal, install CocoaPods if missing and prepare iPhone build support:

   ```bash
   brew install cocoapods
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   rustup target add aarch64-apple-ios
   ```

   If a command fails, paste the error into the chat before continuing.

3. Connect your unlocked iPhone by cable. Tap **Trust** if asked. Let Xcode recognize the phone in **Window → Devices and Simulators** or **Device Hub**.
4. On iPhone, enable **Settings → Privacy & Security → Developer Mode**. Restart and confirm when asked. If the option is missing, first complete the Xcode connection in step 3. [Apple's instructions](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
5. In Terminal, run:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   npm run ios:init
   open ./src-tauri/gen/apple
   ```

   Run `ios:init` only for the first setup. Choose your **Personal Team** if asked. In the Finder folder that opens, double-click the generated `.xcodeproj`.

6. In Xcode, click the project, choose the **iOS app target**, and open **Signing & Capabilities**:
   - Enable **Automatically manage signing**.
   - Select your **Personal Team**.
   - Keep the bundle identifier `com.danielchow.triptools` if Apple accepts it. If unavailable, ask in chat before changing the identifier.

7. Back in Terminal, run:

   ```bash
   npm run tauri -- ios run --release --open
   ```

   This prepares the production frontend and opens Xcode. Select your physical **iPhone** at the top, then click **▶ Run**. Keep the phone unlocked and connected. [Tauri iOS command reference](https://v2.tauri.app/reference/cli/#ios-run)

8. Open **Trip Tools** on your iPhone. If it says **Untrusted Developer**, go to **Settings → General → VPN & Device Management** and trust your developer account. After installation, you can disconnect the Mac; the app needs internet to use its hosted backend.

## When you change the app

1. Get the latest code on the Mac. For a new release, use the same app version in `tauri.conf.json` and `Cargo.toml`; reuse it if another platform already prepared that release.
2. Connect and unlock your iPhone.
3. Run:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   npm run tauri -- ios run --release --open
   ```

4. In Xcode, select the same iPhone and **Personal Team**, then click **▶ Run**. Install over the existing app with the same bundle identifier. Do not delete it first; installing over it normally preserves local data.

## When it expires after seven days

With a free Personal Team, the provisioning profile expires after seven days and the app stops opening. The app stays installed. [Apple's free-account limits](https://developer.apple.com/help/account/basics/about-your-developer-account)

1. Connect the iPhone to your Mac.
2. Run the commands in **When you change the app** above, then click **▶ Run** in Xcode.
3. Keep the same Apple Account/team and bundle identifier. You do **not** need to increase the version just to renew signing.

There is no in-app update/renewal button for this free iPhone installation. New code and expired signing both require reinstalling through the Mac.
