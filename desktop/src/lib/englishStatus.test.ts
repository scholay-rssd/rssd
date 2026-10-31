import {describe,expect,it} from 'vitest';
import {duplicateRecordOf,englishStatus,type WebsiteReceipt} from '../publications/websitePublishing';

const live=(flow?:WebsiteReceipt['publishingFlow'],cloud?:WebsiteReceipt['publishingFlow']):WebsiteReceipt=>({requestKey:'request-key-0001',publicReadback:true,...(flow?{publishingFlow:flow}:{}),...(cloud?{asyncQueue:{continuationOwner:'cloud',continuation:cloud}}:{})});

describe('English status line',()=>{
  it('stays hidden until the Chinese page is read back',()=>{
    expect(englishStatus(null)).toBeNull();
    expect(englishStatus({requestKey:'request-key-0001',publicReadback:false})).toBeNull();
  });
  it('reports each stage of the English edition without touching the Chinese result',()=>{
    expect(englishStatus(live({status:'disabled'}))).toMatchObject({label:'英文未启用',tone:'off'});
    expect(englishStatus(live())).toMatchObject({tone:'off'});
    // A live Chinese news page without an English handoff is a gap, not a setting.
    expect(englishStatus({...live({status:'disabled'}),url:'/news/x/'})).toMatchObject({label:'缺少英文版',tone:'warn'});
    expect(englishStatus({...live(),url:'/news/x/'})).toMatchObject({label:'缺少英文版',tone:'warn'});
    expect(englishStatus({...live({status:'disabled'}),url:'/calendar/x/'})).toMatchObject({label:'英文未启用',tone:'off'});
    expect(englishStatus(live(undefined,{status:'queued'}))).toMatchObject({label:'英文处理中',tone:'busy'});
    expect(englishStatus(live(undefined,{status:'translation_review',translation:{status:'ready'}}))).toMatchObject({label:'英文待审核'});
    expect(englishStatus(live(undefined,{status:'waiting',translation:{status:'failed'}}))).toMatchObject({label:'英文需要处理',tone:'warn'});
    expect(englishStatus(live({status:'deferred'}))).toMatchObject({label:'英文交接待重试',tone:'warn'});
    expect(englishStatus(live(undefined,{status:'complete',english:{status:'verified',url:'https://metho.scholay.com/en/news/x/'}}))).toEqual({label:'英文已上线',tone:'ok',url:'https://metho.scholay.com/en/news/x/'});
  });
  it('prefers the cloud continuation over an older local record',()=>{
    expect(englishStatus(live({status:'deferred'},{status:'complete',english:{status:'verified'}}))?.label).toBe('英文已上线');
  });
});

describe('duplicate-link record',()=>{
  const id='record-91e52c25-5d3b-4911-9b24-769157a52079';
  it('comes from a rejected receipt or the producer message',()=>{
    expect(duplicateRecordOf({requestKey:'request-key-0001',duplicateOf:id})).toBe(id);
    expect(duplicateRecordOf(null,'Error: 该资源链接已有记录「MARKUS」（'+id+'）。请取回该记录再更新，不要新建。')).toBe(id);
  });
  it('ignores unrelated errors and malformed references',()=>{
    expect(duplicateRecordOf(null,'推送未完成：（'+id+'）')).toBeNull();
    expect(duplicateRecordOf({requestKey:'request-key-0001',duplicateOf:'record-x'})).toBeNull();
  });
});
