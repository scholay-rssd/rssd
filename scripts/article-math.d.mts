export type MathSegment={text:string;tex?:string;display?:boolean};
export function mathSegments(input:string,options?:{legacy?:boolean;markdown?:boolean}):MathSegment[];
export function protectMathMarkdown(markdown:string):{markdown:string;replacements:{token:string;text:string}[]};
export function restoreMathHtml(html:string,replacements:{token:string;text:string}[]):string;
