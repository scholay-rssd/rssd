// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import WorkListRow,{fittingTagCount,workDisplayDate} from '../editorial/WorkListRow';
import type {Work} from '../editorial/contentLibrary';
const work:Work={id:'history',title:'足够长的完整标题：跨年度申请与历史事件',category:'昔日学术',locations:['cloud'],status:'public',external:[],date:'2026-10-03',cloud:{dateLabel:'1998 年 11 月 20 日'} as Work['cloud']};
it('uses event dates rather than cloud modification dates, preserves full ranges and handles leap dates',()=>{
  expect(workDisplayDate(work)).toEqual({short:'11-20',full:'1998 年 11 月 20 日'});
  expect(workDisplayDate({...work,cloud:{dateLabel:'2025-12-30 — 2026-01-02'} as Work['cloud']})).toEqual({short:'12-30',full:'2025-12-30 — 2026-01-02'});
  expect(workDisplayDate({...work,cloud:undefined,date:'2024-02-29T23:00:00Z'}).short).toBe('02-29');
  expect(workDisplayDate({...work,cloud:undefined,date:''})).toEqual({short:'—',full:'日期未提供'});
});
it('displays local manuscript metadata before path batch dates and retains legacy fallback',()=>{
  const local={id:'local',shortTitle:'本地稿',canonicalPath:'articles/annex/学术开源/正文.md',batchDate:'2026-09-01',stage:'local' as const,receipt:null,preparedAt:null,metadata:{date:'2026-10-06'}};
  expect(workDisplayDate({...work,local})).toEqual({short:'10-06',full:'2026-10-06'});
  expect(workDisplayDate({...work,local:{...local,metadata:undefined}})).toEqual({short:'09-01',full:'2026-09-01'});
  expect(workDisplayDate({...work,local:{...local,batchDate:null,metadata:{date:' '}}})).toEqual({short:'11-20',full:'1998 年 11 月 20 日'});
});
it('reserves the overflow counter, always retains the first tag, and reveals more on resize',()=>{
  expect(fittingTagCount([50,30,18],78,20)).toBe(1);
  expect(fittingTagCount([50,30,18],108,20)).toBe(3);
  expect(fittingTagCount([50,30,18,30],108,20)).toBe(2);
  expect(fittingTagCount([50,30],20,20)).toBe(1);
});
it('exposes the full title, date and hidden labels immediately on focus, and Escape dismisses it',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(createElement(WorkListRow,{work,selected:false,disabled:false,onSelect:()=>{}})));
    const row=host.querySelector('button')!;
    await act(async()=>row.focus());const tip=document.querySelector('[role=tooltip]')!;
    for(const text of [work.title,'1998 年 11 月 20 日','昔日学术','已公开','云端'])expect(tip.textContent).toContain(text);
    await act(async()=>row.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(document.querySelector('[role=tooltip]')).toBeNull();
  }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
