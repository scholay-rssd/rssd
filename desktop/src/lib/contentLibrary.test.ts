import {describe,it,expect} from 'vitest';
import {collectWorks,matchesWork,tagCount,EMPTY_FILTERS,localDraftDate,workSummary,workActions,websiteCategory,type Filters} from '../editorial/contentLibrary';
import {EMPTY,type Snapshot,type WebsiteItem,type Publication} from '../publications/model';
import type {WebsiteDraft} from '../publications/websitePublishing';
const local:WebsiteDraft={id:'same-work',shortTitle:'本地可编辑标题',canonicalPath:'articles/annex/新闻聚合/正文.md',batchDate:null,stage:'local',receipt:null,preparedAt:null};
const cloud:WebsiteItem={key:'news:same-work',articleId:'same-work',kind:'news',title:'官网标题',summary:'摘要',category:'学界犀闻',dateLabel:'2026-10-02',url:'https://example.org/a',detailPage:true,lastmod:null,version:2,publishedVersion:1,sourceUrls:[]};
const external:Publication={id:'feishu-1',taskId:'one',sourceId:'legacy-alias',title:'完全不同的平台标题',platform:'微信公众号',status:'已发布',url:'https://example.org/work'};
const snapshot:Snapshot={...EMPTY,website:{items:[cloud],updatedAt:'2026-10-02'},feishu:{configured:true,updatedAt:null,records:[external]},drafts:[{id:'same-work',title:'作品',sourceIds:['legacy-alias']}]};
it('shows stable section names and calendar projections without rewriting legacy manuscripts',()=>{
 const drafts=[{...local,id:'new',sectionId:'collaboration',archiveCategory:'学者观察'},{...local,id:'year',recordKind:'year',type:'calendar',archiveCategory:'学术情报'},{...local,id:'history',recordKind:'history',type:'history',sectionId:'observations',archiveCategory:'学者观察'},{...local,id:'history-essay',type:'history',sectionId:'observations',archiveCategory:'学者观察'}];
 const before=JSON.stringify(drafts),works=collectWorks(drafts,EMPTY);
 expect(works.find(w=>w.id==='new')?.category).toBe('项目合作');
 expect(works.find(w=>w.id==='year')?.category).toBe('今日学术');
 expect(works.find(w=>w.id==='history')?.category).toBe('学者观察');
 expect(works.find(w=>w.id==='history-essay')?.category).toBe('学者观察');
 expect(websiteCategory({...cloud,kind:'history',sectionId:'observations'})).toBe('学者观察');
 expect(websiteCategory({...cloud,kind:'year',sectionId:'calendar'})).toBe('今日学术');
 expect(websiteCategory({...cloud,sectionId:'courses'})).toBe('课程资源');
 expect(JSON.stringify(drafts)).toBe(before);
});
describe('unified works and grouped tags',()=>{
  it('merges stable identities across local and cloud, attaching third-party records without title matching',()=>{const works=collectWorks([local],snapshot);expect(works).toHaveLength(1);expect(works[0].locations).toEqual(['local','cloud']);expect(works[0].external).toEqual([external]);expect(works[0].status).toBe('public');expect(works[0].title).toBe(local.shortTitle);
    const unrelated={...external,id:'other',sourceId:'',title:local.shortTitle};const merged=collectWorks([local],{...snapshot,feishu:{...snapshot.feishu,records:[external,unrelated]}});expect(merged).toHaveLength(1);expect(merged[0].external).toEqual([external]);});
  it('combines location alternatives with OR and cloud publication/category with AND',()=>{
    const works=collectWorks([local,{...local,id:'local-only',archiveCategory:'学术开源'}],{...snapshot,website:{...snapshot.website,items:[cloud,{...cloud,key:'news:private',articleId:'unpublished',publishedVersion:null,category:'学术开源'}]}});
    const filters:Filters={...EMPTY_FILTERS,status:['public'],location:['local','cloud'],category:['学界犀闻']};
    expect(works.filter(x=>matchesWork(x,filters)).map(x=>x.id)).toEqual(['same-work']);
    expect(tagCount(works,filters,'status','unpublished')).toBe(0);
    expect(tagCount(works,{...EMPTY_FILTERS},'status','unpublished')).toBe(1);
    expect(works.filter(x=>matchesWork(x,{...EMPTY_FILTERS,status:['public','unpublished']}))).toHaveLength(2);
    expect(works.filter(x=>matchesWork(x,{...EMPTY_FILTERS,status:['unpublished'],location:['local']}))).toHaveLength(0);
  });
  it('external publication cannot override unpublished cloud state',()=>{const work=collectWorks([local],{...snapshot,website:{...snapshot.website,items:[{...cloud,publishedVersion:null}]}})[0];expect(work.status).toBe('unpublished');expect(work.locations).toEqual(['local','cloud']);expect(work.external).toHaveLength(1);expect(workActions(work)).toMatchObject({local:true,canPublish:true,canWithdraw:false,externalReadOnly:true});});
  it('an unpublished cloud revision can be explicitly published while the older version is public',()=>{const work=collectWorks([],snapshot)[0];expect(workActions(work)).toMatchObject({canPublish:true,canWithdraw:true});});
  it('ledger records never create works of their own: unlinked or unmatched records stay out of the library',()=>{
    const unlinked:Publication={...external,id:'unlinked',sourceId:''},orphan:Publication={...external,id:'orphan',sourceId:'no-such-work'};
    expect(collectWorks([],{...EMPTY,feishu:snapshot.feishu})).toEqual([]);
    const works=collectWorks([local],{...snapshot,feishu:{...snapshot.feishu,records:[external,unlinked,orphan]}});expect(works).toHaveLength(1);expect(works[0].external.map(r=>r.id)).toEqual(['feishu-1']);
  });
  it('a work with only third-party records attached still gets no operations from them',()=>{const work=collectWorks([local],snapshot)[0];expect(workActions({...work,local:undefined,cloud:undefined})).toEqual({local:false,cloud:false,canPublish:false,canWithdraw:false,externalReadOnly:true});});
  it('retains explicit alias links after deleting the local draft',()=>{const work=collectWorks([],{...snapshot,drafts:[],bindings:snapshot.drafts});expect(work).toHaveLength(1);expect(work[0].locations).toEqual(['cloud']);expect(work[0].external).toEqual([external]);});
  it('local receipts never substitute for the cloud publication snapshot',()=>{const works=collectWorks([{...local,receipt:{requestKey:'old',publicReadback:true,checkedAt:'2026-10-01'}}],{...EMPTY,website:{items:[],updatedAt:'2026-10-02',scope:'all'}});expect(works[0].status).toBeNull();});
  it('uses manuscript metadata for local dates and searchable summaries without changing archive categories',()=>{
    const draft={...local,batchDate:'2026-09-01',archiveCategory:'学术开源',metadata:{date:'2026-10-06',summary:'记录可追溯的参数与实验条件',author:'Scholay 编辑部',category:'学者观察'}};
    const work=collectWorks([draft],EMPTY)[0];
    expect(work.date).toBe('2026-10-06');expect(work.category).toBe('学术开源');expect(work.status).toBeNull();
    expect(workSummary(work)).toBe(draft.metadata.summary);
    expect(matchesWork(work,{...EMPTY_FILTERS,query:'可追溯的参数'})).toBe(true);
    expect(matchesWork(work,{...EMPTY_FILTERS,query:'不存在的摘要'})).toBe(false);
  });
  it('prefers local metadata over a linked cloud summary and falls back for missing or blank legacy metadata',()=>{
    const enriched=collectWorks([{...local,metadata:{date:'2026-10-06',summary:'本地新摘要'}}],{...snapshot,website:{...snapshot.website,items:[{...cloud,summary:'云端旧内容要点'}]}})[0];
    expect(enriched.date).toBe('2026-10-06');expect(workSummary(enriched)).toBe('本地新摘要');
    expect(matchesWork(enriched,{...EMPTY_FILTERS,query:'本地新摘要'})).toBe(true);
    expect(matchesWork(enriched,{...EMPTY_FILTERS,query:'云端旧内容要点'})).toBe(false);
    const legacy=collectWorks([{...local,batchDate:'2026-10-01'}],snapshot)[0];
    expect(legacy.date).toBe('2026-10-01');expect(workSummary(legacy)).toBe(cloud.summary);
    expect(matchesWork(legacy,{...EMPTY_FILTERS,query:cloud.summary})).toBe(true);
    expect(localDraftDate({...local,batchDate:'2026-10-01',metadata:{date:'  '}})).toBe('2026-10-01');
    expect(workSummary({...legacy,local:{...local,metadata:{summary:'  '}}})).toBe(cloud.summary);
    expect(localDraftDate(local)).toBe('');expect(workSummary(collectWorks([local],EMPTY)[0])).toBe('');
  });
  it('preserves cloud-only ordering dates, summaries and categories',()=>{
    const item={...cloud,lastmod:'2026-10-05T23:20:00Z',dateLabel:'1998 年 11 月 20 日',category:'昔日学术'};
    const work=collectWorks([],{...EMPTY,website:{items:[item],updatedAt:null}})[0];
    expect(work.date).toBe(item.lastmod);expect(work.cloud?.dateLabel).toBe(item.dateLabel);expect(work.category).toBe('昔日学术');
    expect(workSummary(work)).toBe(item.summary);expect(matchesWork(work,{...EMPTY_FILTERS,query:item.summary})).toBe(true);
  });
});

