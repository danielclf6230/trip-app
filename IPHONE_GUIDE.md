# iPhone — install from this Mac

## Ask Codex to do it

Copy and paste into this chat; choose the reason in brackets:

```text
Help me install Trip Tools on my iPhone using IPHONE_GUIDE.md. This is [first installation / new app changes / expired signing]. Use my free Personal Team and existing bundle identifier. Prepare the production build, fix errors, and guide me through Xcode's Run step. Install over the existing app. Do not increase the version just to renew expired signing or delete the installed app.
```

## First installation — once

1. In **Xcode → Settings → Accounts**, sign into your Apple Account.
2. Connect/unlock the iPhone, tap **Trust**, and let Xcode recognize it. On iPhone, enable **Settings → Privacy & Security → Developer Mode** and restart if asked.
3. In Terminal:

   ```bash
   cd /Users/daniel/Documents/trip-app/frontend
   npm ci
   npm run ios:init
   open ./src-tauri/gen/apple
   ```

4. Open the generated `.xcodeproj`. In the iOS target's **Signing & Capabilities**, enable **Automatically manage signing**, choose your **Personal Team**, and keep `com.danielchow.triptools` if accepted.
5. Run the update commands below, select your iPhone in Xcode, and click **▶ Run**.

## After app changes

Connect/unlock your iPhone. In Terminal:

```bash
cd /Users/daniel/Documents/trip-app/frontend
npm ci
npm run tauri -- ios run --release --open
```

In Xcode, select your iPhone and click **▶ Run**. Keep the same team and bundle identifier; do not delete the old app first. Reuse the version already prepared for this release, or update both `tauri.conf.json` and `Cargo.toml` for a new release.

## When it expires

With a free Apple Account, signing expires after **7 days**. Repeat **After app changes** above to reinstall the current version. No version increase is needed for renewal. This iPhone setup has no in-app update/renewal button.
