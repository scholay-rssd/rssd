// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const {call}=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('../editorial/taskWorkbench',()=>({taskCall:call}));
import NotebookBrandPanel from '../editorial/NotebookBrandPanel';
it('shared catalog stays optional and selected tailnotes retain their exact version and text',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const brand={id:'shared',version:2,name:'恩特学术',description:'https://enterscholar.com',voice:'',endnotes:[{id:'footer',label:'同步发表',text:'信息同步发表于[恩特学术](https://enterscholar.com)，智能时代的学者社区'}]};
 call.mockResolvedValue([brand]);let note:any={mounts:{templates:[],brands:[]},blocks:[]};
 const host=document.createElement('div'),root=createRoot(host);
 function Harness(){const [n,setN]=useState(note);return createElement(NotebookBrandPanel,{note:n,disabled:false,onChange:v=>{note=v;setN(v);}});}
 try{
  await act(async()=>root.render(createElement(Harness)));expect(call).toHaveBeenCalledWith('notebook_brands');expect(note.blocks).toEqual([]);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(note.mounts.brands).toEqual([brand]);expect(note.blocks).toEqual([]);
  await act(async()=>host.querySelector<HTMLInputElement>('.notebook-endnote-options input')!.click());
  expect(note.blocks).toHaveLength(1);expect(note.blocks[0]).toMatchObject({text:brand.endnotes[0].text,locked:true,preset:{brandId:'shared',id:'footer',version:2}});
  expect(host.querySelector<HTMLInputElement>('.notebook-endnote-options input')!.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
