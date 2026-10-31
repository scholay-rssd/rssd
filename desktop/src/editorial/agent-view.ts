import { tr } from "../uiText";
export type DiffLine={kind:'same'|'add'|'remove';text:string;oldLine?:number;newLine?:number};
export function lineDiff(oldText:string,newText:string):DiffLine[]{
 const a=oldText.split('\n'),b=newText.split('\n');
 // Bound work for unusually large tool outputs. Common unchanged edges remain visible.
 let start=0,end=0;while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
 while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 const x=a.slice(start,a.length-end),y=b.slice(start,b.length-end),result:DiffLine[]=[];
 for(let i=0;i<start;i++)result.push({kind:'same',text:a[i],oldLine:i+1,newLine:i+1});
 let i=0,j=0;
 if(x.length*y.length<=400000){const table=Array.from({length:x.length+1},()=>new Uint32Array(y.length+1));for(let p=x.length-1;p>=0;p--)for(let q=y.length-1;q>=0;q--)table[p][q]=x[p]===y[q]?table[p+1][q+1]+1:Math.max(table[p+1][q],table[p][q+1]);
 while(i<x.length||j<y.length){if(i<x.length&&j<y.length&&x[i]===y[j]){result.push({kind:'same',text:x[i],oldLine:start+i+1,newLine:start+j+1});i++;j++;}else if(i<x.length&&(j===y.length||table[i+1][j]>=table[i][j+1]))result.push({kind:'remove',text:x[i],oldLine:start+(i++)+1});else result.push({kind:'add',text:y[j],newLine:start+(j++)+1});}}
 else{for(const text of x)result.push({kind:'remove',text,oldLine:start+(i++)+1});for(const text of y)result.push({kind:'add',text,newLine:start+(j++)+1});}
 for(let k=0;k<end;k++)result.push({kind:'same',text:a[a.length-end+k],oldLine:a.length-end+k+1,newLine:b.length-end+k+1});return result;
}
export function modelDetail(value:string){return value.match(/\[(.*)\]/)?.[1].replaceAll(',', ' · ').replaceAll('reasoning_effort=','').replaceAll('effort=','').replaceAll('reasoning=','').replaceAll('fast=true','Fast').replaceAll('fast=false','Standard')||'';}
export async function attachmentFromFile(file:File){
 if(file.type.startsWith('image/')){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15000000)throw Error(tr('图片请选择 15 MB 以内的 PNG、JPEG 或 WebP'));
  const url=URL.createObjectURL(file);try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error(tr('图片无法读取')));img.src=url;});const scale=Math.min(1,1400/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.82).split(',')[1];if(data.length>1500000)throw Error(tr('压缩后的图片仍过大'));return {type:'image',name:file.name,mimeType:'image/jpeg',data};}finally{URL.revokeObjectURL(url);}
 }
 if(!/\.(md|txt|csv|json)$/i.test(file.name)||file.size>150000)throw Error(tr('文本附件支持 150 KB 以内的 md、txt、csv、json'));
 return {type:'text',name:file.name,text:await file.text()};
}
