import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { nsisExecutableSha256 } from '../scripts/windows-installer-payload.mjs';

test('installer verification allows only the Tauri NSIS marker change and preserves the input', () => {
  const original = Buffer.from('MZ\0header\0__TAURI_BUNDLE_TYPE_VAR_UNK\0payload\xff', 'latin1');
  const before = Buffer.from(original);
  const installed = Buffer.from('MZ\0header\0__TAURI_BUNDLE_TYPE_VAR_NSS\0payload\xff', 'latin1');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(nsisExecutableSha256(original), hash(installed));
  assert.deepEqual(original, before);
  installed[installed.length - 1] ^= 1;
  assert.notEqual(nsisExecutableSha256(original), hash(installed));
});

test('unexpected, already patched, or ambiguous builds fail closed', () => {
  for (const contents of ['', '__TAURI_BUNDLE_TYPE_VAR_NSS', '__TAURI_BUNDLE_TYPE_VAR_UNK__TAURI_BUNDLE_TYPE_VAR_UNK']) {
    assert.throws(() => nsisExecutableSha256(Buffer.from(contents)), /exactly one unpatched/);
  }
});
