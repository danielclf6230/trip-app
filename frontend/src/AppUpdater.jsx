import { useEffect, useId, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { findAndroidUpdate } from "./appUpdates.js";
import "./style/app-updater.css";

export default function AppUpdater({ canInstall = true }) {
  const [platform, setPlatform] = useState("unsupported");
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const statusId = useId();

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    invoke("app_update_platform")
      .then(value => { if (active) setPlatform(value); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function updateApp() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let update;
    let didInstall = installed;
    try {
      if (!canInstall) {
        setMessage("Wait for your trip changes to finish saving, then try again.");
        return;
      }
      if (installed) {
        await relaunch();
        return;
      }
      setMessage("Checking for updates…");
      if (platform === "android") {
        const response = await fetch("https://tools-backend-v3um.onrender.com/desktop-updates/android.json", {
          cache: "no-store", signal: AbortSignal.timeout(30000),
        });
        if (response.status === 204) {
          setMessage("You have the latest version.");
          return;
        }
        if (!response.ok) throw new Error(`Update check failed: ${response.status}`);
        const release = findAndroidUpdate(await getVersion(), await response.json());
        if (!release) {
          setMessage("You have the latest version.");
          return;
        }
        setMessage(`Version ${release.version} is available.`);
        if (window.confirm(`Download Trip Tools ${release.version}?\n\n${release.notes || "A new version is available."}\n\nYour browser will download the APK. Open it and approve installation to update the app.`)) {
          await openUrl(release.url);
          setMessage("Open the downloaded APK and tap Install to finish updating.");
        }
        return;
      }
      update = await check({ timeout: 30000 });
      if (!update) {
        setMessage("You have the latest version.");
        return;
      }
      setMessage(`Version ${update.version} is available.`);
      const accepted = window.confirm(
        `Install Trip Tools ${update.version}?\n\n${update.body || "A new version is available."}\n\nSave your changes before continuing. The app will close and restart during installation.`,
      );
      if (!accepted) return;
      let downloaded = 0;
      let total = 0;
      setMessage("Downloading update…");
      await update.downloadAndInstall(event => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setMessage(total
            ? `Downloading update… ${Math.min(100, Math.round(downloaded / total * 100))}%`
            : `Downloading update… ${(downloaded / 1048576).toFixed(1)} MB`);
        }
        if (event.event === "Finished") setMessage("Installing update…");
      });
      didInstall = true;
      setInstalled(true);
      setMessage("Update installed. Restarting…");
      await relaunch();
    } catch (error) {
      console.error("App update failed", error);
      setMessage(didInstall
        ? "Update installed. Close and reopen Trip Tools to finish."
        : "Could not update. Check your connection and try again. If it continues, contact Daniel.");
    } finally {
      if (update) await update.close().catch(() => {});
      running.current = false;
      setBusy(false);
    }
  }

  if (platform !== "desktop" && platform !== "android") return null;
  return (
    <div className="app-update-control">
      <button className="app-update-button" type="button" onClick={updateApp} disabled={busy}
        aria-label={installed ? "Restart to finish updating Trip Tools" : "Check for app updates"}
        aria-describedby={message ? statusId : undefined} aria-busy={busy} title="Check for app updates">
        <span className={`app-update-icon${busy ? " is-spinning" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
          </svg>
        </span>
        <span>{busy ? "Updating…" : installed ? "Restart app" : "Updates"}</span>
      </button>
      {message && <div className="app-update-feedback" id={statusId} role="status" aria-live="polite">
        <span className="app-update-feedback-label">APP UPDATES</span>
        <p>{message}</p>
        {!busy && <button type="button" className="app-update-dismiss" onClick={() => setMessage("")} aria-label="Dismiss update message">×</button>}
      </div>}
    </div>
  );
}
