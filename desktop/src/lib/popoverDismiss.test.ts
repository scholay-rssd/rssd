// @vitest-environment jsdom
import {act, createElement as h, Fragment} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import PopoverDetails from '../components/PopoverDetails';
import {hasBlockingOverlay} from './useBlockingOverlay';

let host: HTMLDivElement, root: Root;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const menus = () => [...host.querySelectorAll<HTMLDetailsElement>('details[data-transient-popover]')];
const open = async (index = 0) => { await act(async () => menus()[index].querySelector('summary')!.click()); await settle(); };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(h(Fragment, null,
    h(PopoverDetails, null, h('summary', null, '操作一'), h('div', null, h('input', {'aria-label':'菜单输入'}), h('button', null, '执行'), h('details', {open:true}, h('summary', null, '属性'), '保留信息'))),
    h(PopoverDetails, null, h('summary', null, '操作二'), h('div', null, '信息')),
    h('button', {onPointerDown:e => e.stopPropagation()}, '其他操作'),
    h('details', {className:'disclosure',open:true}, h('summary', null, '执行记录'), '保留展开'),
  )));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('dismisses outside on the first pointer press even when the target stops propagation', async () => {
  await open(); expect(menus()[0].open).toBe(true); expect(hasBlockingOverlay()).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>(':scope > button')!.dispatchEvent(new Event('pointerdown', {bubbles:true})));
  expect(menus()[0].open).toBe(false);
  expect(hasBlockingOverlay()).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('.disclosure')!.open).toBe(true);
});
it('keeps menu inputs and nested properties usable, closes after an action', async () => {
  await open();
  await act(async () => { const input = host.querySelector('input')!; input.dispatchEvent(new Event('pointerdown', {bubbles:true})); input.focus(); });
  expect(menus()[0].open).toBe(true);
  await act(async () => menus()[0].querySelector('button')!.click());
  expect(menus()[0].open).toBe(false);
});
it('Escape returns focus to the trigger; opening another menu closes its sibling', async () => {
  await open(); await open(1); expect(menus().map(m => m.open)).toEqual([false, true]);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'})));
  expect(menus()[1].open).toBe(false); expect(document.activeElement).toBe(menus()[1].querySelector('summary'));
});
it('Tab into another control closes the menu without moving focus back', async () => {
  await open();
  const outside = host.querySelector<HTMLButtonElement>(':scope > button')!;
  await act(async () => outside.focus());
  expect(menus()[0].open).toBe(false); expect(document.activeElement).toBe(outside);
});
