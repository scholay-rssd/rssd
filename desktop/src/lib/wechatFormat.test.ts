// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {wechatHtml,copyRichHtml,defaultWechatStyle,WECHAT_STYLES} from '../editorial/wechatFormat';
it('keeps a Markdown image with its source caption in all WeChat styles',()=>{
 const source='<p><img src="data:image/png;base64,eA==" alt="原图"></p><p>图｜作者，<a href="https://example.org/paper" onclick="bad()">原文</a>，CC BY 4.0。</p><p>普通正文</p><p><img src="https://example.org/next.png"></p><p>图书馆服务是正文，不是图注。</p>';
 for(const {id} of WECHAT_STYLES){
  const doc=new DOMParser().parseFromString(wechatHtml(source,id),'text/html');
  expect(doc.querySelectorAll('figure')).toHaveLength(1);
  expect(doc.querySelector('figure img')?.getAttribute('alt')).toBe('原图');
  expect(doc.querySelector('figcaption')?.textContent).toContain('CC BY 4.0');
  expect(doc.querySelector('figcaption')?.getAttribute('style')).toContain('font-size:12');
  expect(doc.querySelector('figcaption a')?.getAttribute('href')).toBe('https://example.org/paper');
  expect(doc.querySelector('[onclick]')).toBeNull();
  expect(doc.querySelectorAll('p')).toHaveLength(3);
 }
});
it('copies inline layout and embedded images without executable HTML or local file references',()=>{
 const html=wechatHtml('<h1 onclick="bad()">标题</h1><p>段落<strong>加粗</strong></p><img src="data:image/png;base64,eA==" onerror="bad()" alt="配图"><script>bad()</script><img src="file:///private/secret"><a href="javascript:bad()">链接</a>');
 const doc=new DOMParser().parseFromString(html,'text/html');expect(doc.querySelector('h1')?.getAttribute('style')).toContain('24px');expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,eA==');expect(doc.querySelectorAll('img')).toHaveLength(1);expect(doc.querySelector('script,[onclick],[onerror]')).toBeNull();expect(html).not.toContain('file:///');expect(html).not.toContain('javascript:');
});
it('writes both HTML and plain text clipboard formats and does not report success on failed fallback',async()=>{
 const write=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('ClipboardItem',class {constructor(public data:object){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write}});
 await copyRichHtml(wechatHtml('<h2>标题</h2><p>正文</p>'));expect(Object.keys(write.mock.calls[0][0][0].data)).toEqual(['text/html','text/plain']);
 write.mockRejectedValue(Error('denied'));Object.defineProperty(document,'execCommand',{configurable:true,value:()=>false});await expect(copyRichHtml('<p>text</p>')).rejects.toThrow('系统剪贴板');expect(document.querySelector('[contenteditable]')).toBeNull();vi.unstubAllGlobals();
});
it('offers four distinct styles that all keep the same sanitising rules',()=>{
 const source='<h1 onclick="bad()">标题</h1><h2>背景</h2><p>段落</p><h2>方法</h2><pre><code>npm i</code></pre><p><code>x</code></p><script>bad()</script><img src="file:///secret">';
 expect(WECHAT_STYLES.map(x=>x.id)).toEqual(['classic','academic','briefing','technical']);
 const out=Object.fromEntries(WECHAT_STYLES.map(x=>[x.id,wechatHtml(source,x.id)]));
 expect(new Set(Object.values(out)).size).toBe(4);
 for(const html of Object.values(out)){expect(html).not.toContain('<script');expect(html).not.toContain('onclick');expect(html).not.toContain('file:///');const d=new DOMParser().parseFromString(html,'text/html');expect([...d.querySelectorAll('*')].every(el=>[...el.attributes].every(a=>['style','href','src','alt'].includes(a.name)))).toBe(true);}
 expect(wechatHtml(source)).toBe(out.classic);
 const heads=(id:string)=>[...new DOMParser().parseFromString(out[id],'text/html').querySelectorAll('h2')].map(h=>h.textContent);
 expect(heads('classic')).toEqual(['01背景','02方法']);expect(heads('academic')).toEqual(['1背景','2方法']);expect(heads('technical')).toEqual(['// 01背景','// 02方法']);expect(heads('briefing')).toEqual(['PART 01背景','PART 02方法']);
 const tech=new DOMParser().parseFromString(out.technical,'text/html');
 expect(tech.querySelector('pre')!.getAttribute('style')).toContain('#0f172a');expect(tech.querySelector('pre code')!.getAttribute('style')).toContain('background:none');expect(tech.querySelector('p code')!.getAttribute('style')).toContain('#eef2f6');
 expect(new DOMParser().parseFromString(out.academic,'text/html').querySelector('h1')!.getAttribute('style')).toContain('text-align:center');
});
it('picks a default style per column and falls back to the original look',()=>{
 expect(defaultWechatStyle('昔日学术')).toBe('academic');expect(defaultWechatStyle('学者观察')).toBe('academic');expect(defaultWechatStyle('学界犀闻')).toBe('briefing');expect(defaultWechatStyle('学术情报')).toBe('briefing');expect(defaultWechatStyle('学术开源')).toBe('technical');expect(defaultWechatStyle()).toBe('classic');expect(defaultWechatStyle('其他')).toBe('classic');
});
it('never numbers structural headings or headings that already carry a number',()=>{
 const source='<h2>摘要</h2><p>甲</p><h2>背景</h2><h2>一、方法</h2><h2>2. 结果</h2><h2>第三节 讨论</h2><h2>展望</h2><h2>来源</h2>';
 const heads=(id:any)=>[...new DOMParser().parseFromString(wechatHtml(source,id,{unnumbered:['摘要','正文','来源']}),'text/html').querySelectorAll('h2')].map(h=>h.textContent);
 expect(heads('academic')).toEqual(['摘要','1背景','一、方法','2. 结果','第三节 讨论','2展望','来源']);
 expect(heads('briefing')).toEqual(['摘要','PART 01背景','一、方法','2. 结果','第三节 讨论','PART 02展望','来源']);
 expect(heads('technical')).toEqual(['摘要','// 01背景','一、方法','2. 结果','第三节 讨论','// 02展望','来源']);
 expect(heads('classic')).toEqual(['摘要','01背景','一、方法','2. 结果','第三节 讨论','02展望','来源']);
 // Without the column definition nothing is assumed structural, so 摘要 is treated as a chapter.
 expect([...new DOMParser().parseFromString(wechatHtml('<h2>摘要</h2>','academic'),'text/html').querySelectorAll('h2')].map(h=>h.textContent)).toEqual(['1摘要']);
 const doc=new DOMParser().parseFromString(wechatHtml(source,'briefing',{unnumbered:['摘要']}),'text/html');
 expect(doc.querySelector('h2 span')!.getAttribute('style')).toContain('border-radius:999px');expect(doc.querySelectorAll('h2')[1].querySelectorAll('span')[1].getAttribute('style')).toContain('border-top:2px solid');
 expect([...doc.querySelectorAll('span')].every(x=>(x.textContent||'').length>0)).toBe(true);
});
