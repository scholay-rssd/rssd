// Pure text scanner for read-only note previews and the isolated layout browser. It never
// executes TeX and leaves code, currency and ordinary parentheses as text.
export function mathSegments(input,{legacy=false,markdown=false}={}){
 const text=String(input),found=[];let plain=0,i=0;
 const escaped=at=>{let n=0;for(let j=at-1;j>=0&&text[j]==='\\';j--)n++;return n%2===1;};
 const add=(start,end,tex,display)=>{if(start>plain)found.push({text:text.slice(plain,start)});found.push({text:text.slice(start,end),tex,display});plain=end;i=end;};
 while(i<text.length){
  if(markdown&&(i===0||text[i-1]==='\n')){
   const fence=text.slice(i).match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/);
   if(fence){const end=new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}[^\\n]*(?:\\n|$)','gm');end.lastIndex=i+fence[0].length;const close=end.exec(text);i=close?close.index+close[0].length:text.length;continue;}
   const indented=text.slice(i).match(/^(?: {4}|\t)[^\n]*(?:\n|$)/);if(indented){i+=indented[0].length;continue;}
  }
  if(markdown&&text[i]==='`'&&!escaped(i)){const run=text.slice(i).match(/^`+/)[0],end=text.indexOf(run,i+run.length);i=end<0?i+run.length:end+run.length;continue;}
  let open='',close='',display=false,old=false;
  if(!escaped(i)){
   if(text.startsWith('$$',i)){open=close='$$';display=true;}
   else if(text.startsWith('\\[',i)){open='\\[';close='\\]';display=true;}
   else if(text.startsWith('\\(',i)){open='\\(';close='\\)';}
   else if(text[i]==='$'&&text[i+1]&&!/\s/.test(text[i+1]))open=close='$';
   else if(legacy&&['[','('].includes(text[i])){open=text[i];close=open==='['?']':')';old=true;}
  }
  if(!open){i++;continue;}
  let end=-1,depth=0;
  for(let j=i+open.length;j<text.length;j++){
   if(old){if(text[j]===open&&!escaped(j))depth++;if(text[j]===close&&!escaped(j)){if(!depth){end=j;break;}depth--;}}
   else if(text.startsWith(close,j)&&!escaped(j)){end=j;break;}
  }
  if(end<0){if(open==='$$'||open==='\\['||open==='\\(')throw Error('公式定界符未闭合，请核对当前内容；原稿未改动。');i+=open.length;continue;}
  const tex=text.slice(i+open.length,end);
  if(!tex.trim()||old&&!/\\[a-zA-Z]+/.test(tex)||open==='$'&&(tex.includes('\n\n')||markdown&&tex.includes('`')||/\s$/.test(tex)||/[\d$]/.test(text[end+1]||''))){i+=open.length;continue;}
  if(old)display=open==='['&&text.slice(0,i).trim()===''&&text.slice(end+1).trim()==='';
  add(i,end+close.length,tex,display);
 }
 if(plain<text.length)found.push({text:text.slice(plain)});
 return found;
}
export function protectMathMarkdown(markdown){
 let prefix='NOTECARDSMATHTOKEN';while(markdown.includes(prefix))prefix+='X';
 const replacements=[];
 const protectedText=mathSegments(markdown,{markdown:true}).map(part=>{if(part.tex===undefined)return part.text;const token=prefix+replacements.length+'END';replacements.push({token,text:part.text});return token;}).join('');
 return {markdown:protectedText,replacements};
}
export function restoreMathHtml(html,replacements){
 const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 for(const {token,text} of replacements)html=html.replaceAll(token,escape(text));return html;
}
