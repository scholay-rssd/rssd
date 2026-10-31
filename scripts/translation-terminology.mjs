// Small, named terminology corrections verified against the source or the
// owner's brand record. This is not a general semantic-equivalence checker.
const thermomechanical=/\bthermo[\s\u2010-\u2015-]*mechanical\b/i;
const electronPhotonFusion=/\belectron[\s\u2010-\u2015-]+photon\s+fusion\b/i;
const yoshimoriNishimura=/\bYoshimori\s+Nishimura\b/i;
const huangshiNationalPark=/\bHuangshi\s+National\s+Park\b/i;
const upToDecadeBeforeDiagnosis=/\bup\s+to\s+(?:a|one)\s+decade\s+before\s+(?:the\s+)?diagnosis\b/i;
const shakibAlHasan=/\bShakib\s+Al[\s\u2010-\u2015-]+Hasan\b/i;
// The Book of Changes chapter headings in the Chinese Text Project give these
// pinyin names. Only explicit titled works activate these observed-error guards;
// legitimate English title translations are not required to use this spelling.
const namedWork=({source,preferred,rejected,targetAlongside,reference})=>Object.freeze({
 id:'book-of-changes-'+reference,source,preferred,rejected,targetAlongside,
 matchesSource:text=>text.includes('《'+source+'》'),sourceEvidence:text=>rejected.test(text),
 error:'Translation changed '+source+' into an unsupported named-work transliteration',
});
const knownTerms=Object.freeze([
 // The observed medical-score caption dropped this explicit Latin identity.
 // This guard is source-triggered; it does not generalize ordinary "score".
 Object.freeze({id:'karnofsky',source:'Karnofsky',preferred:'Karnofsky',
  matchesSource:source=>/\bKarnofsky\b/.test(source),required:/\bKarnofsky\b/i,
  error:'Translation omitted the explicit Karnofsky score identity'}),
 // ICC's player profile and the Bangladesh Cricket Board confirm this name:
 // https://www.icc-cricket.com/rankings/3782/shakib-al-hasan
 // https://www.tigercricket.com.bd/public/detail/under-the-spotlight-shakib-al-hasan
 Object.freeze({id:'shakib-al-hasan',source:'沙基布·阿尔·哈桑',preferred:'Shakib Al Hasan',required:shakibAlHasan,rejected:/\bShahidul\s+Alam\b/i,
  sourceEvidence:source=>/\bShahidul\s+Alam\b/i.test(source),targetAlongside:shakibAlHasan,
  error:'Translation omitted or changed the explicit Shakib Al Hasan identity'}),
 Object.freeze({id:'thermal',source:'热学',preferred:'thermal',rejected:thermomechanical,
  sourceEvidence:source=>/热[\s—–-]*机械|热[\s—–-]*力[\s—–-]*耦合/.test(source)||thermomechanical.test(source),
  error:'Translation changed thermal terminology into unsupported thermomechanical terminology'}),
 Object.freeze({id:'royce-institute',source:'罗伊斯研究所',preferred:'Royce Institute',rejected:/\bRoche\s+Institute\b/i,
  sourceEvidence:source=>/罗氏|\bRoche\b/i.test(source),targetAlongside:/\b(?:Henry\s+)?Royce\s+Institute\b/i,
  error:'Translation changed Royce Institute into unsupported Roche Institute'}),
 // Westlake University's own Pinal research announcement identifies its team:
 // https://en.westlake.edu.cn/news_events/westlakenews/research/202610/t20261023_70614.html
 Object.freeze({id:'westlake-university',source:'西湖大学',preferred:'Westlake University',rejected:/\bXiamen\s+University\b/i,
  sourceEvidence:source=>/厦门大学|廈門大學|\bXiamen\s+University\b/i.test(source),targetAlongside:/\bWestlake\s+University\b/i,
  error:'Translation changed Westlake University into unsupported Xiamen University'}),
 Object.freeze({id:'electronic-photonic-technologies',source:'电子—光子融合技术',preferred:'convergent electronic-photonic technologies',rejected:electronPhotonFusion,
  sourceEvidence:source=>electronPhotonFusion.test(source)||/电子[\s—–-]*光子(?:的)?(?:物理融合|融合反应|融合物理过程)/.test(source),targetAlongside:/\belectronic[\s\u2010-\u2015-]+photonic\b/i,
  error:'Translation changed electronic-photonic technologies into unsupported electron-photon fusion'}),
 Object.freeze({id:'enterscholar',source:'恩特学术',preferred:'EnterScholar',rejected:/\bEnTe\s+Academic\b/i,
  sourceEvidence:source=>/\bEnTe\s+Academic\b/i.test(source),targetAlongside:/\bEnterScholar\b/i,
  error:'Translation changed EnterScholar into unsupported EnTe Academic'}),
 // NIMS investigation, pp. 4 and 6; the listed paper also has a NIMS SAMURAI record:
 // https://www.nims.go.jp/news/2026/09/flce2o0000008e7x-att/202609290.pdf
 // https://samurai.nims.go.jp/articles/23faf0c2-580d-4d0c-90b1-0ee81d437191
 Object.freeze({id:'toshiyasu-nishimura',source:'西村俊弥',preferred:'Toshiyasu Nishimura',rejected:yoshimoriNishimura,
  sourceEvidence:source=>yoshimoriNishimura.test(source),targetAlongside:/\b(?:Toshiyasu\s+Nishimura|Nishimura,?\s+Toshiyasu)\b/i,
  error:'Translation changed Toshiyasu Nishimura into unsupported Yoshimori Nishimura'}),
 // Exact observed qualifier reversal; this is not a general inequality parser.
 Object.freeze({id:'more-than-decade-before-diagnosis',source:'确诊前十余年',preferred:'more than a decade before diagnosis',rejected:upToDecadeBeforeDiagnosis,
  sourceEvidence:source=>upToDecadeBeforeDiagnosis.test(source)||/确诊前(?:最多|至多|不超过)(?:十|10)年/.test(source),
  targetAlongside:/\b(?:more\s+than|over)\s+(?:(?:a|one)\s+decade|(?:ten|10)\s+years)\s+before\s+(?:the\s+)?diagnosis\b/i,
  error:'Translation reversed more than a decade before diagnosis into an upper bound'}),
 // NPS uses both names on its own Chinese visitor page:
 // https://www.nps.gov/yell/planyourvisit/yellowstonepledge-chinese.htm
 Object.freeze({id:'yellowstone-national-park',source:'黄石国家公园',preferred:'Yellowstone National Park',rejected:huangshiNationalPark,
  sourceEvidence:source=>huangshiNationalPark.test(source),targetAlongside:/\bYellowstone\s+National\s+Park\b/i,
  error:'Translation changed Yellowstone National Park into unsupported Huangshi National Park'}),
 // https://ctext.org/book-of-changes/xi-ci-shang
 namedWork({source:'系辞',preferred:'Xi Ci',rejected:/\bXieci\b/i,targetAlongside:/\bXi[\s\u2010-\u2015-]*Ci\b/i,reference:'xi-ci'}),
 // https://ctext.org/book-of-changes/shuo-gua
 namedWork({source:'说卦',preferred:'Shuo Gua',rejected:/\bShuagu\b/i,targetAlongside:/\bShuo[\s\u2010-\u2015-]*Gua\b/i,reference:'shuo-gua'}),
 // https://ctext.org/book-of-changes/xu-gua
 namedWork({source:'序卦',preferred:'Xu Gua',rejected:/\bXugu\b/i,targetAlongside:/\bXu[\s\u2010-\u2015-]*Gua\b/i,reference:'xu-gua'}),
 // https://ctext.org/book-of-changes/za-gua
 namedWork({source:'杂卦',preferred:'Za Gua',rejected:/\b(?:Zhaga|Zhaogua)\b/i,targetAlongside:/\bZa[\s\u2010-\u2015-]*Gua\b/i,reference:'za-gua'}),
]);
const matchingTerms=source=>knownTerms.filter(term=>String(source).includes(term.source)&&(!term.matchesSource||term.matchesSource(String(source))));
const equivalent=value=>value.trim().replace(/\s+/g,' ').toLowerCase();