it('distinguishes explicit withdrawal from a historic unpublished cloud draft',()=>{const works=collectWorks([],{...snapshot,website:{...snapshot.website,items:[{...cloud,publishedVersion:null,publicationState:'withdrawn'},{...cloud,key:'news:old',articleId:'old',publishedVersion:null}]}});expect(works.find(w=>w.id==='same-work')?.status).toBe('withdrawn');expect(works.find(w=>w.id==='old')?.status).toBe('unpublished');});

describe('type and use are separate',()=>{
  const draft=(id:string,over:Partial<WebsiteDraft>):WebsiteDraft=>({...local,id,shortTitle:id,...over});
  it('takes the recorded task type first and otherwise the type whose posts the column receives',()=>{
    const works=collectWorks([draft('moved',{type:'observation',archiveCategory:'学界犀闻'}),draft('old',{archiveCategory:'学术开源'}),draft('by-path',{}),draft('unknown-type',{type:'rss',archiveCategory:'昔日学术'})],EMPTY);
    const of=(id:string)=>works.find(w=>w.id===id)!;
    expect([of('moved').type,of('moved').category]).toEqual(['observation','学界犀闻']);
    expect([of('old').type,of('old').category]).toEqual(['opensource','学术开源']);
    expect([of('by-path').type,of('by-path').category]).toEqual(['xiwen','学界犀闻']);
    expect(of('unknown-type').type).toBe('history');
    expect(collectWorks([],snapshot)[0].type).toBe('xiwen');
  });
  it('filters and counts by type independently of the column the work is used in',()=>{
    const works=collectWorks([draft('a',{type:'observation',archiveCategory:'学界犀闻'}),draft('b',{type:'observation',archiveCategory:'学者观察'}),draft('c',{type:'xiwen',archiveCategory:'学界犀闻'})],EMPTY);
    expect(tagCount(works,EMPTY_FILTERS,'type','observation')).toBe(2);expect(tagCount(works,EMPTY_FILTERS,'category','学界犀闻')).toBe(2);
    const reports:Filters={...EMPTY_FILTERS,type:['observation']};
    expect(works.filter(w=>matchesWork(w,reports)).map(w=>w.id).sort()).toEqual(['a','b']);
    expect(tagCount(works,reports,'category','学界犀闻')).toBe(1);expect(tagCount(works,reports,'type','xiwen')).toBe(1);
    expect(works.filter(w=>matchesWork(w,{...reports,category:['学界犀闻']})).map(w=>w.id)).toEqual(['a']);
  });
});


