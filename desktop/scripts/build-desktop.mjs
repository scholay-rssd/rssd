import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installedMacOSBundle, resolveSigningIdentity, verifyMacOSBundle } from "./macos-signing.mjs";
const require = createRequire(import.meta.url);
const bundles = process.platform === "win32" ? "nsis" : process.platform === "darwin" ? "app" : "deb,appimage";
const identity = process.platform === "darwin" ? resolveSigningIdentity() : null;
const keyFile = process.env.SCHOLAY_UPDATER_KEY_FILE || join(homedir(), "Library/Application Support/Scholay Today Maintenance/updates/today.key");
const signingEnv = !process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile) ? { TAURI_SIGNING_PRIVATE_KEY: keyFile, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" } : {};
const updaterSigningKey = process.env.TAURI_SIGNING_PRIVATE_KEY || signingEnv.TAURI_SIGNING_PRIVATE_KEY;
if (identity) console.log(`Signing RSSD with ${identity.name}`);
// --no-sign disables updater signatures too, even on hosts that do not use
// macOS code signing. Preserve signed updates whenever a key is configured.
const result = spawnSync(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), "build", "--bundles", bundles, "--ci", ...(identity || updaterSigningKey ? [] : ["--no-sign"]), "--", "--locked"], {
  stdio: "inherit",
  env: { ...process.env, ...signingEnv, ...(identity ? { APPLE_SIGNING_IDENTITY: identity.hash } : {}) },
});
if (result.error) throw result.error;
if (result.status === 0 && identity) verifyMacOSBundle("target/release/bundle/macos/RSSD.app", installedMacOSBundle());
process.exit(result.status ?? 1);
