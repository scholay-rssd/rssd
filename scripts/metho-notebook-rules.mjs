import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const GROK_WRITING_SOURCE='4e0399e87f62988d99ae5f7ddac6c3a4f8306f2f';
const sections={methods:{mode:'encyclopedia',skills:[]},statistics:{mode:'encyclopedia',skills:['statistics-explainer']},experiments:{mode:'documentation',skills:['experiment-design']},frontiers:{mode:'xiwen',skills:['scholay-xiwen']}};
// One frozen, author-selected column context for the existing notebook engine.
// This does not start a producer, change a workspace, or authorize publication.
export async function methoNotebookRules(repo,{sectionId,statistical=false}){
 const section=sections[sectionId];if(!section)throw Error('Unknown Metho section');
 const paths=['docs/bot-writing-flow/briefs/README.md',`docs/bot-writing-flow/briefs/metho-${sectionId}.md`];
 const documents=await Promise.all(paths.map(async path=>({path,content:await readFile(join(repo,path),'utf8')})));
 const override='本轮为既有 Metho 文章的中文本地修订，不选新题，不翻译，不投稿、不发布。现行写作协议优先。标题约 8–16 字、2–4 个正文小节是本栏默认，不为满足数量虚构材料。参考文献不计入正文小节数，统一使用二级标题“参考文献”；每条按来源实际信息列作者、年份、完整题名、期刊/出版者、卷页或文章号与 DOI/稳定链接。正文引用使用与文末条目对应的顺序编号，公开渲染为上标 [1]；可保留必要作者名称，不以作者年份链接代替编号。图注分别交代图意及必要来源，不拼接句号与中点。成稿必须调用既有 finalizeNotebook，按当前工作空间策略从共用品牌库挂载尾注；保留用户品牌 ID、版本和原文，已选节点不得重复或覆盖。尾注合并到参考文献末尾。统计图从真实执行的计算结果绘制。所有输出与预览从同一 notebook 导出。';
 const content=documents.map(d=>`来源 ${d.path}\n${d.content}`).join('\n\n')+'\n\n本次适配\n'+override;
 const hash=createHash('sha256').update(content).digest('hex');
 return {siteId:'metho',workspaceId:'metho',sectionId,column:({methods:'方法百科',statistics:'统计之美',experiments:'实验星球',frontiers:'方法前沿'})[sectionId],mode:section.mode,taskMode:section.mode==='xiwen'?'xiwen':'observation',skills:[...new Set(['site-writing',...section.skills,...(statistical?['statistics-explainer']:[])])],sourceCommit:GROK_WRITING_SOURCE,documents:documents.map(d=>({path:d.path,sha256:createHash('sha256').update(d.content).digest('hex')})),content,sha256:hash};
}
