// Choosing a style is an editorial decision; applying literal labels is deterministic.
export const HEADING_MODES={numbered:'仅编号',fixed:'固定名称',source:'沿用来源',ai:'AI 拟题'};
export const protocolHeading=(n,b)=>n.kind!=='article'&&b.type==='heading'&&b.level===2;
export const editableHeading=(n,b)=>b.type==='heading'&&!b.locked&&!protocolHeading(n,b);
export function headingLabels(blocks){
 const labels={},stack=[];
 for(const b of blocks){
  if(b.type!=='heading')continue;
  const mode=b.heading?.mode;
  if(!b.locked&&['numbered','fixed'].includes(mode)&&b.state==='ready'){
   while(stack.length&&stack.at(-1).level>b.level)stack.pop();
   if(stack.at(-1)?.level===b.level)stack.at(-1).count++;else stack.push({level:b.level,count:1});
   const number=stack.map(x=>x.count).join('.');labels[b.id]=number+(mode==='fixed'?'. '+b.text:'');
  }else labels[b.id]=b.text;
 }
 return labels;
}
export function headingMode(n,b){return b.heading?.owner==='author'?b.heading.mode:n.headingPolicy?.mode&&n.headingPolicy.mode!=='auto'?n.headingPolicy.mode:n.headingPolicy?.selected||'ai';}
function sourceFor(n,b,id){
 const ids=b.sourceIds?.length?b.sourceIds:[];
 return n.sources.find(s=>s.id===(id||(ids.length===1?ids[0]:undefined)));
}
function applyOne(n,b,mode,{text,sourceId,owner='agent',strict=true}={}){
 let heading={...b.heading,mode,owner},value=b.text,ready=true;
 if(mode==='numbered')value='';
 else if(mode==='fixed'){value=heading.fixedText||'';if(!value.trim()){if(strict)throw Error('固定名称未设置：'+b.id);ready=false;}}
 else if(mode==='source'){
  const source=sourceFor(n,b,sourceId||heading.sourceId);
  if(!source?.title.trim()){if(strict)throw Error('请选择具有原标题的素材：'+b.id);value='';ready=false;}
  else {value=source.title;heading={...heading,sourceId:source.id,sourceTitle:source.title};}
 }else if(text!==undefined)value=text;
 else if(b.heading?.mode==='numbered')value='';
 if(mode==='ai'&&!value.trim())ready=false;
 return {...b,heading,text:value,state:ready?'ready':'placeholder'};
}
export function setHeadingPreference(n,mode){
 const next={...n,headingPolicy:{mode}};
 if(mode==='auto')return next;
 return {...next,blocks:n.blocks.map(b=>editableHeading(n,b)&&b.heading?.owner!=='author'?applyOne(next,mode==='fixed'?{...b,heading:{...b.heading,fixedText:b.heading?.fixedText||b.text}}:b,mode,{owner:'agent',strict:false}):b)};
}
export function setBlockHeadingPreference(n,id,mode){
 return {...n,blocks:n.blocks.map(b=>{
  if(b.id!==id||protocolHeading(n,b))return b;
  if(mode==='manual'){const {heading,...rest}=b;return {...rest,locked:true};}
  if(mode==='inherit'){const {mode:oldMode,owner,...heading}=b.heading||{};return {...b,locked:false,heading};}
  const prepared={...b,locked:false,heading:{...b.heading,...(mode==='fixed'?{fixedText:b.heading?.fixedText||b.text}:{})}};
  return applyOne(n,prepared,mode,{owner:'author',strict:false});
 })};
}
export function applyHeadingPlan(n,plan,scope){
 if(!Object.hasOwn(HEADING_MODES,plan.mode)||!Array.isArray(plan.entries)||!plan.entries.length)throw Error('标题方式或目标无效');
 const ids=new Set(plan.entries.map(e=>e.id)),targets=new Set(scope?.targetIds||[]);
 if(ids.size!==plan.entries.length)throw Error('标题行重复');
 const manualMode=n.headingPolicy?.mode;
 if(manualMode&&manualMode!=='auto'&&manualMode!==plan.mode)throw Error('请遵守作者选择的标题方式');
 for(const entry of plan.entries){
  const b=n.blocks.find(x=>x.id===entry.id);
  if(!b||!editableHeading(n,b)||!targets.has(b.id))throw Error('标题不在委派范围或受到保护：'+entry.id);
  if(entry.mode&&!Object.hasOwn(HEADING_MODES,entry.mode))throw Error('局部标题方式无效');
  if(b.heading?.owner==='author'&&b.heading.mode==='source'&&b.heading.sourceId&&entry.sourceId&&entry.sourceId!==b.heading.sourceId)throw Error('请保留作者指定的来源');
  if(b.heading?.owner==='author'&&entry.mode&&entry.mode!==b.heading.mode)throw Error('请保留作者的局部标题方式');
 }
 const all=n.blocks.filter(b=>editableHeading(n,b));
 const global=all.every(b=>ids.has(b.id))&&(!manualMode||manualMode==='auto');
 return {...n,...(global?{headingPolicy:{mode:'auto',selected:plan.mode,reason:plan.reason||''}}:{}),blocks:n.blocks.map(b=>{
  const entry=plan.entries.find(e=>e.id===b.id);if(!entry)return b;
  const mode=b.heading?.owner==='author'?b.heading.mode:entry.mode||manualMode&&manualMode!=='auto'&&manualMode||plan.mode;
  if(mode!=='ai'&&entry.text!==undefined)throw Error('编号、固定名称和来源标题不能由 AI 改写');
  if(mode==='ai'&&(typeof entry.text!=='string'||!entry.text.trim()))throw Error('AI 标题不能为空');
  return applyOne(n,b,mode,{text:entry.text,sourceId:entry.sourceId,owner:b.heading?.owner==='author'?'author':'agent'});
 })};
}
export function headingFormatErrors(n){
 const errors=[],add=(path,message)=>errors.push({path,message});
 const policy=n?.headingPolicy;
 if(policy&&(!['auto',...Object.keys(HEADING_MODES)].includes(policy.mode)||(policy.selected&&!Object.hasOwn(HEADING_MODES,policy.selected))||(policy.reason!==undefined&&(typeof policy.reason!=='string'||policy.reason.length>500))))add('headingPolicy','标题方式格式无效');
 for(const b of n?.blocks||[]){const h=b.heading;if(!h)continue;
  if(typeof h!=='object'||Array.isArray(h)||b.type!=='heading'||(h.mode&&!Object.hasOwn(HEADING_MODES,h.mode))||(h.owner&&!['author','agent'].includes(h.owner))||['fixedText','sourceId','sourceTitle'].some(k=>h[k]!==undefined&&typeof h[k]!=='string')){add('blocks.'+b.id+'.heading','标题属性格式无效');continue;}
  if(b.locked||b.state!=='ready')continue;
  if(h.mode==='numbered'&&b.text!=='')add('blocks.'+b.id,'仅编号标题不保存标题文字');
  if(h.mode==='fixed'&&(!h.fixedText?.trim()||b.text!==h.fixedText))add('blocks.'+b.id,'固定标题必须使用设置的名称');
  if(h.mode==='source'&&(!(n.sources||[]).some(s=>s.id===h.sourceId)||!h.sourceTitle?.trim()||b.text!==h.sourceTitle))add('blocks.'+b.id,'来源标题必须保留原文快照及来源关系');
 }
 return errors;
}
export function assertHeadingOwnership(n,previous,scope){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),old=previous.headingPolicy;
 if(!same(n.headingPolicy,old)){
  if(old?.mode&&old.mode!=='auto'||n.headingPolicy?.mode!=='auto'||!previous.blocks.filter(b=>editableHeading(previous,b)).every(b=>scope?.targetIds.includes(b.id)))throw Error('不能修改作者指定或未委派的标题方式');
 }
 for(const b of previous.blocks){const next=n.blocks.find(x=>x.id===b.id);if(!next)continue;
  if(protocolHeading(previous,b)&&!same(b,next))throw Error('固定字段标题不能修改');
  if(b.heading?.owner==='author'&&(next.heading?.mode!==b.heading.mode||next.heading?.owner!=='author'))throw Error('作者指定的局部标题方式不能修改');
  if(b.heading?.owner==='author'&&b.heading.sourceId&&next.heading?.sourceId!==b.heading.sourceId)throw Error('作者指定的来源不能修改');
  if(n.headingPolicy?.mode&&n.headingPolicy.mode!=='auto'&&next.heading?.mode&&next.heading?.owner!=='author'&&next.heading.mode!==n.headingPolicy.mode)throw Error('请遵守作者选择的标题方式');
  if(next.heading?.fixedText!==b.heading?.fixedText)throw Error('固定名称由作者或模板设置');
  if(next.heading?.owner==='author'&&b.heading?.owner!=='author')throw Error('AI 不能冒充人工标题设置');
  if(next.heading?.mode==='source'&&!same(next.heading,b.heading)){
   const source=n.sources.find(s=>s.id===next.heading.sourceId);
   if(!source||next.heading.sourceTitle!==source.title)throw Error('来源标题必须原样取自素材');
  }
 }
}
export const HEADING_INSTRUCTIONS=`标题方式默认自动选择：阅读整篇正文、读者用途、已有模板和已选素材后，选择 numbered（仅编号）、fixed（固定名称）、source（沿用来源）、ai（AI 拟题）之一。默认整篇一致，只有真实结构差异才局部例外；不能总选 ai。没有标题的短文不必新增标题。连续论述可仅编号；分类明确且 heading.fixedText 已存在时可用 fixed；独立新闻或公告逐条介绍时优先 source；跨来源整合分析需要自由组织时才用 ai。固定名称不能临时编造，来源标题不翻译、不截断、不润色。正文完成后确认选择；临时规划放 requirement，不用先起漂亮标题再填正文。
通过 notebook_heading_apply 执行选择，mode 为整篇方式，entries 为本次委派标题 [{id,mode?,sourceId?,text?}]，只有 ai 提供 text；reason 简要记录选择理由（不在聊天重复）。程序负责编号、固定名称、来源原标题。headingPolicy.mode 非 auto 时服从作者；heading.owner=author 的局部方式优先。保留手写/locked 标题和结构化记录的 H2 字段标题；单独补全正文时不修改旁边标题或整篇方式。新建结构先 task_update 写入正文与标题占位，然后读取最新 revision，再执行已委派的标题。标题需共同体现真实的总分、并列或递进关系，常规名称和名词短语即可，避免每节都用提问、引导式口吻或小结式金句；若正文结构有问题且本次只委派标题，简短提示需要调整的具体段落，不越权改正文。`;
