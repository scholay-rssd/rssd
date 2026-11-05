import test from 'node:test';
import assert from 'node:assert/strict';
import {translationTerminology,validateTranslationTerminology} from '../scripts/translation-terminology.mjs';

const source='体例上，程传采用王弼本的经传编排，即把《彖传》《象传》分附于各卦经文之下，乾、坤两卦另附《文言》。程颐只为六十四卦的卦爻辞及这些随经的传文作解，没有为《系辞》《说卦》《序卦》《杂卦》单独作传；不过除乾卦外，各卦卦首都先引《序卦》说明此卦为何接在前一卦之后，再解释卦名与卦义。今天通行的整理本是王孝鱼点校的《二程集》（中华书局，1981年初版，收入“理学丛书”；2004年第2版），其中《周易程氏传》分为四卷；程颐讨论易学方法的书信，如《答张闳中书》，收在同书《河南程氏文集》卷九。';
const outputs=[
 'In terms of structure, Cheng Chuan adopted the arrangement of the Wang Bi edition, placing the "Tuan Tradition" and "Xiang Tradition" attached to the texts of each hexagram, and separately attaching the "Wenyan" to the two hexagrams, Qian and Kun. Cheng Yi only provided explanations for the hexagram and line statements of the sixty-four hexagrams and the accompanying commentaries, without composing separate commentaries on the "Xieci," "Shuagu," "Xugu," or "Zhaogua." However, except for the Qian hexagram, for each hexagram the "Xugu" is first cited to explain why the hexagram follows the previous one, followed by an explanation of the hexagram\'s name and meaning. The currently circulated edition is the edited version of the "Er Cheng Ji" by Wang Xiaoyu (published initially by Zhonghua Book Company in 1981, included in the "Li Xue Series"; second edition in 2004), in which the "Zhou Yi Chengshi Zhuan" is divided into four volumes. Cheng Yi\'s letters discussing his methodology in studying the Book of Changes, such as "Reply to Zhang Hongzhong," are included in the same volume, "Henan Chengshi Wenji," Volume Nine.',
 'In terms of structure, Cheng Chuan adopted the arrangement of the Wang Bi edition, placing the \'Tuan Tradition\' and \'Xiang Tradition\' attached to the texts of each hexagram, and separately attaching the \'Wenyan\' to the Qian and Kun hexagrams. Cheng Yi only provided explanations for the hexagram and line statements of the sixty-four hexagrams and the accompanying commentaries, without composing separate commentaries on the \'Xieci\', \'Shuagu\', \'Xugu\', or \'Zhaga\'. However, except for the Qian hexagram, each hexagram begins with a quotation from the \'Xugu\' explaining why the hexagram follows the previous one, followed by an explanation of the hexagram\'s name and meaning. The currently widely circulated edition is Wang Xiaoyu\'s edited version of the \'Er Cheng Ji\' (published by Zhonghua Book Company, first edition in 1981, included in the \'Li Xue Series\'; second edition in 2004), in which the \'Zhou Yi Chengshi Zhuan\' is divided into four volumes. Cheng Yi\'s letters discussing his methodology in studying the Book of Changes, such as \'Reply to Zhang Hongzhong\', are included in the same volume, \'Henan Chengshi Wenji\', Volume Nine.',
];
const mappings={'系辞':'Xi Ci','说卦':'Shuo Gua','序卦':'Xu Gua','杂卦':'Za Gua'};
const wrong=[['系辞','Xieci'],['说卦','Shuagu'],['序卦','Xugu'],['杂卦','Zhaga'],['杂卦','Zhaogua']];
const rejects=(text,translation)=>assert.throws(()=>validateTranslationTerminology(text,translation),error=>error.code==='FLOW_LANGUAGE_FACTS'&&error.statusCode===502);

test('real Cheng Yi passage supplies all four source-backed chapter names',()=>{
 assert.deepEqual(translationTerminology(source),{glossary:mappings,hasBuiltIn:true});
 for(const output of outputs){
  rejects(source,output);
  const corrected=output.replaceAll('Xieci','Xi Ci').replaceAll('Shuagu','Shuo Gua').replaceAll('Xugu','Xu Gua').replace(/Zhaga|Zhaogua/g,'Za Gua');
  assert.doesNotThrow(()=>validateTranslationTerminology(source,corrected));
 }
});

