import { access, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const signingFile = join(homedir(), "Library/Application Support/Trip Tools/signing/android-signing.json");

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: frontend, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)));
  });
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Use android:build:release on Windows; this command is for macOS.");
  let settings;
  try {
    const info = await stat(signingFile);
    if (info.mode & 0o077) throw new Error("permissions");
    settings = JSON.parse(await readFile(signingFile, "utf8"));
  } catch {
    throw new Error(`Set up the private signing file at ${signingFile} and restrict it with chmod 600. See ANDROID_GUIDE.md. No unsigned or debug build was created.`);
  }
  for (const field of ["keystorePath", "keyAlias", "keystorePassword", "keyPassword"]) {
    if (typeof settings[field] !== "string" || !settings[field].trim()) throw new Error(`Fill ${field} in the private signing file. Do not paste passwords into chat.`);
  }
  const keystore = settings.keystorePath.replace(/^~(?=\/)/, homedir());
  await access(keystore);
  const javaHome = process.env.JAVA_HOME || "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
  const androidHome = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
  const ndkHome = process.env.NDK_HOME || join(androidHome, "ndk/30.0.16248370");
  const buildTools = join(androidHome, "build-tools/37.0.0");
  await Promise.all([access(join(javaHome, "bin/java")), access(ndkHome), access(join(buildTools, "apksigner"))]);
  const env = {
    ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome, NDK_HOME: ndkHome,
    PATH: `${javaHome}/bin:${androidHome}/platform-tools:${process.env.PATH || ""}`,
    TRIP_TOOLS_ANDROID_KEYSTORE: keystore,
    TRIP_TOOLS_ANDROID_KEYSTORE_PASSWORD: settings.keystorePassword,
    TRIP_TOOLS_ANDROID_KEY_ALIAS: settings.keyAlias,
    TRIP_TOOLS_ANDROID_KEY_PASSWORD: settings.keyPassword,
  };
  await run(join(frontend, "node_modules/.bin/tauri"), ["android", "build", "--apk", "--target", "aarch64", "--ci"], env);
  const output = join(frontend, "src-tauri/gen/android/app/build/outputs/apk/universal/release");
  const apks = (await readdir(output)).filter(name => name.endsWith(".apk") && !name.endsWith("-unsigned.apk"));
  if (apks.length !== 1) throw new Error("Expected one release-signed APK. Do not distribute an unsigned APK.");
  const apk = join(output, apks[0]);
  // Only report success after Android's signing verifier accepts the APK.
  await run(join(buildTools, "apksigner"), ["verify", "--verbose", apk], env);
  console.log(`Release-signed APK: ${apk}`);
  console.log(`Open the output folder: ${dirname(apk)}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
