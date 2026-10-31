import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function signingIdentities(output) {
  return [...output.matchAll(/^\s*\d+\) ([A-F0-9]{40}) "(Developer ID Application: [^"\n]+ \(([A-Z0-9]+)\))"\s*$/gm)]
    .map(([, hash, name, team]) => ({ hash, name, team }));
}

export function selectSigningIdentity(identities, requested = "", previousTeam = "") {
  const matches = identities.filter(identity => requested
    ? identity.hash === requested.toUpperCase() || identity.name === requested
    : !previousTeam || identity.team === previousTeam);
  if (matches.length !== 1) {
    throw Error(matches.length
      ? "Multiple Developer ID Application identities match. Set APPLE_SIGNING_IDENTITY to the intended certificate name or SHA-1."
      : "No matching Developer ID Application identity. Install the existing signing certificate and private key; this release will not fall back to ad-hoc signing.");
  }
  if (previousTeam && matches[0].team !== previousTeam) {
    throw Error("The signing team differs from the installed Today app. Keep the existing team to preserve Keychain authorizations.");
  }
  return matches[0];
}

export function signatureDetails(bundle) {
  // codesign writes its display output to stderr, including successful calls.
  const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", "--requirements", "-", bundle], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw Error(`Cannot inspect code signature for ${bundle}: ${result.error?.message || result.stderr}`);
  const output = result.stdout + result.stderr;
  return {
    identifier: output.match(/^Identifier=(.+)$/m)?.[1],
    team: output.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1],
    authority: output.match(/^Authority=(.+)$/m)?.[1],
    designatedRequirement: output.match(/^designated => (.+)$/m)?.[1],
    adHoc: /^Signature=adhoc$/m.test(output),
  };
}

export function installedMacOSBundle() {
  return ["/Applications/RSSD.app", "/Applications/today.app", "/Applications/scholay today.app"].find(existsSync) || "/Applications/RSSD.app";
}

export function resolveSigningIdentity(previous = installedMacOSBundle()) {
  const prior = existsSync(previous) ? signatureDetails(previous) : null;
  const previousTeam = prior?.authority?.startsWith("Developer ID Application:") ? prior.team : "";
  return selectSigningIdentity(signingIdentities(run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"])), process.env.APPLE_SIGNING_IDENTITY?.trim(), previousTeam);
}

export function verifyRequirement(bundle, requirement) {
  // An inline requirement must start with '='; otherwise codesign treats it as
  // a filename and rejects the next upgrade even when its identity is unchanged.
  run("/usr/bin/codesign", ["--verify", "--strict", "-R", `=${requirement}`, bundle]);
}

export function verifyMacOSBundle(bundle, previous) {
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  const signature = signatureDetails(bundle);
  if (signature.identifier !== "com.thomas.papr" || !signature.team || signature.adHoc || !signature.authority?.startsWith("Developer ID Application:") || !signature.designatedRequirement || /\bcdhash\b/.test(signature.designatedRequirement)) {
    throw Error("Today requires a stable Developer ID signature with identifier com.thomas.papr.");
  }
  if (previous && existsSync(previous)) {
    const prior = signatureDetails(previous);
    // The first signed release replaces an old linker ad-hoc signature. Later
    // releases must satisfy the installed app's identity, which Keychain stores.
    if (prior.authority?.startsWith("Developer ID Application:")) {
      if (!prior.designatedRequirement) throw Error("The installed app has no designated requirement.");
      verifyRequirement(bundle, prior.designatedRequirement);
    }
  }
  return signature;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "verify" || !process.argv[3]) throw Error("Usage: macos-signing.mjs verify <bundle> [previous-bundle]");
  console.log(JSON.stringify(verifyMacOSBundle(process.argv[3], process.argv[4]), null, 2));
}
