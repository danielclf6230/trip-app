import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

export default function AppVersion() {
  const native = isTauri();
  const [version, setVersion] = useState(native ? "" : import.meta.env.VITE_APP_VERSION);
  useEffect(() => {
    if (!native) return;
    let active = true;
    getVersion().then(value => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("unavailable"); });
    return () => { active = false; };
  }, [native]);
  return <div className="app-version" aria-label={native ? "Installed app version" : "Web build version"}>
    {native ? "Version" : "Web version"} {version || "…"}
  </div>;
}
