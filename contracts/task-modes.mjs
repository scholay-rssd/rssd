// Task modes in three naming layers, so every host speaks about a task the same way:
// 1. the stored key (`task.mode`) never changes, because saved tasks and template libraries are keyed by it;
// 2. the abstract name is what core rules and new code use;
// 3. the display label belongs to the space's domain pack, with a neutral default.
// Process parameters (look-back days, columns, topic station) stay in desktop/scripts/agent/task-types.mjs.
export const TASK_MODES=Object.freeze({
 xiwen:{name:'digest',kind:'content',topic:'matrix',structured:false,label:{'zh-CN':'资讯汇编',en:'Digest'}},
 observation:{name:'event-report',kind:'content',topic:'single',structured:false,label:{'zh-CN':'事件报道',en:'Event report'}},
 opensource:{name:'resource',kind:'content',topic:'single',structured:true,label:{'zh-CN':'资源介绍',en:'Resource introduction'}},
 calendar:{name:'notice',kind:'content',topic:'single',structured:true,label:{'zh-CN':'通知公告',en:'Notice'}},
 history:{name:'historical-event',kind:'content',topic:'single',structured:true,label:{'zh-CN':'历史事件',en:'Historical event'}},
 rss:{name:'source-discovery',kind:'service',topic:'board',structured:false,label:{'zh-CN':'AI 搜索订阅源',en:'Source discovery'}},
 image:{name:'image-conversation',kind:'other',topic:null,structured:false,label:{'zh-CN':'图片生成',en:'Image conversation'}},
 legacy:{name:'legacy-session',kind:'other',topic:null,structured:false,label:{'zh-CN':'历史会话',en:'Legacy session'}},
});
export const MODE_KEYS=Object.freeze(Object.keys(TASK_MODES));
export const CONTENT_MODE_KEYS=Object.freeze(MODE_KEYS.filter(key=>TASK_MODES[key].kind==='content'));
const BY_NAME=new Map(MODE_KEYS.map(key=>[TASK_MODES[key].name,key]));

export const isModeKey=key=>typeof key==='string'&&Object.hasOwn(TASK_MODES,key);
export function modeName(key){
 if(!isModeKey(key))throw Error('Unknown task mode: '+key);
 return TASK_MODES[key].name;
}
export function modeKey(name){
 const key=BY_NAME.get(name);
 if(!key)throw Error('Unknown task mode name: '+name);
 return key;
}
/** A content mode ends in a manuscript; services and other modes never do. */
export const isContentMode=key=>isModeKey(key)&&TASK_MODES[key].kind==='content';
/** Single-topic modes are built on exactly one chosen material. */
export const isSingleTopicMode=key=>isModeKey(key)&&TASK_MODES[key].topic==='single';
/** The domain pack's label wins; otherwise the neutral default in the requested locale. */
export function modeLabel(key,{pack=null,locale='zh-CN'}={}){
 if(!isModeKey(key))throw Error('Unknown task mode: '+key);
 const fromPack=pack?.labels?.[key];
 const value=typeof fromPack==='string'?fromPack:fromPack?.[locale];
 return value||TASK_MODES[key].label[locale]||TASK_MODES[key].label['zh-CN'];
}
