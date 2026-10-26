const rememberedLoginKey = "trip-tools-remembered-login";

export function getUser() {
  for (const storage of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      const raw = storage?.getItem("user");
      if (raw) return JSON.parse(raw);
    } catch { /* Try the other storage if this one is unavailable. */ }
  }
  return null;
}

export function setUser(user, remember) {
  // Profile/avatar refreshes preserve the storage chosen at login.
  const persistent = remember ?? !globalThis.sessionStorage?.getItem("user");
  const destination = persistent ? localStorage : sessionStorage;
  const other = persistent ? sessionStorage : localStorage;
  destination.setItem("user", JSON.stringify(user));
  other.removeItem("user");
}

export function getRememberedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(rememberedLoginKey));
    return typeof saved?.name === "string" ? saved : { name: "", remember: false };
  } catch {
    return { name: "", remember: false };
  }
}

export function rememberLogin(name, remember) {
  if (remember) localStorage.setItem(rememberedLoginKey, JSON.stringify({ name, remember: true }));
  else localStorage.removeItem(rememberedLoginKey);
}

export function logout() {
  localStorage.removeItem("user");
  sessionStorage.removeItem("user");
}

export function isAuthed() {
  const token = getUser()?.token;
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return false;
  } catch { /* The API verifies token signatures; old sessions may use an opaque token. */ }
  return true;
}
