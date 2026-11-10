import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('site deployment checks the overlay pin before packaging any code', () => {
  const script = read('scripts/deploy-site.sh');
  const gate = script.indexOf('if [[ -f deploy/drift.mjs ]]; then node deploy/drift.mjs; fi');
  assert.ok(gate > script.indexOf('SCHOLAY_DEPLOY_PREPARED'), 'prepared packages are not rebuilt locally');
  assert.ok(gate > 0 && gate < script.indexOf('mktemp -d /tmp/scholay-site-package'));
});

test('desktop release checks the overlay pin before backups and builds, and records the result', () => {
  const script = read('scripts/install-desktop-macos.sh');
  const gate = script.indexOf('if node deploy/drift.mjs; then');
  assert.ok(gate > 0 && gate < script.indexOf('mkdir -p "$backup"') && gate < script.indexOf('npm run desktop:test'));
  assert.match(script, /RSSD_ALLOW_UNPINNED:-\}" == 1/);
  assert.match(script, /'publicPin':/);
});
