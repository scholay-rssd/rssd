import {describe,expect,it} from 'vitest';
import {agentProgress} from '../editorial/executionRecords';
const t=(id:string,status:string,title='x')=>({id,role:'tool',text:'',turnId:'1',tool:{status,title}});
describe('agentProgress',()=>{
 it('is empty without history',()=>expect(agentProgress([],false)).toEqual({done:0,total:0,determinate:false,label:''}));
 it('uses the latest plan of the active run',()=>{
  const history=[{id:'u',role:'user',text:'r',turnId:'1'},{id:'p',role:'plan',text:'',turnId:'1',entries:[{content:'A',status:'completed'},{content:'B',status:'in_progress'},{content:'C',status:'pending'}]}];
  expect(agentProgress(history,true,'1')).toEqual({done:1,total:3,determinate:true,label:'B'});
 });
 it('falls back to counting finished tools and never reports a total',()=>{
  const history=[{id:'u',role:'user',text:'r',turnId:'1'},t('a','completed'),t('b','completed'),t('c','in_progress','保存')];
  expect(agentProgress(history,true,'1')).toEqual({done:2,total:0,determinate:false,label:'保存'});
 });
});
