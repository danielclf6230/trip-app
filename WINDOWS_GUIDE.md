# Windows — build from this Mac using GitHub

## Ask Codex to do it

```text
Build and publish the Windows update using the configured windows-release.yml GitHub Actions workflow. Use the shared release version already prepared on main; do not increase it again. Preserve the existing Windows signing key and same-version Mac update entry. Wait for the build, S3 upload, manifest commit, and Render deployment. Verify the live Windows download, give me the installer, and report any failure accurately.
```

## Do it yourself

1. Finish your app changes. Prepare the same version in `tauri.conf.json`, `Cargo.toml`, and the app entry in `Cargo.lock`, then commit/push to `main`.
2. Open [GitHub → Actions → Build and publish Windows update](https://github.com/danielclf6230/trip-app/actions/workflows/windows-release.yml).
3. Click **Run workflow**, choose **main**, and enter that exact version, for example `1.0.7`.
4. Wait for success. The workflow builds the EXE on GitHub's Windows machine, uploads it to private S3, commits its update entry, and checks Render.
5. Download the EXE from the run's **Windows-installer-VERSION** artifact. For existing updater-enabled x64 Windows apps, reopen the app to check for the update.

No Windows PC is needed for future builds. The shared Mac entry is preserved when it uses the same release version. If the workflow fails, send Codex the run link; uploaded files alone do not mean the update is live.

<details>
<summary>One-time Actions secrets / recovery</summary>

Repository **Settings → Secrets and variables → Actions**:

- `WINDOWS_UPDATER_PRIVATE_KEY`: the original Windows updater private key matching Windows 1.0.5. This differs from the Mac key.
- `WINDOWS_UPDATER_KEY_PASSWORD`: only needed if that private key has a password; the current key uses an empty password.
- `RELEASE_AWS_ACCESS_KEY_ID` and `RELEASE_AWS_SECRET_ACCESS_KEY`: credentials allowed to upload/read `trip-tools-daniel-2026/releases/*`.

Keep secure backups of the original Windows key. Do not put keys or passwords in Git. The workflow uses its built-in GitHub token to commit the manifest; if branch protection blocks that push, the run fails rather than forcing an overwrite. Render must auto-deploy commits on main, or you must deploy its manifest commit manually.

The updater signature is separate from Windows publisher code signing. If an older installed app cannot show its confirmation/download controls, install the new EXE manually once to receive the corrected updater.

</details>
