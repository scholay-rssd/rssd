import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tauri 2.11.1 patches this marker for NSIS and then restores the build output:
// https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.1/crates/tauri-bundler/src/bundle.rs
// This CI build has no Authenticode certificate. Its installed payload must
// match the fresh build exactly except for this single, known bundle marker.
export function nsisExecutableSha256(input) {
  const bytes = Buffer.from(input);
  const marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
  const offset = bytes.indexOf(marker);
  if (offset < 0 || bytes.indexOf(marker, offset + marker.length) !== -1) {
    throw Error('Expected exactly one unpatched Tauri bundle marker');
  }
  Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS').copy(bytes, offset);
  return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output || process.argv.length !== 4) {
    throw Error('Usage: windows-installer-payload.mjs <built-executable> <expected-hash-file>');
  }
  await writeFile(output, nsisExecutableSha256(await readFile(source)) + '\n');
}
