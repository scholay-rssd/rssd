// Narrow, deterministic translation checks. These compare explicit numeric,
// calendar and currency facts plus a small set of observed terminology errors;
// they do not prove semantic equivalence or
// preserve negation, attribution, causality or the meaning of a caption.
import {validateTranslationTerminology} from './translation-terminology.mjs';
export const translationFactsVersion=16;
const failure=message=>Object.assign(Error(message),{code:'FLOW_LANGUAGE_FACTS',statusCode:502});
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthPattern=months.map(month=>month==='september'?'september|sept\\.?|sep\\.?':month.length>3?month+'|'+month.slice(0,3)+'\\.?':month).join('|');
const properMonthPattern=monthPattern.replace(/[a-z]+/g,word=>word[0].toUpperCase()+word.slice(1));
const monthNumber=value=>months.findIndex(month=>month.startsWith(value.toLowerCase().replace(/\.$/,'')))+1;
const calendarOrdinals=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth','twenty-first','twenty-second','twenty-third','twenty-fourth','twenty-fifth','twenty-sixth','twenty-seventh','twenty-eighth','twenty-ninth','thirtieth','thirty-first'];
const ordinalPattern='(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|'+calendarOrdinals.map(value=>value.replace('-','[- ]')).join('|');
const ordinalNumber=value=>calendarOrdinals.indexOf(value.toLowerCase().replace(/ /g,'-'))+1;
function normalizeCalendarOrdinals(text){
 // A calendar day may be written as "first" or "1st". Ordinary rankings
 // such as "first study" must not satisfy a missing quantity of one.
 text=text.replace(new RegExp('(?<![A-Za-z-])\\b('+ordinalPattern+')(?=\\s+day\\s+of\\s+(?:a|the|any|each|every)\\s+(?:calendar\\s+)?month\\b)','gi'),value=>ordinalNumber(value)?String(ordinalNumber(value)):value);
 // Explicit named-month dates can then use the existing date parser. The
 // required "of" prevents treating unrelated ordinal prose as a date.
 return text.replace(new RegExp('(?<![A-Za-z-])\\b('+ordinalPattern+'|(?:[1-9]|[12]\\d|3[01])(?:st|nd|rd|th))\\s+(?:day\\s+)?of\\s+('+monthPattern+')\\b','gi'),(match,day,month)=>{const number=/^\d/.test(day)?parseInt(day,10):ordinalNumber(day);return number?number+' '+month:match;});
}
const smallCardinals=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tensCardinals=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const cardinalPattern='(?:'+tensCardinals.join('|')+')(?:[- ](?:'+smallCardinals.slice(1,10).join('|')+'))?|'+smallCardinals.join('|');
function cardinalNumber(value){const words=value.toLowerCase().split(/[- ]/),small=smallCardinals.indexOf(words[0]);return small>=0?small:(tensCardinals.indexOf(words[0])+2)*10+(words[1]?smallCardinals.indexOf(words[1]):0);}
function unsupportedCardinalPrefix(prefix){
 if(/(?:[-\u2010-\u2015−]|\b(?:(?:hundred|thousand|million|billion|trillion)(?:\s*,)?(?:\s+and)?|minus|negative))\s*$/i.test(prefix))return true;
 const decimalTail=/\bpoint(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine))*\s+$/i.test(prefix);
 return decimalTail&&!/\b(?:(?:this|that)\s+point|at\s+one\s+point)\s+$/i.test(prefix);
}
const scopedOrdinalPattern=calendarOrdinals.map(word=>word.replace('-','[- ]')).join('|')+'|\\d+(?:st|nd|rd|th)';
const scopedOrdinalValue=word=>/^\d/.test(word)?parseInt(word,10):ordinalNumber(word);
function unsupportedOrdinalPrefix(prefix){
 return unsupportedCardinalPrefix(prefix)||new RegExp('\\b(?:'+cardinalPattern+'|\\d+(?:\\.\\d+)?)(?:\\s+and)?\\s+$','i').test(prefix);
}
function normalizeCountCardinals(text){
 // A count/range must end in a supported count noun, optionally through a
 // partitive ("of these") and nominal modifiers. Do not scan arbitrary
 // intervening prose: "one could compare papers" is not a quantity.
 const modifiers='(?:\\s+(?:open[- ]source|independent|language|AI|large|small|neural|statistical|baseline|experimental|research|scientific|published|retracted|peer-reviewed|metal|corrosion|calendar|consecutive|additional|different|adult|most\\s+suspicious)){0,4}';
 const context='(?:\\s+of\\s+(?:these|those|the))?'+modifiers+'\\s+(?:models?|papers?|years?|partners?|countr(?:y|ies)|friends?|participants?|manuscripts?|co-authorships?|rounds?|months?|numbers?|batch(?:es)?|weeks?|days?|cases?|samples?|edges?|teams?|units?|(?:project\\s+)?schools?|standard\\s+deviations?|(?:principal\\s+)?components?|Friday\\s+(?:sessions?|selections?))\\b';
 const number='(?:'+cardinalPattern+'|\\d+)',connector='(?:\\s+(?:to|and)\\s+|\\s*[-–—]\\s*)';
 return text.replace(new RegExp('(?<![A-Za-z0-9-])\\b('+number+')(?:('+connector+')('+number+'))?(?='+context+')','gi'),(match,first,separator,second,index)=>{
  // Unsupported compound lexical numbers must not degrade into a matching
  // suffix: "one hundred and one papers" is not one, nor is "point five" five.
  if(unsupportedCardinalPrefix(text.slice(0,index)))return match;
  const numeric=word=>/^\d+$/.test(word)?word:String(cardinalNumber(word));
  return numeric(first)+(second?separator+numeric(second):'');
 });
}
function normalizeDurationCardinals(text){
 // Durations and standard deviations are quantities, not arbitrary adjectives.
 return text.replace(new RegExp('(?<![A-Za-z0-9.\\-\\u2010-\\u2015−])\\b('+cardinalPattern+')([-\\u2010\\u2011])((?:year|month|week|day|unit|standard[-\\u2010\\u2011]deviation)\\b)','gi'),(match,word,separator,unit,index)=>{
  if(unsupportedCardinalPrefix(text.slice(0,index))||/^[\s-]+and[\s-]+(?:a[\s-]+)?half\b/i.test(text.slice(index+match.length)))return match;
  return cardinalNumber(word)+separator+unit;
 });
}
function normalizeComponentCounts(text){
 // Only an explicit component context in the same clause supplies an omitted
 // count noun. "One gives two" and unrelated predicate prose remain untouched.
 return text.replace(new RegExp('\\b(gives|retains)\\s+('+cardinalPattern+')(?=\\s*(?:[;,!?]|\\.(?!\\d)|$))','gi'),(match,verb,word,index)=>{
  const clause=text.slice(0,index).split(/[.;!?\n]/).at(-1);
  if(!/\b(?:principal\s+components?|scree\s+plot)\b/i.test(clause))return match;
  return verb+' '+cardinalNumber(word);
 });
}
function normalizeLimitCardinals(text){
 // A bound with an explicit "upper/lower limit of" is a quantity even when
 // its noun is implicit. Do not interpret arbitrary predicate prose or a
 // prefix of an unsupported compound, decimal or ordinal as that quantity.
 return text.replace(new RegExp('\\b((?:upper|lower)\\s+limit\\s+of\\s+)('+cardinalPattern+')','gi'),(match,prefix,word,index)=>{
  const tail=text.slice(index+match.length);
  // Check after the longest match in the callback, so a rejected "thirty two
  // point five" cannot backtrack to the smaller valid prefix "thirty".
  if(/^[-\u2010-\u2015\w]|^\.\d|^\s+and\s+(?:a\s+)?half\b/i.test(tail)||new RegExp('^\\s+(?:hundred|thousand|million|billion|trillion|point|'+cardinalPattern+'|'+ordinalPattern+')\\b','i').test(tail))return match;
  return prefix+cardinalNumber(word);
 });
}
function normalizeIsotopes(text){
 // Chinese element names and the corresponding English spelling identify
 // the same isotope; the mass number is not a negative numeric quantity.
 // Keep it in the scientific-identity gate, including distinct mass numbers.
 for(const [symbol,chinese,english] of [['C','碳','carbon'],['Na','钠','sodium']])text=text.replace(new RegExp('(?:'+chinese+'|(?<![A-Za-z0-9_-])'+english+')\\s*[-\\u2010\\u2011]\\s*(\\d+)(?![A-Za-z0-9_]|[.\\-\\u2010\\u2011]\\d)','gi'),(_,mass)=>symbol+'-'+mass);
 return text;
}
function normalizeExplicitZero(text){
 // A lexical zero is a value only in an explicit covariate, predictor or slope assignment.
 // Do not infer zero from "no", a negated predicate, or "zero-inflated".
 text=text.replace(/\b((?:covariates?|slopes?|predictor\s+variables?)\s+(?:(?:is|are|was|were)\s+(?:all\s+)?(?:(?:equal\s+to|set\s+to)\s+)?|equals?\s+|(?:take|takes|have|has)\s+(?:a\s+)?value\s+of\s+))zero\b(?![-\u2010-\u2015\w]|\s+point\b|\s+and\s+(?:a\s+)?half\b|\.\d)/gi,(_,prefix)=>prefix+'0');
 // These observed caption/distribution forms name an explicit zero; they do
 // not infer zero from "no difference" or otherwise certify caption meaning.
 return text.replace(/\b((?:gr[ae]y\s+line\s+is|indistinguishable\s+from|near|(?:is|are|was|were)\s+close\s+to)\s+)zero\b(?![-\u2010-\u2015\w]|\s+point\b|\s+and\s+(?:a\s+)?half\b|\.\d)/gi,(_,prefix)=>prefix+'0');
}
function scientificSymbols(text,symbols){
 // These are identities, not quantities: repeated BH2 may become "which".
 // Keep every distinct symbol, including case, while allowing typographic
 // hyphens. Bare lowercase units such as m2 remain outside this narrow rule.
 // En/em dashes separate prose from a name, as in "models—Qwen3-8B";
 // they must not turn the preceding word into part of the model identity.
 return text.replace(/(?<![A-Za-z0-9_])([A-Za-z]+(?:[-\u2010\u2011][A-Za-z]+)*[-\u2010\u2011]?\d+[A-Za-z0-9]*(?:[.\-\u2010\u2011]\d+[A-Za-z0-9]*)*)(?![A-Za-z0-9_])/g,(match)=>{
  const symbol=match.replace(/[\u2010\u2011]/g,'-');
  if(!/^[A-Z]/.test(symbol)&&!(/^[a-z]{2,}-\d/.test(symbol)))return match;
  const prefix=symbol.match(/^[A-Za-z]+/)?.[0].toLowerCase();
  if(Object.hasOwn(magnitudes,prefix)||['am','pm','gbp','usd','cny','rmb','eur','jpy','hkd','cad','aud'].includes(prefix))return match;
  symbols.push(symbol);return ' ';
 });
}
const weekdays=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const weekdayPattern=/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const weekdayAbbreviations=/\b(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?\b/g;
const magnitudes={'百':2,'千':3,'万':4,'十万':5,'百万':6,'千万':7,'亿':8,'十亿':9,'百亿':10,'千亿':11,'万亿':12,thousand:3,k:3,million:6,m:6,mn:6,billion:9,b:9,bn:9,trillion:12};
// A new adjective hyphen requires a full magnitude word: "10-m-long"
// contains a length unit, whereas "16-billion-parameter" scales the number.
const numberPattern=/[+\-−]?(?:\d{1,3}(?:[,\u00a0\u202f ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:\s*(?:[-\u2010\u2011]\s*(?=trillion\b|billion\b|million\b|thousand\b))?(万亿|千亿|百亿|十亿|千万|百万|十万|亿|万|千|百|trillion\b|billion\b|million\b|thousand\b|bn\b|mn\b|[kmb]\b))?/gi;
const currencies=[['GBP',/英镑|\b(?:GBP|pounds?\s+sterling|British\s+pounds?|pounds?)\b|£/gi],['USD',/美元|美金|\b(?:USD|US\s+dollars?|American\s+dollars?)\b|US\$/gi],['CNY',/人民币|\b(?:CNY|RMB|yuan|renminbi)\b/gi],['EUR',/欧元|\b(?:EUR|euros?)\b|€/gi],['JPY',/日元|日圆|\b(?:JPY|yen)\b/gi],['HKD',/港元|港币|\b(?:HKD|Hong\s+Kong\s+dollars?)\b|HK\$/gi],['CAD',/加元|\b(?:CAD|Canadian\s+dollars?)\b|CA\$/gi],['AUD',/澳元|\b(?:AUD|Australian\s+dollars?)\b|AU\$/gi]];

function decimal(value,power,negative){
 const clean=value.replace(/[+\-−,\s]/g,''),[whole,fraction='']=clean.split('.');let digits=(whole||'0')+fraction,scale=fraction.length-power;
 if(scale<0){digits+='0'.repeat(-scale);scale=0;}
 digits=digits.replace(/^0+(?=\d)/,'');
 while(scale>0&&digits.endsWith('0')){digits=digits.slice(0,-1);scale--;}
 if(!digits||/^0+$/.test(digits))return '0';
 if(scale){digits=digits.padStart(scale+1,'0');digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);}
 return (negative?'-':'')+digits;
}
export function translationQuantityHints(source){
 // Only literal Arabic+亿 quantities in this fragment. Reuse the fact gate's
 // exact decimal scaling; never round, derive a missing value or inspect a response.
 const text=String(source),hints={};let previousEnd=-1;
 for(const match of text.matchAll(numberPattern)){
  const adjacentNumber=previousEnd>=0&&!text.slice(previousEnd,match.index).trim();previousEnd=match.index+match[0].length;
  if(match[1]!=='亿'||/[A-Za-z0-9_.]$|[/\\⁄∕／]\s*[(（]?\s*$/.test(text.slice(0,match.index)))continue;
  const raw=match[0].slice(0,-1).trim();
  // A minus adjacent to a preceding number can be a range separator. Omit
  // that ambiguous hint instead of presenting a positive endpoint as negative.
  if(adjacentNumber&&/^[\-−]/.test(raw))continue;
  const value=decimal(raw,magnitudes['亿'],/^[\-−]/.test(raw));
  if(/^-?\d+$/.test(value))hints[match[0]]=value;
 }
 return hints;
}
function softwareContext(text,index){
 const boundary=/[。！？!?；;\n]|\.(?!\d)/;
 const sentence=text.slice(0,index).split(boundary).at(-1)+text.slice(index).split(boundary)[0];
 return /程序|软件|\b(?:program|software)\b/i.test(sentence);
}
function bookEditionContext(text,index,length){
 return /书(?:的)?[\s，,:]*$|\bbook(?:['’]s)?[\s,:]*$/i.test(text.slice(0,index))||/^\s+of\s+(?:(?:the|this|that|a)\s+)?book\b/i.test(text.slice(index+length));
}
function facts(value,{sourceDays=[],sourceTimes=[]}={}){
 let text=normalizeIsotopes(normalizeExplicitZero(normalizeLimitCardinals(normalizeComponentCounts(normalizeDurationCardinals(normalizeCountCardinals(normalizeCalendarOrdinals(String(value).normalize('NFKC'))))))));const dates=[],times=[],numbers=[],days=[],editions=[],softwareVersions=[],monthRanges=[],clockRanges=[],componentOrdinals=[],componentRanges=[],pointOrdinals=[],symbols=[];
 text=scientificSymbols(text,symbols);
 const componentOrdinal=number=>{componentOrdinals.push(Number(number));return ' ';};
 const componentRange=(first,last)=>{componentRanges.push(Number(first)+':'+Number(last));return componentOrdinal(first)+componentOrdinal(last);};
 // A component range owns both ordered endpoints. Chinese may omit the
 // repeated head only after an explicit component in the same semicolon
 // clause, and only in the observed continuation predicate, never a new head.
 text=text.replace(/第\s*(\d+)\s*个?\s*(?:(?:主)?成分\s*)?(?:到|至|[-–—])\s*第?\s*(\d+)\s*个?\s*((?:主)?成分)?/g,(match,first,last,head,index,original)=>{
  const clause=original.slice(0,index).split(/[。！？!?；;\n]|\.(?!\d)/).at(-1);
  if(!head&&(!/(?:主)?成分/.test(clause)||!/^\s*继续/.test(original.slice(index+match.length))))return match;
  return componentRange(first,last);
 });
 text=text.replace(new RegExp('(?<![A-Za-z0-9./\\-\\u2010-\\u2015−])\\b('+scopedOrdinalPattern+')(?:\\s+(?:principal\\s+)?component)?\\s+(?:to|through)\\s+(?:the\\s+)?('+scopedOrdinalPattern+')\\s+(?:principal\\s+)?component\\b','gi'),(match,first,last,index,original)=>{
  if(unsupportedOrdinalPrefix(original.slice(0,index)))return match;
  return componentRange(scopedOrdinalValue(first),scopedOrdinalValue(last));
 });
 text=text.replace(/第\s*(\d+)\s*个?\s*(?:主)?成分/g,(_,number)=>componentOrdinal(number));
 text=text.replace(new RegExp('(?<![A-Za-z0-9./\\-\\u2010-\\u2015−])\\b('+scopedOrdinalPattern+')\\s+(?:principal\\s+)?component\\b','gi'),(match,word,index)=>{
  // A supported ordinal must be the whole value, not the suffix of an
  // unsupported 103rd/33rd, negative or fractional lexical expression.
  const prefix=text.slice(0,index);
  if(unsupportedOrdinalPrefix(prefix))return match;
  return componentOrdinal(scopedOrdinalValue(word));
 });
 const pointOrdinal=number=>{pointOrdinals.push(Number(number));return ' ';};
 text=text.replace(/第\s*(\d+)\s*个?\s*点/g,(_,number)=>pointOrdinal(number));
 text=text.replace(new RegExp('(?<![A-Za-z0-9./\\-\\u2010-\\u2015−])\\b('+scopedOrdinalPattern+')\\s+point\\b','gi'),(match,word,index,original)=>unsupportedOrdinalPrefix(original.slice(0,index))?match:pointOrdinal(scopedOrdinalValue(word)));
 const edition=(number,index,original,length)=>{(softwareContext(original,index)&&!bookEditionContext(original,index,length)?softwareVersions:editions).push(Number(number));return ' ';};
 text=text.replace(/第\s*(\d+)\s*版/g,(match,number,index,original)=>edition(number,index,original,match.length));
 text=text.replace(new RegExp('(?<![A-Za-z-])\\b('+calendarOrdinals.map(word=>word.replace('-','[- ]')).join('|')+'|\\d+(?:st|nd|rd|th))\\s+(?:revised\\s+)?edition\\b','gi'),(match,word,index,original)=>edition(/^\d/.test(word)?parseInt(word,10):ordinalNumber(word),index,original,match.length));
 text=text.replace(/\bedition\s+(?:no\.?\s*)?(\d+)\b/gi,(match,number,index,original)=>edition(number,index,original,match.length));
 text=text.replace(/\bversion\s+(\d+)\b(?![\w/−\u2010-\u2015-]|\.[A-Za-z0-9])/gi,(match,number,index,original)=>softwareContext(original,index)&&!bookEditionContext(original,index,match.length)?edition(number,index,original,match.length):match);
 const date=(year,month,day)=>{dates.push({year:year?Number(year):null,month:Number(month),day:day?Number(day):null});return ' ';};
 // An explicit same-month range owns its year at both endpoints. Parse it
 // before individual dates so the trailing year cannot become an unrelated
 // quantity, as in "November 17–18, 2020". Reversed ranges remain unparsed.
 const dateRange=(match,year,month,first,last)=>Number(first)>=1&&Number(last)<=31&&Number(first)<=Number(last)?date(year,month,first)+date(year,month,last):match;
 // Cross-month ranges bind the stated year to both endpoints. Never borrow a
 // year from another sentence or accept reversed ranges through loose dates.
 const crossMonthRange=(match,year,firstMonth,firstDay,lastMonth,lastDay)=>{
  const y=Number(year),m1=Number(firstMonth),d1=Number(firstDay),m2=Number(lastMonth),d2=Number(lastDay);
  const valid=(m,d)=>m>=1&&m<=12&&d>=1&&d<=new Date(Date.UTC(y,m,0)).getUTCDate();
  if(!valid(m1,d1)||!valid(m2,d2)||m1*32+d1>=m2*32+d2)throw failure('Translation contains an invalid or reversed calendar range');
  return date(y,m1,d1)+date(y,m2,d2);
 };
 // A fully repeated year is another spelling of the same range, not license
 // to reverse its endpoints. Independently stated different years remain
 // typed dates and must still match the source's years exactly.
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{1,2}),\\s*(\\d{4})\\s*(?:to|[-–—])\\s*('+monthPattern+')\\s+(\\d{1,2}),\\s*(\\d{4})\\b','gi'),(match,m1,d1,y1,m2,d2,y2)=>{
  if(y1===y2)return crossMonthRange(match,y1,monthNumber(m1),d1,monthNumber(m2),d2);
  return match;
 });
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?\s*(?:至|到|[-–—])\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/g,(match,y,m1,d1,m2,d2)=>crossMonthRange(match,y,m1,d1,m2,d2));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{1,2})\\s*(?:to|[-–—])\\s*('+monthPattern+')\\s+(\\d{1,2}),\\s*(\\d{4})\\b','gi'),(match,m1,d1,m2,d2,y)=>crossMonthRange(match,y,monthNumber(m1),d1,monthNumber(m2),d2));
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:日|号)/g,(match,y,m,first,last)=>dateRange(match,y,m,first,last));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}),\\s*(\\d{4})\\b','gi'),(match,m,first,last,y)=>dateRange(match,y,monthNumber(m),first,last));
 const monthPair=(y1,m1,y2,m2,connector)=>{
  if(![m1,m2].every(m=>Number(m)>=1&&Number(m)<=12))throw failure('Translation contains an invalid month');
  if(!/^(?:、|和|与|and)$/i.test(connector))monthRanges.push([Number(y1),Number(m1),Number(y2),Number(m2)].join(':'));
  return date(y1,m1,null)+date(y2,m2,null);
 };
 // Only an explicit two-month expression shares its year. Enumerations retain
 // two dates; ranges additionally retain their ordered endpoint pair.
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月\s*(至|到|[-–—]|、|和|与)\s*(\d{4})\s*年\s*(\d{1,2})\s*月/g,(_,y1,m1,c,y2,m2)=>monthPair(y1,m1,y2,m2,c));
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月?\s*(至|到|[-–—]|、|和|与)\s*(\d{1,2})\s*月/g,(_,y,m1,c,m2)=>monthPair(y,m1,y,m2,c));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{4})\\s*(to|and|[-–—])\\s*('+monthPattern+')\\s+(\\d{4})\\b','gi'),(_,m1,y1,c,m2,y2)=>monthPair(y1,monthNumber(m1),y2,monthNumber(m2),c));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s*(to|and|[-–—])\\s*('+monthPattern+'),?\\s+(\\d{4})\\b','gi'),(_,m1,c,m2,y)=>monthPair(y,monthNumber(m1),y,monthNumber(m2),c));
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/g,(_,y,m,d)=>date(y,m,d));
 text=text.replace(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g,(_,y,m,d)=>date(y,m,d));
 text=text.replace(/\b(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/g,(_,m,d)=>date(null,m,d));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b','gi'),(_,m,d,y)=>date(y,monthNumber(m),d));
 text=text.replace(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+('+monthPattern+')(?:,?\\s+(\\d{4}))?\\b','gi'),(_,d,m,y)=>date(y,monthNumber(m),d));
 text=text.replace(/\b(\d{4})\s*年\s*(\d{1,2})\s*月/g,(_,y,m)=>date(y,m,null));
 text=text.replace(new RegExp('\\b('+monthPattern+')\\s+(\\d{4})\\b','gi'),(_,m,y)=>date(y,monthNumber(m),null));
 text=text.replace(/\b(\d{1,2})\s*月/g,(_,m)=>date(null,m,null));
 // Standalone month names are proper nouns: lowercase "may" is a modal,
 // not an invented calendar fact in an otherwise numeric sentence.
 text=text.replace(new RegExp('\\b('+properMonthPattern+')(?![A-Za-z])','g'),(_,m)=>date(null,monthNumber(m),null));
 const time=(hour,minute,second,period)=>{let h=Number(hour);if(period){if(/^(?:p|下午|晚上|中午)/i.test(period)){if(h<12)h+=12;}else if(h===12)h=0;}times.push([h,Number(minute||0),Number(second||0)].join(':'));return ' ';};
 const clockRange=(h1,p1,h2,p2,m1=0,s1=0,m2=0,s2=0)=>{
  if(![[h1,p1,m1,s1],[h2,p2,m2,s2]].every(([h,p,m,s])=>Number(h)>=(p?1:0)&&Number(h)<=(p?12:23)&&Number(m)>=0&&Number(m)<60&&Number(s)>=0&&Number(s)<60))throw failure('Translation contains an invalid explicit clock range');
  time(h1,m1,s1,p1);time(h2,m2,s2,p2);clockRanges.push(times.at(-2)+'>'+times.at(-1));return ' ';
 };
 // Noon and midnight are complete clock endpoints. Parse their explicit
 // ranges before consuming individual times, without assigning AM/PM to a bare hour.
 const namedClockEndpoint='(?:noon|midnight|\\d{1,2}(?::\\d{2}(?::\\d{2})?)?\\s*[ap]\\.?m\\.?|\\d{1,2}:\\d{2}(?::\\d{2})?)';
 text=text.replace(new RegExp('(?<![A-Za-z0-9.:+−-])\\b(between\\s+)?('+namedClockEndpoint+')\\s*(to|and|[-–—])\\s*('+namedClockEndpoint+')(?![A-Za-z0-9:]|\\.\\d)','gi'),(match,between,first,connector,last)=>{
  if(!/\b(?:noon|midnight)\b/i.test(first+' '+last)||connector.toLowerCase()==='and'&&!between)return match;
  const endpoint=value=>{
   if(/^(?:noon|midnight)$/i.test(value))return [value.toLowerCase()==='noon'?12:0,undefined,0,0];
   const [,h,m,s,p]=value.match(/^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*([ap]\.?m\.?)?$/i);return [h,p,m||0,s||0];
  };
  const [h1,p1,m1,s1]=endpoint(first),[h2,p2,m2,s2]=endpoint(last);return clockRange(h1,p1,h2,p2,m1,s1,m2,s2);
 });
 text=text.replace(/(?<![A-Za-z0-9.:−-])\b(between\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*(to|and|[-–—])\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?![A-Za-z0-9:])/gi,(match,between,h1,m1,s1,p1,c,h2,m2,s2,p2)=>c.toLowerCase()==='and'&&!between?match:clockRange(h1,p1||p2,h2,p2||p1,m1,s1||0,m2,s2||0));
 text=text.replace(/(上午|下午|晚上|早上|凌晨|中午)\s*(\d{1,2})\s*(?:时|点)\s*(?:到|至|[-–—])\s*(上午|下午|晚上|早上|凌晨|中午)?\s*(\d{1,2})\s*(?:时|点)/g,(_,p1,h1,p2,h2)=>clockRange(h1,p1,h2,p2||p1));
 text=text.replace(/(?<![A-Za-z0-9.−-])\b(between\s+)?(\d{1,2})\s*([ap]\.?m\.?)\s*(to|and|[-–—])\s*(\d{1,2})\s*([ap]\.?m\.?)(?![A-Za-z])/gi,(match,between,h1,p1,c,h2,p2)=>c.toLowerCase()==='and'&&!between?match:clockRange(h1,p1,h2,p2));
 text=text.replace(/(?<![A-Za-z0-9.−-])\b(between\s+)?(\d{1,2})\s*(to|and|[-–—])\s*(\d{1,2})\s*([ap]\.?m\.?)(?![A-Za-z])/gi,(match,between,h1,c,h2,p)=>c.toLowerCase()==='and'&&!between?match:clockRange(h1,p,h2,p));
 text=text.replace(/(?:上午|下午|晚上|早上|凌晨|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/gi,match=>{const parts=match.match(/^(上午|下午|晚上|早上|凌晨|中午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);return time(parts[2],parts[3],parts[4],parts[1]||parts[5]);});
 text=text.replace(/\b(\d{1,2})\s*([ap]\.?m\.?)\b/gi,(_,h,p)=>time(h,0,0,p));
 text=text.replace(/(上午|下午|晚上|早上|凌晨|中午)?\s*(\d{1,2})(?:时|点)(?:(\d{1,2})分?)?/g,(_,p,h,m)=>time(h,m,0,p));
 if(sourceTimes.length||times.length)text=text.replace(/\b(noon|midnight)\b/gi,(_,word)=>time(word.toLowerCase()==='noon'?12:0,0,0));
 for(const match of text.matchAll(/(?:星期|周|礼拜)([一二三四五六日天])/g))days.push(Math.min(6,'一二三四五六日天'.indexOf(match[1])));
 for(const match of text.matchAll(weekdayPattern))days.push(weekdays.findIndex(day=>day.startsWith(match[1].toLowerCase().replace(/\.$/,''))));
 // "sun" and "sat" are also ordinary words. Abbreviations require a
 // calendar context or an explicitly supplied source weekday.
 if(dates.length||days.length||sourceDays.length)for(const match of text.matchAll(weekdayAbbreviations))days.push(weekdays.findIndex(day=>day.startsWith(match[1].toLowerCase())));
 let previousEnd=-1;const quantities=[];
 for(const match of text.matchAll(numberPattern)){
  const magnitude=match[1]?.toLowerCase(),raw=magnitude?match[0].slice(0,-match[1].length).trim().replace(/[-\u2010\u2011]$/,'').trim():match[0];
  // A hyphen following another number is a range separator, not a sign.
  const continuesRange=previousEnd>=0&&!text.slice(previousEnd,match.index).trim();
  const negative=/^[\-−]/.test(raw)&&!continuesRange;
  const tail=text.slice(match.index+match[0].length),prefix=text.slice(0,match.index);
  const points=/^(?:\s*个?百分点|\s*-?\s*(?:percentage|percent)[ -]points?\b|\s*(?:pp\b|p\.p\.))/i.test(tail);
  const percent=!points&&(/^\s*(?:%|per\s+cent\b|percent\b)/i.test(tail)||/百分之\s*$/.test(prefix));
  const kind=points?'percentage-points':percent?'percent':'number';
  // A trailing unit can serve both endpoints: "8–22 percentage points",
  // "9 和 7 个百分点", or "70 to 80 percent". Only explicit connectors
  // carry that unit back; unrelated neighboring quantities stay independent.
  const prior=quantities.at(-1),connector=previousEnd<0?'':text.slice(previousEnd,match.index);
  const range=/^[\-−]/.test(raw)&&continuesRange||/^\s*(?:至|到|[-–—~]|to)\s*$/i.test(connector)||/^\s*and\s*$/i.test(connector)&&/\bbetween\s*$/i.test(text.slice(0,prior?.index));
  const shared=range||kind==='percentage-points'&&/^\s*(?:和|与|及|、|and|or|,)\s*$/i.test(connector);
  if(kind!=='number'&&prior?.kind==='number'&&shared)prior.kind=kind;
  quantities.push({raw,power:magnitudes[magnitude]||0,negative,kind,index:match.index});
  previousEnd=match.index+match[0].length;
 }
 for(const quantity of quantities)numbers.push((quantity.kind==='percentage-points'?'pp:':'')+decimal(quantity.raw,quantity.power-(quantity.kind==='percent'?2:0),quantity.negative));
 const currency=new Set(currencies.filter(([,pattern])=>[...text.matchAll(pattern)].length).map(([name])=>name));
 return {dates,times,numbers,days,editions,softwareVersions,monthRanges,clockRanges,componentOrdinals,componentRanges,pointOrdinals,symbols,currency,text};
}
function retain(source,translated,label,equal=(a,b)=>a===b){
 const remaining=[...translated];for(const value of source){const index=remaining.findIndex(other=>equal(value,other));if(index<0)throw failure('Translation omitted or changed '+label);remaining.splice(index,1);}
}
export function validateTranslationFacts(source,translated){
 const original=facts(source),output=facts(translated,{sourceDays:original.days,sourceTimes:original.times});
 validateTranslationTerminology(source,translated);
 retain([...new Set(original.symbols)],[...new Set(output.symbols)],'a scientific symbol identity');
 const symbolFamily=value=>value.replace(/\d+/g,'#'),families=new Set(original.symbols.map(symbolFamily));
 if(output.symbols.some(symbol=>families.has(symbolFamily(symbol))&&!original.symbols.includes(symbol)))throw failure('Translation introduced a changed scientific symbol identity');
 retain(original.editions,output.editions,'an edition ordinal');
 retain(original.softwareVersions,output.softwareVersions,'a software version');
 retain(original.componentOrdinals,output.componentOrdinals,'a component ordinal');
 retain(original.componentRanges,output.componentRanges,'an ordered component range');
 retain(original.pointOrdinals,output.pointOrdinals,'a point ordinal');
 retain(original.numbers,output.numbers,'a numeric quantity or range endpoint');
 retain(original.dates,output.dates,'a calendar date',(a,b)=>a.month===b.month&&a.day===b.day&&(a.year===null||a.year===b.year));
 retain(original.monthRanges,output.monthRanges,'an ordered month range');
 retain(original.times,output.times,'a clock time');
 retain(original.clockRanges,output.clockRanges,'an ordered clock range');
 // A translator must never infer a weekday, even if it happens to be correct.
 retain(output.days,original.days,'a weekday absent from the source');
 retain(original.days,output.days,'a source weekday');
 for(const currency of original.currency){
  const symbol=!output.currency.size&&(currency==='USD'&&/(?<![A-Z])\$/.test(output.text)||['JPY','CNY'].includes(currency)&&/[¥￥]/.test(output.text));
  if(!output.currency.has(currency)&&!symbol)throw failure('Translation omitted or changed a currency');
 }
 return {version:translationFactsVersion,checks:['explicit-numeric-facts','scientific-symbol-identities','edition-ordinals','software-versions','component-ordinals','ordered-component-ranges','point-ordinals','dates','ordered-month-ranges','times','ordered-clock-ranges','no-invented-weekdays','currencies','known-translation-terminology']};
}