it('recovers previous notebook skills by completed stable identity without mutating manuscripts',()=>{
 const draft={...local,type:'observation',archiveCategory:'学者观察'};
 const before=JSON.stringify(draft);
 const tasks=[{articleId:draft.id,completedAt:'2026-10-13',workIds:[draft.id],notebook:{skills:['encyclopedia']}}];
 const w=collectWorks([draft],EMPTY,tasks)[0];
 expect(w.type).toBe('encyclopedia');expect(w.category).toBe('学者观察');expect(JSON.stringify(draft)).toBe(before);
 expect(collectWorks([draft],EMPTY,[{...tasks[0],articleId:'other'}])[0].type).toBe('observation');
 expect(collectWorks([draft],EMPTY,[{...tasks[0],completedAt:undefined}])[0].type).toBe('observation');
 expect(collectWorks([draft],EMPTY,[{...tasks[0],workIds:[]}])[0].type).toBe('observation');
});
it('uses saved mounted skills for all tags and filters, including multiple and no skills',()=>{
 const w=collectWorks([{...local,type:'observation',writingSkills:['documentation','design']}],EMPTY)[0];
 expect(w.types).toEqual(['documentation','design']);
 expect(matchesWork(w,{...EMPTY_FILTERS,type:['design']})).toBe(true);
 expect(matchesWork(w,{...EMPTY_FILTERS,type:['observation']})).toBe(false);
 expect(tagCount([w],EMPTY_FILTERS,'type','design')).toBe(1);
 const tasks=[{articleId:local.id,completedAt:'2026-10-13',workIds:[local.id],notebook:{skills:['encyclopedia']}}];
 expect(collectWorks([{...local,writingSkills:[]}],EMPTY,tasks)[0].types).toEqual(['unskilled']);
 expect(collectWorks([{...local,type:'encyclopedia'}],EMPTY)[0].type).toBe('encyclopedia');
});
