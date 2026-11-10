import test from 'node:test';
import assert from 'node:assert/strict';
import {headlessArchiveName,headlessTarget} from '../scripts/build-headless.mjs';

test('headless packages cover Linux x64 and both macOS architectures',()=>{
  assert.equal(headlessTarget('linux','x64'),'linux-x64');
  assert.equal(headlessTarget('darwin','arm64'),'darwin-arm64');
  assert.equal(headlessTarget('darwin','x64'),'darwin-x64');
  assert.equal(headlessArchiveName('0.16.11','darwin','arm64'),'rssd-headless-0.16.11-darwin-arm64.tar.gz');
  assert.throws(()=>headlessTarget('linux','arm64'),/Linux x64, macOS arm64, or macOS x64/);
  assert.throws(()=>headlessTarget('win32','x64'),/Linux x64, macOS arm64, or macOS x64/);
});