export function translationTerminology(source,operatorGlossary={}){
 const glossary=Object.fromEntries(Object.entries(operatorGlossary).filter(([term])=>source.includes(term))),matching=matchingTerms(source);
 for(const term of matching){
  if(Object.hasOwn(glossary,term.source)&&equivalent(glossary[term.source])!==equivalent(term.preferred))throw Object.assign(Error('Translation glossary conflicts with the built-in '+term.source+' → '+term.preferred+' equivalent'),{code:'FLOW_LANGUAGE_CONFIG',statusCode:400});
  if(!Object.hasOwn(glossary,term.source))glossary[term.source]=term.preferred;
 }
 return {glossary,hasBuiltIn:matching.length>0};
}

export function validateTranslationTerminology(source,translated){
 for(const term of matchingTerms(source)){
  if(term.required&&!term.required.test(translated))throw Object.assign(Error(term.error),{code:'FLOW_LANGUAGE_FACTS',statusCode:502});
  if(!term.rejected?.test(translated))continue;
  // A source can name both institutions or kinds of technology, or explicitly
  // discuss a misspelling. Retain that evidence and the intended name alongside it.
  if(term.sourceEvidence?.(source)&&(!term.targetAlongside||term.targetAlongside.test(translated)))continue;
  throw Object.assign(Error(term.error),{code:'FLOW_LANGUAGE_FACTS',statusCode:502});
 }
}
