// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {activateSpaceStorage,consumeSpaceReaderEntry} from './spaceStorage';
beforeEach(()=>localStorage.clear());
it('preserves legacy tabs and reader preferences while round-tripping independent spaces',()=>{
  localStorage.setItem('reader.tabs','academic-original');
  activateSpaceStorage(localStorage,'lingxi');
  expect(localStorage.getItem('reader.tabs')).toBeNull();
  localStorage.setItem('reader.tabs','input-method-only');
  activateSpaceStorage(localStorage,'pets');
  expect(localStorage.getItem('reader.tabs')).toBeNull();
  activateSpaceStorage(localStorage,'academic');
  expect(localStorage.getItem('reader.tabs')).toBe('academic-original');
  activateSpaceStorage(localStorage,'lingxi');
  expect(localStorage.getItem('reader.tabs')).toBe('input-method-only');
});
it('rejects corrupted snapshots before clearing the active workspace',()=>{
  localStorage.setItem('reader.tabs','keep-me');
  localStorage.setItem('scholay.space-storage.pets','{"scholay.space-storage.active":"pets"}');
  expect(()=>activateSpaceStorage(localStorage,'pets')).toThrow();
  expect(localStorage.getItem('reader.tabs')).toBe('keep-me');
});

it('a logo entry opens RSS in the target space without replacing its saved reading tabs',()=>{
 localStorage.setItem('scholay.space-storage.pets',JSON.stringify({'papr.workspace.v2':'library','reader.tabs':'pet-tabs'}));
 localStorage.setItem('scholay.space-storage.open-rss','pets');
 activateSpaceStorage(localStorage,'pets');expect(consumeSpaceReaderEntry(localStorage,'pets')).toBe(true);
 expect(localStorage.getItem('papr.workspace.v2')).toBe('rss');expect(localStorage.getItem('reader.tabs')).toBe('pet-tabs');
 expect(localStorage.getItem('scholay.space-storage.open-rss')).toBeNull();
});