for(const [name,misspelling] of wrong)test(name+' rejects observed '+misspelling+' without requiring one English title style',()=>{
 const text='程颐没有为《'+name+'》单独作传。';
 rejects(text,'Cheng Yi wrote no separate commentary on '+misspelling+'.');
 rejects(text,'Cheng Yi wrote no separate commentary on '+misspelling.toUpperCase()+'.');
 for(const spelling of [mappings[name],mappings[name].replace(' ',''),mappings[name].replace(' ','-')]){
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Cheng Yi wrote no separate commentary on '+spelling+'.'));
 }
});

test('only explicit matching titles activate built-in named-work hints and guards',()=>{
 assert.deepEqual(translationTerminology('各卦先引《序卦》说明次序。'),{glossary:{'序卦':'Xu Gua'},hasBuiltIn:true});
 for(const text of ['作者谈经传编排与说卦的方法。','这里讨论另一位学者。','这里讨论《序卦补说》。']){
  assert.deepEqual(translationTerminology(text),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Xieci Shuagu Xugu Zhaga Zhaogua'));
 }
 assert.doesNotThrow(()=>validateTranslationTerminology('《系辞》属于经传。','The Great Treatise belongs to the classic and its commentaries.'));
 // A title for one work does not activate the other three work-name guards.
 assert.doesNotThrow(()=>validateTranslationTerminology('《系辞》与别的话题。','Xi Ci and Shuagu, Xugu, Zhaga.'));
});

test('wrong-looking substrings inside unrelated names do not trigger work-name guards',()=>{
 for(const [name,misspelling] of wrong)assert.doesNotThrow(()=>validateTranslationTerminology('讨论《'+name+'》。',mappings[name]+' is discussed by '+misspelling+'son.'));
});

test('an explicit source discussion of a misspelling preserves it alongside the intended title',()=>{
 for(const [name,misspelling] of wrong){
  const text='《'+name+'》曾被误写为 '+misspelling+'。';
  assert.doesNotThrow(()=>validateTranslationTerminology(text,mappings[name]+' was misspelled '+misspelling+'.'));
  rejects(text,'The work was called '+misspelling+'.');
  rejects('讨论《'+name+'》。',mappings[name]+' was also called '+misspelling+'.');
 }
});

test('operator mappings merge with chapter names and conflicts fail explicitly',()=>{
 const operator={'程颐':'Cheng Yi','系辞':'Xi Ci','罗伊斯研究所':'Royce Institute'};
 assert.deepEqual(translationTerminology(source,operator),{glossary:{'程颐':'Cheng Yi',...mappings},hasBuiltIn:true});
 for(const [name,misspelling] of wrong){
  assert.throws(()=>translationTerminology('《'+name+'》',{[name]:misspelling}),error=>error.code==='FLOW_LANGUAGE_CONFIG'&&error.statusCode===400&&error.message.includes(name));
  assert.equal(translationTerminology('《'+name+'》',{[name]:' '+mappings[name].toUpperCase()+' '}).glossary[name],' '+mappings[name].toUpperCase()+' ');
 }
 assert.deepEqual(operator,{'程颐':'Cheng Yi','系辞':'Xi Ci','罗伊斯研究所':'Royce Institute'});
});

const nimsSource='2026年9月29日，日本物质·材料研究机构（NIMS）公布调查结果：前博士后研究员 Joseph Raj Xavier 在2014—2017年署名 NIMS 的7篇金属腐蚀论文中捏造、篡改显微图像，其中6篇另被认定自我盗用。前组长西村俊弥未参与不正行为，但被认定负有指导责任。';
const nimsOutput='On September 29, 2026, the National Institute for Materials Science (NIMS) in Japan announced investigation results: former postdoctoral researcher Joseph Raj Xavier fabricated and altered microscopic images in seven metal corrosion papers he authored at NIMS between 2014 and 2017, with six of these papers additionally identified as cases of self-plagiarism. Former group leader Yoshimori Nishimura did not participate in the misconduct but was deemed to have responsibility for supervision.';

test('real NIMS investigation fragment retains the officially documented Toshiyasu Nishimura name',()=>{
 assert.deepEqual(translationTerminology(nimsSource),{glossary:{'西村俊弥':'Toshiyasu Nishimura'},hasBuiltIn:true});
 rejects(nimsSource,nimsOutput);
 for(const name of ['Toshiyasu Nishimura','Nishimura Toshiyasu','NISHIMURA, Toshiyasu'])assert.doesNotThrow(()=>validateTranslationTerminology(nimsSource,nimsOutput.replace('Yoshimori Nishimura',name)));
});

test('the complete NIMS name receives the hint in each real source occurrence without generalizing Japanese names',()=>{
 for(const text of [nimsSource,
  '两名被调查者都已离开 NIMS。Xavier 曾在 NIMS 任博士后研究员，现属印度金奈的 Saveetha Institute of Medical and Technical Sciences；西村俊弥曾任 NIMS 研究组组长，现已退休。',
  '西村俊弥在这些论文上的署名分两种情况。论文2由他担任责任作者，委员会认定他没有参与不正行为，但与 Xavier 沟通不足、对稿件审阅不够，因此负有指导责任。论文3至8是 Xavier 离开 NIMS 后投出的，委员会认定 Xavier 擅自把西村列为共同作者。',
 ])assert.deepEqual(translationTerminology(text),{glossary:{'西村俊弥':'Toshiyasu Nishimura'},hasBuiltIn:true});
 for(const text of ['其他研究者讨论腐蚀。','西村谈到监督责任。','西村俊彦谈到监督责任。']){
  assert.deepEqual(translationTerminology(text),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Yoshimori Nishimura spoke about supervision.'));
 }
});

test('NIMS name guard preserves an explicitly separate source name while requiring the intended person alongside it',()=>{
 const text='西村俊弥与 Yoshimori Nishimura 是两个人。';
 assert.doesNotThrow(()=>validateTranslationTerminology(text,'Toshiyasu Nishimura and Yoshimori Nishimura are two people.'));
 rejects(text,'Yoshimori Nishimura is the person.');
 rejects('西村俊弥未参与不正行为。','Toshiyasu Nishimura, also called Yoshimori Nishimura, did not participate in the misconduct.');
});

test('NIMS name operator conflicts fail explicitly and unrelated operator terms remain available',()=>{
 for(const name of ['Yoshimori Nishimura','Toshiya Nishimura'])assert.throws(()=>translationTerminology(nimsSource,{'西村俊弥':name}),error=>error.code==='FLOW_LANGUAGE_CONFIG'&&error.statusCode===400&&error.message.includes('Toshiyasu Nishimura'));
 const operator={'西村俊弥':'Toshiyasu Nishimura','金属腐蚀':'metal corrosion','其他人':'someone else'};
 assert.deepEqual(translationTerminology(nimsSource,operator),{glossary:{'西村俊弥':'Toshiyasu Nishimura','金属腐蚀':'metal corrosion'},hasBuiltIn:true});
 assert.deepEqual(operator,{'西村俊弥':'Toshiyasu Nishimura','金属腐蚀':'metal corrosion','其他人':'someone else'});
});

test('real research title cannot reverse more than a decade into up to a decade',()=>{
 const text='三项新研究：病毒的深口袋、确诊前十余年的血蛋白、免疫治疗副作用的上游';
 const output='Three new studies: the deep pocket of viruses, blood proteins up to a decade before diagnosis, upstream factors of immune therapy side effects';
 assert.deepEqual(translationTerminology(text),{glossary:{'确诊前十余年':'more than a decade before diagnosis'},hasBuiltIn:true});
 rejects(text,output);
 for(const phrase of ['more than a decade before diagnosis','over a decade before diagnosis','more than 10 years before diagnosis'])assert.doesNotThrow(()=>validateTranslationTerminology(text,output.replace('up to a decade before diagnosis',phrase)));
 const body='《欧洲泌尿外科》在确诊前十余年采集的血浆里，找到与日后前列腺癌相关的蛋白。';
 assert.doesNotThrow(()=>validateTranslationTerminology(body,'European Urology identified a protein associated with future prostate cancer in plasma samples collected more than a decade before diagnosis.'));
});

test('diagnosis qualifier rule stays scoped and preserves a separately sourced upper bound',()=>{
 for(const text of ['确诊前最多十年采集血样。','十余年前采集血样。','诊断后十余年随访。']){
  assert.deepEqual(translationTerminology(text),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Samples were collected up to a decade before diagnosis.'));
 }
 const text='甲组在确诊前十余年采样，乙组在确诊前最多十年采样。';
 assert.doesNotThrow(()=>validateTranslationTerminology(text,'Group A was sampled more than a decade before diagnosis; group B was sampled up to a decade before diagnosis.'));
 rejects(text,'Both groups were sampled up to a decade before diagnosis.');
 rejects('甲组在确诊前十余年采样。','Group A was sampled more than a decade before diagnosis, or up to a decade before diagnosis.');
});

test('real bison blood caption retains the NPS Yellowstone name',()=>{
 const text='黄石国家公园工作人员正在处理一批从野牛身上采集的血液样本';
 const output='Staff at Huangshi National Park are processing a batch of blood samples collected from bison.';
 assert.deepEqual(translationTerminology(text),{glossary:{'黄石国家公园':'Yellowstone National Park'},hasBuiltIn:true});
 rejects(text,output);
 assert.doesNotThrow(()=>validateTranslationTerminology(text,output.replace('Huangshi National Park','Yellowstone National Park')));
});

test('Yellowstone guard does not rename other Huangshi places or discard an explicit source comparison',()=>{
 for(const text of ['黄石市的公园。','黄石国家矿山公园。','其他国家公园。']){
  assert.deepEqual(translationTerminology(text),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Huangshi National Park'));
 }
 const text='黄石国家公园不应与写作 Huangshi National Park 的名称混淆。';
 assert.doesNotThrow(()=>validateTranslationTerminology(text,'Yellowstone National Park must not be confused with the name Huangshi National Park.'));
 rejects(text,'The park is Huangshi National Park.');
 rejects('黄石国家公园。','Yellowstone National Park is also called Huangshi National Park.');
});

test('diagnosis and park mappings are fragment-scoped and operator conflicts remain explicit',()=>{
 for(const [term,preferred,wrongValue] of [
  ['确诊前十余年','more than a decade before diagnosis','up to a decade before diagnosis'],
  ['黄石国家公园','Yellowstone National Park','Huangshi National Park'],
 ]){
  const operator={[term]:preferred,'其他词':'another term'};
  assert.deepEqual(translationTerminology(term,operator),{glossary:{[term]:preferred},hasBuiltIn:true});
  assert.throws(()=>translationTerminology(term,{[term]:wrongValue}),error=>error.code==='FLOW_LANGUAGE_CONFIG'&&error.statusCode===400);
  assert.deepEqual(operator,{[term]:preferred,'其他词':'another term'});
 }
});

test('real Pinal fragment retains its officially identified Westlake University team',()=>{
 const text='西湖大学、香港科技大学（广州）、中国科学院深圳先进技术研究院等机构的团队在 10 月 21 日的《自然》上发表了 Pinal：一个 160 亿参数的蛋白设计基础模型，输入是一段描述目标功能的自然语言，输出是候选蛋白的序列与结构。它用 17 亿条带合成注释的“蛋白—文本”配对训练，把功能意图直接连到序列和结构上。此前的设计模型通常需要一个天然蛋白做优化起点，或者先由人把功能目标翻译成几何和序列约束，Pinal 想省掉的正是这道人工转写。论文还给出计算评估，生成的候选在预测可折叠性、与功能描述的匹配度和序列多样性之间取得平衡，用于挑出值得进实验室的那一批。';
 const output="Teams from Xiamen University, Hong Kong University of Science and Technology (Guangzhou), and the Shenzhen Institute of Advanced Technology, Chinese Academy of Sciences, published Pinal in Nature on October 21, a 16-billion-parameter protein design foundational model that takes as input a natural language description of the desired function and outputs candidate protein sequences and structures. It was trained on 1.7 billion synthetic annotated 'protein-text' pairs, directly linking functional intent to sequences and structures. Previous design models typically required a natural protein as an optimization starting point or required human translation of the functional goal into geometric and sequence constraints; Pinal aims to eliminate this manual transcription step. The paper also provides computational evaluations showing that the generated candidates achieve a balance among predicted foldability, alignment with the functional description, and sequence diversity, enabling the selection of those most worthy of being advanced to laboratory testing.";
 assert.deepEqual(translationTerminology(text),{glossary:{'西湖大学':'Westlake University'},hasBuiltIn:true});
 rejects(text,output);
 assert.doesNotThrow(()=>validateTranslationTerminology(text,output.replace('Xiamen University','Westlake University')));
});

test('Westlake rule preserves two explicitly named universities and does not generalize other institutions',()=>{
 for(const xiamen of ['厦门大学','廈門大學','Xiamen University']){
  const text='西湖大学与'+xiamen+'开展不同项目。';
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Westlake University and Xiamen University conduct different projects.'));
  rejects(text,'Xiamen University conducts different projects.');
 }
 rejects('西湖大学参与了研究。','Westlake University and Xiamen University participated in the study.');
 for(const text of ['厦门大学参与了研究。','香港科技大学（广州）参与了研究。','西湖边的一所大学。']){
  assert.deepEqual(translationTerminology(text),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(text,'Xiamen University participated in the study.'));
 }
});

test('Westlake operator conflict fails explicitly while other university mappings remain intact',()=>{
 const text='西湖大学与厦门大学开展不同项目。';
 const operator={'西湖大学':'Westlake University','厦门大学':'Xiamen University','无关机构':'Unrelated Institute'};
 assert.deepEqual(translationTerminology(text,operator),{glossary:{'西湖大学':'Westlake University','厦门大学':'Xiamen University'},hasBuiltIn:true});
 assert.throws(()=>translationTerminology(text,{'西湖大学':'Xiamen University'}),error=>error.code==='FLOW_LANGUAGE_CONFIG'&&error.statusCode===400&&error.message.includes('Westlake University'));
 assert.deepEqual(operator,{'西湖大学':'Westlake University','厦门大学':'Xiamen University','无关机构':'Unrelated Institute'});
});

test('observed caption requires its explicit Karnofsky identity even after numeric formatting is repaired',()=>{
 const source="AI 生成示意图：仅示意 cox.zph 估计的 Karnofsky 评分时变系数 β(t) 的大致走势。蓝线为平滑后的 β(t) 及置信带，灰线为 0，红色虚线为普通 Cox 模型的时不变系数；survival 包小册子描述该作用早期明显为负、约 200 天后与 0 相差不大。图中曲线并非由 veteran 数据实际运行得到，也无刻度，具体数值以下文算例输出为准。",output="AI-generated schematic: illustrates only the general trend of the time-varying coefficient β(t) estimated by cox.zph. The blue line shows the smoothed β(t) along with its confidence band, the gray line is zero, and the red dashed line represents the time-invariant coefficient in the standard Cox model; the survival booklet describes that this effect was initially明显 negative and became nearly indistinguishable from zero around 200 days later. The curves in the figure were not obtained from actual running of the veteran data, lack scales, and specific numerical values are as given in the following example output.";
 assert.deepEqual(translationTerminology(source),{glossary:{Karnofsky:'Karnofsky'},hasBuiltIn:true});
 rejects(source,output);rejects(source,output.replaceAll('zero','0'));
 assert.doesNotThrow(()=>validateTranslationTerminology(source,"AI-generated schematic: illustrates only the general trend of the time-varying coefficient β(t) for the Karnofsky score estimated by cox.zph. The blue line shows the smoothed β(t) along with its confidence band, the gray line is zero, and the red dashed line represents the time-invariant coefficient in the standard Cox model; the survival booklet describes that this effect was initially clearly negative and became nearly indistinguishable from zero around 200 days later. The curves in the figure were not obtained from actual running of the veteran data, lack scales, and specific numerical values are as given in the following example output."));
 for(const wrong of ['performance score','Karnovsky','Karnofsky2'])rejects(source,"AI-generated schematic: illustrates only the general trend of the time-varying coefficient β(t) for the Karnofsky score estimated by cox.zph. The blue line shows the smoothed β(t) along with its confidence band, the gray line is zero, and the red dashed line represents the time-invariant coefficient in the standard Cox model; the survival booklet describes that this effect was initially clearly negative and became nearly indistinguishable from zero around 200 days later. The curves in the figure were not obtained from actual running of the veteran data, lack scales, and specific numerical values are as given in the following example output.".replace('Karnofsky',wrong));
});

test('Karnofsky identity is source-scoped and does not ban unrelated scores or retained Chinese labels',()=>{
 for(const source of ['一般评分。','甲乙两组评分。','Karnofskyish is another string.']){
  assert.deepEqual(translationTerminology(source),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(source,'Scores for 甲 and 乙.'));
 }
 assert.doesNotThrow(()=>validateTranslationTerminology('Karnofsky 评分。','The Karnofsky score in 甲.'));
 const operator={Karnofsky:'Karnofsky','其他词':'another term'};
 assert.deepEqual(translationTerminology('Karnofsky 评分。',operator),{glossary:{Karnofsky:'Karnofsky'},hasBuiltIn:true});
 assert.throws(()=>translationTerminology('Karnofsky 评分。',{Karnofsky:'another score'}),error=>error.code==='FLOW_LANGUAGE_CONFIG');
 assert.deepEqual(operator,{Karnofsky:'Karnofsky','其他词':'another term'});
});

test('QA12 retains the official Shakib Al Hasan identity in the observed intervention fragment',()=>{
 const source="所有干预村拿到的是同一套核心方案，共五个部分：入户一次性免费发放口罩并讲解佩戴要点；8 周内每周 3–6 天在市场发放口罩；前 4 周内选 3 个星期五在清真寺发放；推广员在市场和公共场所提醒没戴口罩的人戴上；村干部和伊玛目带头示范，伊玛目在周五聚礼时宣读研究团队提供的讲稿。入户时还会播放一段短片，出镜者包括总理谢赫·哈西娜、伊玛目培训学院负责人和板球明星沙基布·阿尔·哈桑，并发放依据 WHO 材料制作的佩戴手册。",raw="All intervention villages received the same core intervention package consisting of five components: one-time free distribution of masks at household visits with instruction on proper wearing; mask distribution three to six days per week within eight weeks at markets; mask distribution on three Friday sessions within the first four weeks at mosques; outreach workers reminding individuals not wearing masks to put them on at markets and public places; village cadres and imams leading by example, with imams reciting the prepared script provided by the research team during Friday prayers; a short video was shown during household visits featuring Prime Minister Sheikha Hasina, the head of the Imams' Training Academy, and cricketer Shahidul Alam, and a WHO-based mask-wearing handbook was distributed.",output="All intervention villages received the same core intervention package consisting of five components: one-time free distribution of masks at household visits with instruction on proper wearing; mask distribution three to six days per week within eight weeks at markets; mask distribution on three Friday sessions within the first four weeks at mosques; outreach workers reminding individuals not wearing masks to put them on at markets and public places; village cadres and imams leading by example, with imams reciting the prepared script provided by the research team during Friday prayers; a short video was shown during household visits featuring Prime Minister Sheikha Hasina, the head of the Imams' Training Academy, and cricketer Shakib Al Hasan, and a WHO-based mask-wearing handbook was distributed.";
 assert.deepEqual(translationTerminology(source),{glossary:{'沙基布·阿尔·哈桑':'Shakib Al Hasan'},hasBuiltIn:true});
 rejects(source,raw);rejects(source,raw+' Shakib Al Hasan also appeared.');rejects(source,output.replace('Shakib Al Hasan','a cricket player'));
 assert.doesNotThrow(()=>validateTranslationTerminology(source,output));
 assert.doesNotThrow(()=>validateTranslationTerminology(source,output.replace('Al Hasan','Al-Hasan')));
});

test('QA12 Shakib guard is activated by the exact source name and keeps operator conflicts explicit',()=>{
 for(const source of ['沙基布参加。','阿尔·哈桑参加。','Shahidul Alam 参加。']){
  assert.deepEqual(translationTerminology(source),{glossary:{},hasBuiltIn:false});
  assert.doesNotThrow(()=>validateTranslationTerminology(source,'Shahidul Alam participated.'));
 }
 assert.throws(()=>translationTerminology('沙基布·阿尔·哈桑',{'沙基布·阿尔·哈桑':'Shahidul Alam'}),error=>error.code==='FLOW_LANGUAGE_CONFIG');
});
