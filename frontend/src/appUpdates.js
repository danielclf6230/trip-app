export function findAndroidUpdate(currentVersion, release) {
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error("Invalid Android release version.");
  }
  const url = new URL(release.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid Android download URL.");
  }
  const current = currentVersion.split(".").map(Number);
  const latest = release.version.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (latest[index] > current[index]) return release;
    if (latest[index] < current[index]) return null;
  }
  return null;
}
