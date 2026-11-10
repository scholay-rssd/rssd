import test from "node:test";
import assert from "node:assert/strict";
import { signingIdentities, selectSigningIdentity, signatureDetails, verifyRequirement } from "../desktop/scripts/macos-signing.mjs";

const first = { hash: "A".repeat(40), name: "Developer ID Application: Example (TEAMONE)", team: "TEAMONE" };
const second = { hash: "B".repeat(40), name: "Developer ID Application: Other (TEAMTWO)", team: "TEAMTWO" };

test("release identity discovery excludes development, revoked and ad-hoc identities", () => {
  const output = `  1) ${first.hash} "${first.name}"\n  2) ${second.hash} "Apple Development: Other (TEAMTWO)"\n  3) ${second.hash} "${second.name}" (CSSMERR_TP_CERT_EXPIRED)\n     1 valid identities found\n`;
  assert.deepEqual(signingIdentities(output), [first]);
});

test("release identity stays on the installed app's team", () => {
  assert.deepEqual(selectSigningIdentity([first, second], "", "TEAMONE"), first);
  assert.throws(() => selectSigningIdentity([first, second], second.name, "TEAMONE"), /differs/);
  assert.throws(() => selectSigningIdentity([second], "", "TEAMONE"), /No matching/);
});

test("missing and ambiguous release identities never silently change signing identity", () => {
  assert.throws(() => selectSigningIdentity([]), /No matching/);
  assert.throws(() => selectSigningIdentity([first, second]), /Multiple/);
  assert.throws(() => selectSigningIdentity([first], "-"), /No matching/);
  assert.throws(() => selectSigningIdentity([first], "Example"), /No matching/);
});

test("explicit certificate hash resolves renewals with duplicate names", () => {
  const renewal = { ...first, hash: "C".repeat(40) };
  assert.throws(() => selectSigningIdentity([first, renewal], first.name, first.team), /Multiple/);
  assert.deepEqual(selectSigningIdentity([first, renewal], renewal.hash.toLowerCase(), first.team), renewal);
});

test("macOS verifies inline identity requirements and rejects a different identity", { skip: process.platform !== "darwin" }, () => {
  const binary = "/usr/bin/true";
  const signature = signatureDetails(binary);
  assert.ok(signature.designatedRequirement);
  assert.doesNotThrow(() => verifyRequirement(binary, signature.designatedRequirement));
  assert.throws(() => verifyRequirement(binary, 'identifier "invalid.today.test"'));
});
