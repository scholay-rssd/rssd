import test from 'node:test';
import assert from 'node:assert/strict';
import {translationFactsVersion,validateTranslationFacts,translationQuantityHints} from '../scripts/translation-facts.mjs';

const passes=(source,translated)=>assert.equal(validateTranslationFacts(source,translated).version,translationFactsVersion);
const rejects=(source,translated)=>assert.throws(()=>validateTranslationFacts(source,translated),error=>error.code==='FLOW_LANGUAGE_FACTS'&&error.statusCode===502);

test('the observed sodium isotope fragment preserves Na mass number and all measured quantities',()=>{
 const source="正电子来自放射性同位素钠-22 的 β 衰变，出射动能最高可达 546 keV。团队只用一枚 18 μCi 的弱源，让正电子穿过单晶钨慢化后进入阱中，最终把它的回旋热能降到约 26 μeV。彭宁阱处在 5.6 T 的磁场里，连同密封的真空腔一起由稀释制冷机冷却到约 300 mK：低温几乎消除了会激发回旋态的黑体光子，腔体本身也充当低温泵，维持近乎完美的真空。阱电极同时构成微波腔，把回旋激发态的自发辐射寿命从约 83 毫秒延长到约 4 秒，团队因此能用量子非破坏测量读出单个正电子的量子跃迁和自旋翻转。",output="Positrons come from the β decay of the radioactive isotope sodium-22, with a maximum emitted kinetic energy of 546 keV. The team used a weak source of only 18 μCi, allowing positrons to pass through a single-crystal tungsten slow-down stage before entering the trap, where their cyclotron thermal energy was finally reduced to about 26 μeV. The Penning trap is situated in a 5.6 T magnetic field, and together with the sealed vacuum chamber it is cooled to approximately 300 mK by a dilution refrigerator: the low temperature almost eliminates blackbody photons that could excite the cyclotron states, and the chamber itself acts as a cryogenic pump, maintaining nearly perfect vacuum. The trap electrodes simultaneously form a microwave cavity, extending the spontaneous radiation lifetime of the cyclotron excited state from about 83 milliseconds to about 4 seconds, enabling the team to perform quantum non-destructive measurements to observe individual positron quantum transitions and spin flips.";
 passes(source,output);
 for(const [from,to] of [['sodium-22','sodium-23'],['546 keV','547 keV'],['18 μCi','19 μCi'],['26 μeV','27 μeV'],['5.6 T','5.7 T'],['300 mK','301 mK'],['83 milliseconds','84 milliseconds'],['4 seconds','5 seconds']])rejects(source,output.replace(from,to));
 rejects(source,output+' Na-23 is also present.');
 for(const separator of ['-','‐','‑'])passes('同位素钠-22。','The isotope sodium'+separator+'22.');
 passes('钠-22与碳-14。','Na-22 and C-14.');rejects('钠-22与碳-14。','Na-14 and C-22.');
 rejects('钠-22。','Potassium-22.');rejects('钠-22。','Sodium-22.5.');rejects('钠-22。','Sodium-22-2.');
 rejects('钠-22，变化-22。','Na-22.');passes('钠-22，变化-22。','Na-22, with a change of -22.');
 rejects('数量22，使用钠-22。','Use Na-22.');rejects('变化-22。','Sodium-22.');
 // No unobserved periodic-table alias expansion.
 rejects('钾-22。','Potassium-22.');
});

test('the observed Schoenfeld fragment accepts an explicitly zero slope without guessing decimals or negation',()=>{
 const source="Schoenfeld 残差为每个发生事件的个体、每个协变量各算一个：某人在 t 时刻发生事件，他的残差等于自己的协变量值，减去 t 时刻风险集内各人该协变量的加权平均，权重是各人的风险。若比例风险成立，这些残差应与时间无关。Grambsch 与 Therneau（1994）进一步说明，把缩放后的 Schoenfeld 残差对时间作图并加以平滑，得到的曲线就是 β(t) 的估计；Cox（1972）、Schoenfeld（1980）等多种既有检验，都可以看作在这张残差图上拟合一条加权最小二乘直线、检验其斜率是否为 0 的时间加权得分检验。R 的 survival 包用 cox.zph() 实现：输出每个变量的得分检验和全局检验，plot() 画出 β(t) 曲线与近似置信带，比例风险成立时曲线应接近水平。时间轴默认按 Kaplan–Meier 尺度变换（transform = \"km\"），也可改用秩、原始时间或自定义函数，不同变换会让检验侧重不同时段。帮助文档还说明，survival 3.0 以前的版本计算的是得分检验的快速近似，之后改为实际的得分检验，新旧版本的数字可能不同。",output="Schoenfeld residuals are calculated once per individual event and once per covariate: if an individual experiences an event at time t, their residual equals their covariate value minus the weighted average of that covariate across all individuals in the risk set at time t, with weights being the risks of each individual. If the proportional hazards assumption holds, these residuals should be independent of time. Grambsch and Therneau (1994) further show that plotting the scaled Schoenfeld residuals against time and smoothing the resulting curve yields an estimate of β(t); various existing tests, such as those by Cox (1972) and Schoenfeld (1980), can be viewed as time-weighted score tests that fit a weighted least squares line to this residual plot and test whether its slope is zero. The cox.zph() function in R's survival package implements this: it outputs score tests for each variable and a global test, plot() produces the β(t) curve along with its approximate confidence bands, and under the proportional hazards assumption, the curve should be close to horizontal. The time axis defaults to Kaplan–Meier scaling (transform = \"km\"), but can alternatively use ranks, original time, or a custom function; different transformations emphasize different time periods. The help documentation also states that versions of survival prior to 3.0 computed a fast approximation of the score test, while versions from 3.0 onward use the actual score test, and thus the numbers from old and new versions may differ.";
 passes(source,output);rejects(source,output.replace('its slope is zero','its slope is one'));rejects(source,output.replace('its slope is zero','its slope is zero point five'));
 for(const predicate of ['is zero','was zero','equals zero','has a value of zero','is equal to zero','is set to zero'])passes('斜率为0。','The slope '+predicate+'.');
 passes('斜率为0。','The slopes are zero.');
 for(const predicate of ['is not zero','is nonzero','is zero-inflated','is negative zero','is minus zero','has no effect','is centered','is zero point five','is zero point 5','is zero.5'])rejects('斜率为0。','The slope '+predicate+'.');
 rejects('斜率为1。','The slope is zero.');rejects('分别为0和0。','The slope is zero.');rejects('数量0。','The estimate is zero.');
});

test('the observed bound retains a spelled upper limit without accepting incomplete or changed lexical quantities',()=>{
 const source='自筹经费伙伴不限数量，也不计入 7 个的上限。';
 const output='The number of self-funded partners is unlimited and does not count toward the upper limit of seven.';
 passes(source,output);rejects(source,output.replace('seven','six'));rejects(source,output.replace('seven','eight'));
 for(const [value,word] of [[0,'zero'],[1,'one'],[7,'seven'],[21,'twenty-one'],[32,'thirty two'],[99,'ninety-nine']]){
  passes('上限'+value+'。','The upper limit of '+word+'.');passes('下限'+value+'。','The lower limit of '+word+'.');
 }
 passes('上下限分别为7和3。','The upper limit of seven and lower limit of three.');
 rejects('上下限分别为7和3。','The upper limit of seven.');rejects('两组上限分别7和7。','The upper limit of seven.');
 rejects('7个。','Seven could be an upper limit.');rejects('1个。','They discuss one another and the upper limit.');
 for(const [value,word] of [[1,'one hundred and one'],[7,'one hundred and seven'],[21,'one hundred twenty-one'],[30,'thirty two point five'],[32,'thirty two point five'],[32,'thirty-two point five'],[7,'seven point five'],[7,'seven.5'],[7,'minus seven'],[7,'negative seven'],[7,'seven-and-a-half'],[7,'seven and a half'],[30,'thirty second'],[7,'seventy'],[7,'sevenfold']])rejects('上限'+value+'。','The upper limit of '+word+'.');
});

test('the observed study preserves adult participant counts, carbon isotope identity and every stated numeric fact',()=>{
 const source='以往关于“谄媚”的研究，问的是模型会不会迎合用户。印度科学理工学院等机构的三位作者把问题反过来：当模型自信、前后一致却讲错时，用户会不会迎合模型？32 名成人参与者每人通过五个助手学习至多五个科普主题，包括心电图、碳-14 测年、GPS 定位、萤火虫发光和降噪耳机。五个助手都基于 GPT-5-mini，区别只在系统提示：每个主题的 12 条事实中，暗中有 0%、25%、50%、75% 或 100% 被换成看似合理的错误版本，例如把碳-14 半衰期约 5730 年改成约 50000 年，并要求助手始终以完全自信的口吻讲解。学完后是事先未告知的测验，每题四个选项里同时有正确事实和被植入的错误。';
 const output="Previous research on 'sycophancy' asked whether models would conform to users. Three authors from the Indian Institute of Science and other institutions reversed the question: when models are confident, consistent, yet incorrect, would users conform to the models? Thirty-two adult participants each learned up to five science topics through five assistants, including electrocardiograms, carbon-14 dating, GPS positioning, firefly bioluminescence, and noise-cancelling headphones. All five assistants were based on GPT-5-mini, differing only in system prompts: among the 12 facts for each topic, 0%, 25%, 50%, 75%, or 100% were replaced with seemingly plausible false versions—for example, changing the carbon-14 half-life of approximately 5730 years to approximately 50,000 years—and each assistant was required to explain the content with complete confidence. After learning, participants took a test that had not been previously disclosed, with each question offering four options, including both the correct fact and the implanted false one.";
 passes(source,output);passes(source,output.replace('would users','will users').replace('had not been previously disclosed','was not previously informed to them'));
 for(const [from,to] of [['Thirty-two','Thirty-three'],['Thirty-two adult participants','Adult participants'],['12 facts','11 facts'],['0%,','5%,'],['25%,','20%,'],['75%,','70%,'],['100%','99%'],['5730 years','5731 years'],['50,000 years','50,001 years'],['carbon-14','carbon-13'],['GPT-5-mini','GPT-6-mini']])rejects(source,output.replace(from,to));
});

test('participant quantities and carbon isotope aliases do not absorb unrelated numbers, signs or scientific identities',()=>{
 passes('32名参与者。','Thirty-two adult participants.');passes('21名参与者。','Twenty-one participants.');passes('2至4名参与者。','Between two and four adult participants.');
 rejects('32名参与者。','Thirty-one adult participants.');rejects('2至4名参与者。','Two adult participants.');rejects('两组分别32和32人。','Thirty-two adult participants.');
 rejects('1名参与者。','One could recruit participants.');rejects('1名参与者。','The participants discussed one another.');
 for(const [value,word] of [[1,'one hundred and one'],[21,'one hundred twenty-one'],[5,'point five'],[5,'one point two five'],[1,'minus one'],[1,'negative one']])rejects(value+'名参与者。',word+' adult participants.');
 for(const separator of ['-','‐','‑'])passes('碳-14测年；碳-14的半衰期约5730年。','Carbon'+separator+'14 dating; its half-life is about 5730 years.');
 passes('碳-13与碳-14。','C-13 and carbon-14.');passes('carbon-14。','C-14.');
 rejects('碳-14。','Carbon-13.');rejects('碳-14。','Carbon-14 and carbon-13.');rejects('碳-13与碳-14。','Carbon-14.');
 rejects('碳-14。','Nitrogen-14.');rejects('碳-14。','Hydrocarbon-14.');rejects('碳-14。','Carbon-14.5.');rejects('碳-14。','Carbon-14-2.');
 rejects('碳-14，变化-14。','Carbon-14.');passes('碳-14，变化-14。','Carbon-14, with a change of -14.');
 rejects('剂量14，使用碳-14。','Use carbon-14.');rejects('变化-14。','Carbon-14.');
});

test('the observed consortium fragment retains three numeric occurrences without asserting institution-role equivalence',()=>{
 const source='联合体至少包含 3 个来自 3 个不同国家的伙伴，分别向 3 家不同的资助机构申请经费；三者都须符合所申请机构的资格，且彼此独立。';
 const output='The consortium shall include at least three partners from three different countries, each applying for funding to a different funding institution; all three partners must meet the eligibility criteria of the respective applying institution and must be independent of one another.';
 // This gate only retains a numeric multiset. The final "three partners"
 // does not prove that the source requirement of three institutions survived.
 passes(source,output);
 rejects(source,output.replace('three different countries','four different countries'));
 rejects(source,output.replace('all three partners','all two partners'));
 rejects(source,output.replace('all three partners','all partners'));
});

test('the observed friendship fragment retains spelled counts and the decimal without approving the each-average phrasing',()=>{
 const source='论文先展示了化名“Marketville”的高中里八名女生（名字均为化名）之间的 10 对互认友谊。Betty 只有 1 个朋友 Sue，而 Sue 有 4 个朋友；Jane 有 2 个朋友 Dale 和 Alice，她们平均有 3.5 个朋友。八人中，Betty、Jane、Pam、Dale、Tina 五人的朋友数少于自己朋友的平均朋友数，只有 Sue 和 Alice 两人多于，Carol 恰好持平，少与多之比为 5:2。';
 const output="The paper first presents 10 mutual friendships among eight girls in a high school named 'Marketville' (all names are pseudonyms). Betty has only one friend, Sue, while Sue has four friends; Jane has two friends, Dale and Alice, and they each have an average of 3.5 friends. Among the eight, Betty, Jane, Pam, Dale, and Tina have fewer friends than the average number of friends of their peers, only Sue and Alice have more, and Carol is exactly at the average; the ratio of those with fewer friends to those with more friends is 5:2.";
 // Whether "each have an average" preserves the source meaning needs review.
 passes(source,output);
 for(const [from,to] of [['one friend','two friends'],['four friends','three friends'],['two friends','three friends'],['3.5 friends','3.6 friends'],['5:2','5:3']])rejects(source,output.replace(from,to));
});

test('new supported count nouns stay bounded by noun context, multiplicity, ranges and complete lexical values',()=>{
 for(const [count,text] of [[1,'one partner'],[3,'three independent partners'],[1,'one country'],[3,'three different countries'],[1,'one friend'],[4,'four friends'],[21,'twenty-one different partners'],[3,'three of these different countries']])passes(count+'个。',text+'.');
 passes('2至4个朋友。','Between two and four friends.');passes('2至4个伙伴。','Two to four partners.');
 for(const prefix of ['At this point','At that point','On this point','At one point'])passes('此时3个朋友到达。',prefix+' three friends arrived.');
 rejects('2至4个朋友。','Two friends.');rejects('2至4个伙伴。','Two to five partners.');
 rejects('分别3个伙伴和3个国家。','Three partners from different countries.');
 rejects('分别1个朋友和1个朋友。','One friend.');rejects('分别3.5个和3.5个朋友。','An average of 3.5 friends.');
 rejects('1个国家。','One could compare different countries.');rejects('1个伙伴。','Partners independent of one another.');
 rejects('1个朋友。','The first friend.');rejects('0个朋友。','No friends.');rejects('3个机构。','Three institutions.');
 for(const noun of ['partners','countries','friends']){
  rejects('1个。','One hundred and one '+noun+'.');rejects('21个。','One hundred twenty-one '+noun+'.');
  rejects('3个。','One million and three '+noun+'.');rejects('3个。','One thousand, three '+noun+'.');
  rejects('5个。','Point five '+noun+'.');rejects('5个。','One point five '+noun+'.');rejects('5个。','One point two five '+noun+'.');rejects('5个。','One point zero two five '+noun+'.');
  rejects('1个。','Minus one '+noun+'.');rejects('1个。','Negative one '+noun+'.');
 }
});

test('hyphenated magnitude adjectives preserve parameters, sign and every amount endpoint',()=>{
 for(const separator of ['-','‐','‑'])passes('160亿参数的模型用17亿条配对训练。','A 16'+separator+'billion'+separator+'parameter model trained on 1.7 billion pairs.');
 passes('设备长10米，覆盖5公里。','A 10-m-long device covers a 5-km distance.');
 rejects('设备长10米。','An 11-m-long device.');rejects('数量为1000万。','A 10-m-long device.');
 passes('50万至100万英镑。','A GBP 500-thousand to 1-million range.');
 passes('变化为-160亿。','A -16-billion change.');passes('变化为-50万。','A -0.5-million change.');
 rejects('变化为-160亿。','A 16-billion change.');rejects('变化为-50万。','A 0.5-million change.');
 rejects('160亿参数的模型用17亿条配对训练。','A 16-million-parameter model trained on 1.7 billion pairs.');
 rejects('160亿参数的模型用17亿条配对训练。','A 17-billion-parameter model trained on 1.7 billion pairs.');
 rejects('160亿参数的模型用17亿条配对训练。','A 16-billion-parameter model trained on 1.6 billion pairs.');
 rejects('50万至100万英镑。','A GBP 500-thousand to 900-thousand range.');rejects('50万至100万英镑。','Up to GBP 500-thousand.');
});

test('prose dashes delimit scientific names while actual internal hyphens and model identities stay frozen',()=>{
 const source='模型Qwen3-8B、Qwen3-14B、Gemma-3-27B和MedGemma-27B，在48GB显卡上运行。正确+3分，错误−1分，空白0分。';
 const translated='The models—Qwen3-8B, Qwen3-14B, Gemma-3-27B and MedGemma-27B—run on a 48GB GPU. Correct: +3 points; incorrect: −1 point; blank: 0 points.';
 passes(source,translated);passes(source,translated.replaceAll('—','–'));
 rejects(source,translated.replace('Qwen3-8B','Qwen3-14B'));rejects(source,translated.replace('Qwen3-8B','Qwen3-4B'));rejects(source,translated.replace('Gemma-3-27B','Gemma-3-28B'));rejects(source,translated.replace('−1 point','1 point'));
 passes('HLA-DQ2和CAT-4。','The symbols—HLA-DQ2 and CAT‑4—were retained.');
 rejects('HLA-DQ2和CAT-4。','The symbols—HLA-DQ3 and CAT‑4—were retained.');
 rejects('20°C和25°C。','Temperatures—20°C and 26°C.');
});

test('an explicit covariate zero value preserves formula digits without guessing negation or zero adjectives',()=>{
 const source='x) = h₀(t) · exp(β₁x₁ + β₂x₂ + … + βₚxₚ)。其中 h₀(t) 是所有协变量取 0 时的基线风险。';
 const output='x) = h₀(t) · exp(β₁x₁ + β₂x₂ + … + βₚxₚ). Here, h₀(t) is the baseline hazard when all covariates are zero.';
 passes(source,output);rejects(source,output.replace('are zero','are one'));rejects(source,output.replaceAll('h₀','h₁'));
 for(const predicate of ['are zero','are all zero','are equal to zero','are set to zero','equal zero','take a value of zero','have a value of zero'])passes('协变量取0。','The covariates '+predicate+'.');
 passes('协变量取0。','The covariate is zero.');
 for(const predicate of ['are not zero','are nonzero','are zero-shot','are zero-sum','are zero-inflated','are centered','have no effect','are zero point five','are zero point 5','are zero.5'])rejects('协变量取0。','The covariates '+predicate+'.');
 rejects('协变量取1。','The covariates are zero.');rejects('两次协变量均取0，分别为0。','The covariates are zero.');
});

test('scientific identifier references may become pronouns without losing symbol identities or real repeated quantities',()=>{
 const source='20 °C 时检测 CAT-4，敲低 cat-4。肌肉合成 BH2，BH2 被运到远端组织，由 DHFR-1 转成 BH4，BH4 再协助 PAH-1。提高 BH2 合成在 20 °C 或 25 °C 下也能延长寿命。';
 const output='At 20 °C detect CAT-4 and knock down cat-4. Muscle synthesizes BH2, which is transported to distant tissues and converted by DHFR-1 into BH4, which assists PAH-1. Increasing BH2 synthesis extends lifespan at 20 °C or 25 °C.';
 passes(source,output);
 rejects(source,output.replaceAll('BH2','BH3'));rejects(source,output.replace('DHFR-1','DHFR-2'));rejects(source,output.replace('CAT-4','cat-4'));
 rejects(source,output.replace('20 °C or 25 °C','25 °C'));rejects(source,output.replace('25 °C','26 °C'));
 rejects('BH2 与 BH4。','BH2, BH3 and BH4.');
 passes('BH₂ 和 BH₂。','BH2, which is transported.');passes('CAT-4 和 cat-4。','CAT‑4 and cat‑4.');
 rejects('剂量为2，使用BH2。','Use BH2.');rejects('甲50、乙50。','Both share 50.');
 passes('Qwen3-4B与Qwen3-4B，另外1.7B参数。','Qwen3-4B, which is separate from 1.7 billion parameters.');
 rejects('Qwen3-4B与1.7B参数。','Qwen3-8B with 1.7 billion parameters.');rejects('1.7B参数。','17 billion parameters.');
 passes('单个项目可申请50万至100万英镑。','GBP 0.5 million–1 million per project.');
 passes('14:00–17:00。','2 PM–5 PM.');
});

test('bounded English model counts retain small cardinals, ranges and multiplicity without treating pronouns as quantities',()=>{
 passes('6 个30亿至40亿参数的开源模型在1,500道题上的误差相关为0.41，相当于1.96张独立票。','Six open-source models with 3 billion to 4 billion parameters have an error correlation of 0.41 on 1,500 questions, equivalent to 1.96 independent votes.');
 for(const [number,words] of [[0,'zero'],[1,'one'],[6,'six'],[19,'nineteen'],[20,'twenty'],[21,'twenty-one'],[64,'sixty four'],[99,'ninety-nine']])passes(number+'个模型。',words+' independent models.');
 passes('使用6至8个模型。','Use between six and eight models.');passes('使用6至8个模型。','Use six to 8 models.');
 rejects('使用6至8个模型。','Use six models.');rejects('使用6个模型。','Use five models.');
 rejects('两组分别6个和6个模型。','Both groups share six models.');
 rejects('使用1个模型。','One could compare all models.');rejects('1个项目。','This is one possible approach.');
 rejects('有1名研究者。','The first researcher arrived.');
});

test('paper counts, explicit partitives and year ranges normalize numbers without guessing prose or dropping endpoints',()=>{
 const papers='2014—2017年署名的7篇金属腐蚀论文中捏造图像，其中6篇被认定自我盗用。';
 const output='Images were fabricated in seven metal corrosion papers authored between 2014 and 2017, with six of these papers identified as self-plagiarism.';
 passes(papers,output);rejects(papers,output.replace('seven metal','eight metal'));rejects(papers,output.replace('six of','five of'));
 rejects(papers,output.replace('six of these papers','these papers'));rejects(papers,output.replace('2017','2018'));
 for(const text of ['Ten to fifteen years later.','Between ten and fifteen years later.','Ten–fifteen years later.','10 to fifteen years later.','ten to 15 years later.'])passes('10–15年后。',text);
 rejects('10–15年后。','Ten years later.');rejects('10–15年后。','Ten to sixteen years later.');rejects('10–15年后。','Nine to fifteen years later.');
 passes('6篇论文。','Six of those published research papers.');passes('7篇论文。','Seven peer-reviewed scientific papers.');passes('1篇论文。','One of these papers.');
 rejects('有1篇论文。','One could compare these papers.');rejects('有1篇论文。','One studies these papers.');rejects('有1篇论文。','Someone mentioned papers.');
 rejects('有0篇论文。','There are no papers.');rejects('有1篇论文。','One hundred and one papers.');rejects('有21篇论文。','One hundred twenty-one papers.');
 rejects('两组各6篇论文。合计6篇重复。','Both groups share six papers.');
});

test('edition ordinals are typed facts and do not satisfy unrelated numeric quantities',()=>{
 const source='王孝鱼点校的《二程集》（中华书局，1981年初版；2004年第2版）。';
 for(const edition of ['second edition','2nd edition','edition 2','edition no. 2'])passes(source,'The Er Cheng Ji edited by Wang Xiaoyu (Zhonghua Book Company, first edition in 1981; '+edition+' in 2004).');
 rejects(source,'The Er Cheng Ji (first edition in 1981; third edition in 2004).');
 rejects(source,'The Er Cheng Ji (first edition in 1981; 2 volumes in 2004).');
 rejects('有2个模型。','The second edition.');rejects('第2版有6个模型。','The second edition has five models.');
 passes('第2版有6个模型。','The second edition has six models.');
});

test('explicit quantities retain both amount endpoints across common magnitude and grouping notation',()=>{
 for(const translated of ['Each project may apply for £500,000 to £1,000,000.','Each project may apply for GBP 0.5 million–1 million.','Each project may apply for 500k–1m pounds.','Each project may apply for 500k-1m pounds.'])passes('单个项目可申请50万至100万英镑。',translated);
 rejects('单个项目可申请50万至100万英镑。','Each project may apply for up to £500,000.');
 rejects('单个项目可申请50万至100万英镑。','Each project may apply for £500,000 to £900,000.');
 rejects('单个项目可申请50万至100万英镑。','Each project may apply for USD 500,000 to USD 1,000,000.');
 passes('投入1.2亿人民币和50万美元。','Invest CNY 120 million and USD 500 thousand.');
 passes('范围50-100，变化-0.25，数量1万亿。','The range is 50 to 100, the change is -0.250, and the quantity is 1 trillion.');
 rejects('变化-0.25。','The change is 0.25.');
 rejects('甲50、乙50。','A and B share 50.');
});

test('calendar and clock facts accept named months, ordinary AM/PM and preserved precision',()=>{
 for(const translated of ['The deadline is October 28, 2026 at 11 AM.','The deadline is 28 October 2026 at 11:00.','The deadline is 2026-10-28 at 11:00:00.'])passes('截止时间为2026年10月28日11:00。',translated);
 passes('日期是10月28日，下午3:30。','The date is October 28 at 3:30 PM.');
 passes('时间是2026年10月，上午11点。','The time is October 2026 at 11 AM.');
 passes('午夜00:00，中午12:00，晚上11:00。','Midnight 12 AM, noon 12 PM, and 11 PM.');
 rejects('2026年10月28日11:00截止。','The deadline is October 29, 2026 at 11 AM.');
 rejects('2026年10月28日11:00截止。','The deadline is October 28, 2026 at 11 PM.');
 rejects('日期是2026年10月28日。','The date is October 28, 2025.');
});

test('real project-calendar chunk accepts both rejected faithful first-day spellings',()=>{
 const source='项目工期为 18 至 30 个月，须在 2027 年 2 月 1 日或之前开工、2029 年 7 月 31 日前结束，开工日必须是某月 1 日。按 IFS 时间表，申请人约在 2026 年 12 月 2 日获知结果。获资助方须在英国开展项目工作、在英国利用成果，并把大部分经费花在英国境内。IFS 还提到，按同类竞赛经验，成功率约为 20%，这只是历史参考，不代表本轮的录取比例。';
 const outputs=[
  'The project duration will be between 18 and 30 months, with commencement no later than February 1, 2027, and completion no later than July 31, 2029; the start date must fall on the first day of a month. According to the IFS timeline, applicants are expected to receive results around December 2, 2026. The funded party must conduct project work in the UK, utilize the outcomes in the UK, and spend the majority of the funding within the UK. IFS also notes that, based on historical experience from similar competitions, the success rate is approximately 20%, which is solely for historical reference and does not indicate the admission rate for this round.',
  'The project duration will be between 18 and 30 months, with commencement required on or before February 1, 2027, and completion before July 31, 2029; the start date must fall on the first day of a month. According to the IFS timeline, applicants are expected to receive results around December 2, 2026. The funded party must conduct the project work in the UK, utilize the outcomes in the UK, and spend the majority of the funding within the UK. IFS also notes that, based on historical experience from similar competitions, the success rate is approximately 20%, which is solely for historical reference and does not indicate the admission rate for this round.',
 ];
 for(const output of outputs){
  passes(source,output);passes(source,output.replace('the first day of a month','the 1st day of a month'));
  rejects(source,output.replace('the first day of a month','the second day of a month'));
  rejects(source,output.replace('between 18 and 30 months','between 18 and 29 months'));
 }
});

test('calendar ordinal normalization stays within explicit calendar-day contexts',()=>{
 for(const [day,word] of [[1,'first'],[2,'second'],[3,'third'],[12,'twelfth'],[21,'twenty-first'],[22,'twenty second'],[30,'thirtieth'],[31,'thirty-first']]){
  passes('某月 '+day+' 日开始。','Start on the '+word+' day of a month.');
  passes('2027年3月'+day+'日开始。','Start on the '+word+' day of March 2027.');
 }
 passes('2027年2月1日开始。','Start on the 1st of February 2027.');
 rejects('某月1日开始。','Start on the second day of a month.');
 rejects('某月2日开始。','Start on the thirty-second day of a month.');
 rejects('有1个项目，首次尝试。','The project is a first attempt.');
 rejects('有1名研究者。','The first researcher arrived.');
 rejects('第1天开展研究。','Research began on the first day of treatment.');
 rejects('2027年2月1日开始。','Start on the second of February 2027.');
});

test('known thermal terminology failure is rejected without claiming general semantic validation',()=>{
 const source='（Metamaterials and Metasurfaces）：未来电信与先进连接；电子—光子融合技术；热学、声学与力学超材料；能源安全与净零；医疗。';
 const bad='(Metamaterials and Metasurfaces): Future telecommunications and advanced interconnects; electronic-photonics fusion technologies; thermomechanical, acoustic, and mechanical metamaterials; energy security and net zero; healthcare.';
 assert.throws(()=>validateTranslationFacts(source,bad),error=>error.code==='FLOW_LANGUAGE_FACTS'&&/unsupported thermomechanical/.test(error.message));
 passes(source,bad.replace('thermomechanical','thermal'));
 rejects(source,bad.replace('thermomechanical','thermo-mechanical'));
 passes('热学与热机械耦合研究。','Thermal and thermomechanical coupling research.');
 passes('热学与热力耦合研究。','Thermal and thermo-mechanical coupling research.');
 passes('热学与热—力耦合研究。','Thermal and thermomechanical coupling research.');
 passes('热机械超材料。','Thermomechanical metamaterials.');
 passes('材料研究。','Thermomechanical materials research.');
 passes('热学文献使用 thermomechanical 一词。','Thermal literature uses the term thermomechanical.');
 rejects('热学和热力学研究。','Thermomechanical research.');
 assert(!validateTranslationFacts(source,bad.replace('thermomechanical','thermal')).checks.includes('semantic-equivalence'));
});

test('Royce is not changed to Roche while explicitly distinct institutions remain distinct',()=>{
 passes('罗伊斯研究所发布新闻。','The Royce Institute published news.');
 passes('亨利·罗伊斯研究所发布新闻。','The Henry Royce Institute published news.');
 rejects('罗伊斯研究所发布新闻。','The Roche Institute published news.');
 passes('罗氏研究所发布新闻。','The Roche Institute published news.');
 passes('罗伊斯研究所与罗氏研究所开展不同研究。','The Royce Institute and the Roche Institute conduct different research.');
 rejects('罗伊斯研究所与罗氏研究所开展不同研究。','The Roche Institute and the Roche Institute conduct different research.');
});

test('electronic-photonic technology does not become unsupported electron-photon fusion physics',()=>{
 const source='未来电信与先进连接；电子—光子融合技术；热学、声学与力学超材料。';
 passes(source,'Future telecommunications and advanced connectivity; convergent electronic-photonic technologies; thermal, acoustic and mechanical metamaterials.');
 rejects(source,'Future telecommunications and advanced connectivity; electron-photon fusion technologies; thermal, acoustic and mechanical metamaterials.');
 passes('物理文献使用 electron-photon fusion 一词。','The physics literature uses the term electron-photon fusion.');
 passes('电子—光子融合技术用于器件；另一个物理文献使用 electron-photon fusion 一词。','Convergent electronic-photonic technologies are used in devices; separate physics literature uses the term electron-photon fusion.');
 rejects('电子—光子融合技术用于器件；另一个物理文献使用 electron-photon fusion 一词。','Electron-photon fusion technologies are used in devices; separate physics literature uses the term electron-photon fusion.');
 passes('电子—光子融合技术与电子—光子融合反应分别讨论。','Convergent electronic-photonic technologies and electron-photon fusion reactions are discussed separately.');
});

test('EnterScholar retains its owner-specified brand without conflating the separate academic gateway',()=>{
 passes('信息同步发表于恩特学术。','Also published on EnterScholar.');
 rejects('信息同步发表于恩特学术。','Also published on EnTe Academic.');
 passes('学术之门提供资料。','The Academic Gateway provides resources.');
 passes('恩特学术和学术之门是不同品牌。','EnterScholar and the Academic Gateway are different brands.');
 passes('恩特学术曾被误写为 EnTe Academic。','EnterScholar was previously mislabeled EnTe Academic.');
});

test('real corpus percentages normalize as ratios without losing the distinct percentage-point unit',()=>{
 for(const translated of ['Micro and small businesses may receive up to 70% of eligible costs.','Micro and small businesses may receive up to 70 percent of eligible costs.','Micro and small businesses may receive up to 0.7 of eligible costs.'])passes('微型和小型企业最高可获合格成本的70%。',translated);
 rejects('微型和小型企业最高可获合格成本的70%。','Micro and small businesses may receive up to 70 of eligible costs.');
 passes('研究功效为80%，p<0.05。','The study power is 0.8, with p<0.05.');
 passes('两者为百分之50和50%。','Both are 0.5 and 50 percent.');
 passes('预测概率为0.71。','The predicted probability is 71%.');
 passes('范围70至80%。','The range is 70% to 80%.');
 passes('合计73.8%，比Qwen3-4B高1.1个百分点。','The combined result is 73.8%, 1.1 percentage points above Qwen3-4B.');
 passes('概率提高25.6个百分点，ITT除以0.256。','The probability rose by 25.6 percentage points; divide the ITT by 0.256.');
 passes('实验组分别低9和7个百分点。','The experimental groups were lower by 9 percentage points and 7 percentage points respectively.');
 passes('准确率低8–22个百分点。','Accuracy was lower by 8 to 22 percentage points.');
 rejects('比Qwen3-4B高1.1个百分点。','It was 1.1 percent higher than Qwen3-4B.');
 rejects('比Qwen3-4B高1.1个百分点。','It was 0.011 higher than Qwen3-4B.');
 rejects('准确率高1.1%。','Accuracy was higher by 1.1 percentage points.');
});

test('real standalone months and noon ranges accept faithful English without treating modal may as a month',()=>{
 passes('纠正5月版本中的撤稿理由，保留了5月的原文。','Correct the retraction reason in the May version and retain the original May text.');
 passes('2026年9月1日的公告。','The announcement dated Sept. 1, 2026.');
 passes('9月的公告。','The Sept. announcement.');
 passes('5个项目可能受助。','5 projects may receive funding.');
 rejects('5月公布。','They may announce it.');
 rejects('5月公布。','They announced it in June.');
 passes('接听时间为工作日9:00–12:00和14:00–17:00。','Telephone hours on working days are 9 AM–noon and 2 PM–5 PM.');
 passes('00:00截止。','The deadline is midnight.');
 passes('12:00截止。','The deadline is noon.');
 rejects('12:00截止。','The deadline is midnight.');
});

test('named noon and midnight endpoints preserve explicit clock range order and precise times',()=>{
 for(const output of ['9 AM–noon.','Between 9 a.m. and noon.','From 09:00 to noon.'])passes('9:00–12:00。',output);
 passes('12:00–14:00。','Noon to 2 p.m.');passes('00:00–09:00。','Midnight to 9 AM.');
 passes('12:00–00:00。','Between noon and midnight.');
 passes('09:30:15–12:00。','From 9:30:15 AM to noon.');
 for(const output of ['Noon to 9 AM.','9 PM–noon.','9 AM–midnight.','9:01 AM–noon.','9:00:01 AM–noon.','9 AM and noon.','9 to noon.','9 AM–noonish.','9 AM–noon:30.','9 AM–noon.5.','-9 AM–noon.','1.9 AM–noon.'])rejects('9:00–12:00。',output);
 rejects('9:00–12:00。9:00–12:00。','9 AM–noon.');
 rejects('9:00–12:00，数量3。','9 AM–noon, quantity 4.');
});

test('a translator cannot invent even a correct weekday and must retain a supplied weekday identity',()=>{
 rejects('2026年10月28日截止。','The deadline is Tuesday, October 28, 2026.');
 rejects('2026年10月28日截止。','The deadline is Wednesday, October 28, 2026.');
 passes('星期三，2026年10月28日截止。','The deadline is Wednesday, October 28, 2026.');
 rejects('星期三，2026年10月28日截止。','The deadline is Tuesday, October 28, 2026.');
 passes('每周三开会。','Meet every Wed.');
 passes('星期天开会。','Meet on Sunday.');
 rejects('星期三开会。','Meet this week.');
 passes('2026年5月推出。','Launch in May 2026.');
 passes('研究人员坐在阳光下。','The researchers sat in the sun.');
});

test('numeric checks deliberately make no claim to prove negation, attribution or caption semantics',()=>{
 const result=validateTranslationFacts('该结果不能证明因果关系。','The result proves causality.');
 assert(!result.checks.includes('semantic-equivalence'));assert(!result.checks.includes('negation'));
 assert(!validateTranslationFacts('AI生成示意图。','Researchers used AI.').checks.includes('image-attribution'));
});

// Real failed-response fixtures diagnose formatting; numeric success is not semantic approval.
const observedQa11=[
  {
    "id": "8ee842f598b6b008d6659680587159fd81a6d733",
    "index": 76,
    "source": "PLOS 出版伦理团队参与了校验。研究者只保留每位编辑最可疑的 3 篇、每篇最可疑的 3 条投稿前合著，整理出 7,738 条交给 PLOS；对方标注了其中 365 条，即排名最前的 88 条，加上从随后 517 条中挑出的 277 条。结果是 309 条真阳性、0 条假阳性、52 条“不确定”，另有 4 条因元数据记录的编辑并非实际处理编辑而剔除。309 条真阳性里，36 篇另有一位无冲突的编辑共同把关，6 篇的冲突曾经 PLOS 知情批准，2 篇已在 PLOS 的更正处理中说明。论文报告的精确率 1.0，就是 309 除以 309 加 0。",
    "output": "The PLOS publishing ethics team participated in the verification. Researchers retained only the three most suspicious manuscripts per editor and the three most suspicious co-authorships prior to submission for each manuscript, compiling a total of 7,738 cases to be submitted to PLOS; PLOS annotated 365 of these, consisting of the top 88 cases plus 277 selected from the subsequent 517 cases. The result was 309 true positives, 0 false positives, 52 cases of 'uncertain', and an additional 4 cases excluded because the metadata indicated editors who were not actually responsible for the editorial review. Among the 309 true positives, 36 papers had a second editor with no conflict of interest involved, 6 cases of conflict had previously been approved by PLOS, and 2 papers had already been addressed through correction procedures by PLOS. The reported precision was exactly 1.0, calculated as 309 divided by (309 plus 0)."
  },
  {
    "id": "950ea9b6ccee96366c7c50718af9cc695e6e27ea",
    "index": 42,
    "source": "试验先按地理位置和既有病例数据把 600 个村庄两两配对，再在每对中随机抽一个村接受干预，另一个作对照。对照村不做任何干预，且与干预村相距至少 2 公里。干预分 7 批推进，第一批于 2020 年 11 月 17–18 日启动，最后一批于 2021 年 1 月 5–6 日启动；同一对村庄总在同一批开始，每村干预持续 8 周。",
    "output": "The trial first paired 600 villages into pairs based on geographic location and existing case data, then randomly selected one village from each pair to receive intervention, with the other serving as a control. The control villages received no intervention and were at least 2 kilometers away from the intervention villages. The intervention was rolled out in seven batches, with the first batch starting on November 17–18, 2020, and the last batch starting on January 5–6, 2021; both villages in each pair began the intervention simultaneously within the same batch, and each village received intervention for a duration of 8 weeks."
  },
  {
    "id": "af60c035ab68c1a589b9558d7fb1d17e41cad69e",
    "index": 1,
    "source": "2008 年，美国俄勒冈州为低收入成年人的医疗补助计划（Medicaid）开放约 1 万个名额，89,824 人登记，州政府分 8 次抽签决定谁能申请。研究团队把这次抽签当作随机分配来分析：参保增加了就医，减少了医疗债务和抑郁，但在两年内没有测出血压、胆固醇和糖化血红蛋白的显著改善。",
    "output": "In 2008, the state of Oregon in the United States opened approximately 10,000 slots for the Medicaid program for low-income adults, with 89,824 people registering, and the state government conducted eight rounds of drawing to determine who could apply. The research team treated this drawing as a random assignment to analyze: enrollment increased healthcare utilization, reduced medical debt and depression, but no significant improvements in blood pressure, cholesterol, and hemoglobin A1c were observed within two years."
  },
  {
    "id": "d4bfd6478f2df4722b9312e424b3353b74760a12",
    "index": 134,
    "source": "伯克森的论证长期被批评为“只是理论上的反对，从未检验”。据 Snoep 等的梳理，1978 年 Roberts、Spitzer、Delmore 和 Sackett 用三项入户调查的数据做了检验：在 28 组疾病与疾病的关联中，多数在过去 6 个月住过院的人群里出现了或大或小的虚假关联。但他们也承认，很难把它与“临床选择偏倚”分开，也就是医生更倾向于收治同时有几种病的患者。1979 年，Sackett 把这种偏倚改称为“入院率偏倚”。",
    "output": "Berkson's argument has long been criticized as \"only theoretical opposition, never tested.\" According to Snoep et al.'s review, in 1978 Roberts, Spitzer, Delmore, and Sackett conducted a test using data from three household surveys: among 28 disease-disease associations, false associations of varying magnitudes were observed in groups of patients who had been hospitalized in the past six months. They also acknowledged that it was difficult to distinguish this from \"clinical selection bias,\" that is, physicians tend to admit patients who have multiple conditions simultaneously. In 1979, Sackett renamed this bias as \"hospitalization rate bias.\""
  },
  {
    "id": "e916d80c2dbaea7dab2ed58d1b0d98ab84f87382",
    "index": 37,
    "source": "随后分析员发现，每种坦克的变速箱编号只有一到两条不间断的递增数列，不必再处理号段空缺，少量样本就够用，一两辆新缴获的坦克就能更新产量估计；按原文记载，1944 年 11 月豹式（Mark V）坦克的产量在 1945 年 1 月就已算出。最常被引用的是豹式坦克负重轮的分析。诺曼底登陆前，盟军担心豹式坦克大量生产的传闻属实，而手上只有两辆可供检查：一辆由苏方转交，一辆由西方盟军缴获。每辆豹式坦克两侧共有 48 个带橡胶轮胎的负重轮，轮胎上印有模具编号。其中一家厂商出现过的最大模具号是 77，编号之间平均空缺约 3 个，分析员据此估计该厂约有 80 套模具；再向英国负重轮制造商请教单套模具的产能，扣除备件用量，并用 Mark III、IV、VI 坦克的模具数与产量之比交叉换算，两种算法都指向 1944 年 2 月每月约 270 辆的装配速度。战后核对，当月实际产量为 276 辆。",
    "output": "Subsequently, analysts found that for each tank model, the transmission numbers consisted of only one or two uninterrupted sequences of increasing numbers, eliminating the need to handle gaps in the numbering sequences; a small number of samples was sufficient, and just one or two newly captured tanks could update production estimates. As originally recorded, the production figure for the Panther (Mark V) tanks in November 1944 was calculated by January 1945. The most frequently cited analysis involved the study of the Panther tank's road wheels. Before the D-Day invasion, the Allied forces were concerned that reports of large-scale Panther tank production were accurate, and they had only two tanks available for inspection: one transferred from the Soviet side and one captured by Western Allied forces. Each Panther tank had a total of 48 road wheels with rubber tires, each tire bearing a mold number. One manufacturer had the highest mold number of 77, with an average gap of about three numbers between mold numbers; analysts estimated that the factory had approximately 80 mold sets. They then consulted the British road wheel manufacturer regarding the production capacity per mold set, deducted spare parts usage, and cross-referenced the ratio of mold numbers to production volumes for Mark III, IV, and VI tanks. Both methods pointed to a monthly production rate of approximately 270 units in February 1944. Post-war verification confirmed that the actual monthly output for that month was 276 units."
  },
  {
    "id": "fb957007dd44226123e1a3d095111f27783be194",
    "index": 118,
    "source": "AI 生成示意图：仅示意 cox.zph 估计的 Karnofsky 评分时变系数 β(t) 的大致走势。蓝线为平滑后的 β(t) 及置信带，灰线为 0，红色虚线为普通 Cox 模型的时不变系数；survival 包小册子描述该作用早期明显为负、约 200 天后与 0 相差不大。图中曲线并非由 veteran 数据实际运行得到，也无刻度，具体数值以下文算例输出为准。",
    "output": "AI-generated schematic: illustrates only the general trend of the time-varying coefficient β(t) estimated by cox.zph. The blue line shows the smoothed β(t) along with its confidence band, the gray line is zero, and the red dashed line represents the time-invariant coefficient in the standard Cox model; the survival booklet describes that this effect was initially明显 negative and became nearly indistinguishable from zero around 200 days later. The curves in the figure were not obtained from actual running of the veteran data, lack scales, and specific numerical values are as given in the following example output."
  }
];

test('QA11 recognizes all observed count forms while the omitted Karnofsky caption still fails',()=>{
 for(const row of observedQa11){
  if(row.id.startsWith('fb957')){rejects(row.source,row.output);passes(row.source,"AI-generated schematic: illustrates only the general trend of the time-varying coefficient β(t) for the Karnofsky score estimated by cox.zph. The blue line shows the smoothed β(t) along with its confidence band, the gray line is zero, and the red dashed line represents the time-invariant coefficient in the standard Cox model; the survival booklet describes that this effect was initially clearly negative and became nearly indistinguishable from zero around 200 days later. The curves in the figure were not obtained from actual running of the veteran data, lack scales, and specific numerical values are as given in the following example output.");}
  else passes(row.source,row.output);
 }
 // The original village output wrongly gives intervention to both villages;
 // numeric/date checks deliberately do not certify that semantic attribution.
 const village=observedQa11.find(row=>row.id.startsWith('950'));
 for(const [from,to] of [['seven batches','eight batches'],['November 17–18, 2020','November 17–19, 2020'],['January 5–6, 2021','January 5–6, 2022']])rejects(village.source,village.output.replace(from,to));
 const changes={'8ee':[['three most suspicious manuscripts','four most suspicious manuscripts'],['three most suspicious co-authorships','two most suspicious co-authorships']],af60:[['eight rounds','seven rounds']],d4bfd:[['six months','five months']],e916:[['three numbers','four numbers']]};
 for(const [prefix,mutations] of Object.entries(changes)){const row=observedQa11.find(r=>r.id.startsWith(prefix));for(const [from,to] of mutations)rejects(row.source,row.output.replace(from,to));}
});

test('QA11 finite count nouns preserve multiplicity without interpreting decimals, compounds or unrelated pronouns',()=>{
 for(const noun of ['manuscripts','co-authorships','rounds','months','numbers','batches']){
  passes('数量3。','There are three '+noun+'.');rejects('数量3。','There are four '+noun+'.');
  rejects('分别3和3。','There are three '+noun+'.');
  for(const word of ['one hundred and three','one hundred, three','one point two three','point three','minus three','negative three'])rejects('数量3。',word+' '+noun+'.');
  rejects('数量1。','One could compare '+noun+'.');
 }
 passes('3篇及3条。','Three most suspicious manuscripts and three most suspicious co-authorships.');
 rejects('3篇及3条。','Three most suspicious manuscripts.');
 rejects('数量3。','Three completely unrelated objects.');
 passes('数量3。','At this point three rounds remain.');
});

test('explicit same-month date ranges retain both full endpoints and their year',()=>{
 const source='2020年11月17–18日和2021年1月5–6日。';
 passes(source,'November 17–18, 2020 and January 5–6, 2021.');
 passes(source,'November 17, 2020 to November 18, 2020; January 5, 2021 to January 6, 2021.');
 for(const separator of ['-','–','—'])passes('2020年11月17'+separator+'18日。','November 17'+separator+'18, 2020.');
 for(const wrong of ['November 17–19, 2020','November 16–18, 2020','November 17–18, 2021','December 17–18, 2020','November 17, 2020','November 18–17, 2020','November 17–18','November 17–18, 20200'])rejects('2020年11月17–18日。',wrong);
 rejects('2020年11月17–18日，另有18例。','November 17–18, 2020.');
 rejects('2020年11月17–18日和2020年11月17–18日。','November 17–18, 2020.');
 passes('2020年11月17–18日，另有18例。','November 17–18, 2020, with 18 additional cases.');
});

test('observed caption zero forms retain actual baselines without inferring absent, fractional or negated values',()=>{
 for(const phrase of ['The gray line is zero.','The grey line is zero.','It is nearly indistinguishable from zero.']){
  passes('值为0。',phrase);rejects('值为1。',phrase);
  for(const replacement of ['one','zero point five','zero point 5','zero.5','zero-inflated','zero and a half','negative zero','minus zero'])rejects('值为0。',phrase.replace('zero',replacement));
 }
 passes('两处0和0。','The gray line is zero; the curve is indistinguishable from zero.');
 rejects('两处0和0。','The gray line is zero.');
 for(const prose of ['There is no difference.','The gray line is not zero.','The line has no effect.','They are indistinguishable.','The unrelated value is zero.'])rejects('值为0。',prose);
});

test('QA12 accepts the observed near-zero score distribution without changing a numeric value',()=>{
 const source="精确率 1.0 也只覆盖被标注的那一小部分。PLOS 标注的 365 条是排序靠前的案例，不是随机样本；由于语料中真实冲突的总数未知，作者明确表示无法计算召回率和准确率，52 条“不确定”也不在分母之内。PLOS 语料的得分分布明显挤在接近 0 的一端，作者的解读是：被标出的合著多半来自大型作者联合体，编辑与作者未必真正相识。换句话说，排名靠后的大量记录在规则上越了界，实际利害关系却可能很弱。",output="A precision of 1.0 covers only the small subset that was annotated. The 365 cases annotated by PLOS are the top-ranked examples, not a random sample; since the total number of actual conflicts in the corpus is unknown, the authors explicitly state that recall and accuracy cannot be calculated, and the 52 cases labeled as 'uncertain' are not included in the denominator. The score distribution in the PLOS corpus is clearly clustered near zero, and the authors interpret this as: the co-authors identified are mostly from large author consortia, and editors and authors may not actually know each other well. In other words, a large number of lower-ranked records exceed the rules in principle, but may have very weak actual interests at stake.";
 passes(source,output);rejects(source,output.replace('near zero','near one'));
 for(const value of ['zero point five','zero.5','zero and a half','negative zero'])rejects(source,output.replace('near zero','near '+value));
 rejects(source,output.replace('52 cases','53 cases'));
});

test('QA12 preserves the observed week/day range and three Friday sessions but still rejects the wrong person',()=>{
 const source="所有干预村拿到的是同一套核心方案，共五个部分：入户一次性免费发放口罩并讲解佩戴要点；8 周内每周 3–6 天在市场发放口罩；前 4 周内选 3 个星期五在清真寺发放；推广员在市场和公共场所提醒没戴口罩的人戴上；村干部和伊玛目带头示范，伊玛目在周五聚礼时宣读研究团队提供的讲稿。入户时还会播放一段短片，出镜者包括总理谢赫·哈西娜、伊玛目培训学院负责人和板球明星沙基布·阿尔·哈桑，并发放依据 WHO 材料制作的佩戴手册。",raw="All intervention villages received the same core intervention package consisting of five components: one-time free distribution of masks at household visits with instruction on proper wearing; mask distribution three to six days per week within eight weeks at markets; mask distribution on three Friday sessions within the first four weeks at mosques; outreach workers reminding individuals not wearing masks to put them on at markets and public places; village cadres and imams leading by example, with imams reciting the prepared script provided by the research team during Friday prayers; a short video was shown during household visits featuring Prime Minister Sheikha Hasina, the head of the Imams' Training Academy, and cricketer Shahidul Alam, and a WHO-based mask-wearing handbook was distributed.",output="All intervention villages received the same core intervention package consisting of five components: one-time free distribution of masks at household visits with instruction on proper wearing; mask distribution three to six days per week within eight weeks at markets; mask distribution on three Friday sessions within the first four weeks at mosques; outreach workers reminding individuals not wearing masks to put them on at markets and public places; village cadres and imams leading by example, with imams reciting the prepared script provided by the research team during Friday prayers; a short video was shown during household visits featuring Prime Minister Sheikha Hasina, the head of the Imams' Training Academy, and cricketer Shakib Al Hasan, and a WHO-based mask-wearing handbook was distributed.";
 rejects(source,raw);passes(source,output);
 for(const [from,to] of [['eight weeks','seven weeks'],['three to six days','three to five days'],['three Friday sessions','two Friday sessions'],['four weeks','five weeks']])rejects(source,output.replace(from,to));
 for(const bad of ['negative three days','one point three days'])rejects('3天。',bad);
 rejects('3次。','negative three Friday sessions.');rejects('8周。','eight and a half weeks.');
});

const observedQa13=[{"id":"8ee842f598b6b008d6659680587159fd81a6d733","source":"数据层面还有几处限制。MDPI 的 2,581 篇是在整个语料上按 3 年窗口统计的，而作者能确认 MDPI 明确禁止这类合作始于 2022 年 9 月，所以抽样标注只取此后投稿的稿件；部分 MDPI 文章列有多名处理编辑，作者无法确定发生冲突的那位是否真的经手。编辑身份靠姓名和单位匹配，PLOS 标注中有 4 例元数据所记编辑与出版商网站不符；MDPI 元数据没有单位，只能按姓名检索。工具还依赖需要授权的 Dimensions API；作者试过免费的 OpenAlex，但排名靠前的结果多由作者姓名消歧错误造成，暂未采用。","output":"There are several limitations at the data level. The 2,581 MDPI papers are statistically derived over a three-year window across the entire corpus, whereas the authors can confirm that MDPI explicitly prohibited such collaborations starting September 2022, so the sampling annotation only includes submissions made after that date; some MDPI articles list multiple handling editors, and the authors are unable to determine whether the specific editor involved actually processed the manuscript. Editor identities are matched by name and affiliation; there are four cases in the PLOS annotations where the metadata-recorded editors do not match those listed on the publisher's website; MDPI metadata lacks affiliations and can only be searched by name. The tool also relies on the Dimensions API, which requires authorization; the authors have tried OpenAlex, a free alternative, but the top-ranked results are frequently due to author name disambiguation errors, and it has not been adopted yet."},{"id":"e916d80c2dbaea7dab2ed58d1b0d98ab84f87382","source":"这几个数字并不矛盾。后验中位数（113）与无偏估计（114）几乎重合；后验均值（126.7）明显偏大，是因为后验分布左边被 96 截断、右边拖着长尾，少数很大的 N 把均值拉高。贝叶斯上界（200）比频率派上界（173）宽，来自均匀先验：它对很大的 N 和较小的 N 一视同仁，在只有 5 个样本时，这个假设本身就有分量。","output":"These numbers are not contradictory. The posterior median (113) is almost identical to the unbiased estimate (114); the posterior mean (126.7) is clearly higher because the posterior distribution is truncated on the left at 96 and has a long right tail, with a few very large N values pulling the mean upward. The Bayesian upper bound (200) is wider than the frequentist upper bound (173), arising from a uniform prior: it treats large N and small N equally, and this assumption itself carries weight even with only five samples."},{"id":"0aa383d0af3abdcd8514dab3e5bbcaee41a34336","source":"1991 年，费尔德在《美国社会学杂志》发表《为什么你的朋友比你朋友多》，把这一类现象统称为“班级规模悖论”。他用科尔曼（James Coleman）1961 年《青少年社会》中的友谊数据说明，多数人的朋友数少于其朋友们的平均朋友数。换成网络的语言：顺着一条随机挑出的友谊关系（网络中的一条边）找到的人，被抽中的机会与他的朋友数成正比——有 50 个朋友的人出现在 50 条边上，只有 1 个朋友的人只出现在 1 条边上。唐尼（Allen Downey）用斯坦福 SNAP 数据集中约 4000 名脸书用户算过：用户平均有 42 个朋友，而随机选出的“朋友”平均有 91 个。","output":"In 1991, Feld published 'Why Your Friends Have More Friends Than You Do' in the American Journal of Sociology, referring to this phenomenon as the 'class size paradox.' He used friendship data from James Coleman's 1961 work 'The Adolescent Society' to show that most individuals have fewer friends than the average number of friends among their friends. In network terms: the probability of encountering a person by following a randomly selected friendship link (a single edge in the network) is proportional to the number of friends that person has—someone with 50 friends appears on 50 edges, while someone with only one friend appears on just one edge. Downey calculated using approximately 4,000 Facebook users from the Stanford SNAP dataset: users on average had 42 friends, while the average number of friends among randomly selected 'friends' was 91."},{"id":"5a2e59b20e2fd0c8fe8611deffb6a1e1cbe43576","source":"在 USArrests 上，这几条规则并不一致：Kaiser 准则只保留 PC1，因为 PC2 的特征值 0.990 差一点到 1；碎石图在第 3 个成分处转平，按拐点之前截断是 2 个；累计 86.8% 的比例也支持保留两个。规则只是参考，最终要看主成分用来做什么。","output":"On USArrests, these rules are not consistent: Kaiser criterion retains only PC1 because PC2's eigenvalue of 0.990 is just short of 1; the scree plot levels off at the third principal component, and truncating before the bend point gives two; the cumulative proportion of 86.8% also supports retaining two. The rules are merely references, and the final decision depends on what the principal components are used for."},{"id":"8669bcbe1e3d5baa277e49617e8fdaa094eccd73","source":"2010 年，Nicholas Christakis 与 James Fowler 在 PLoS ONE 报告了一次实地检验。他们跟踪 2009 年 9 月 1 日至 12 月 31 日哈佛学院的流感：从 6650 名本科生中随机抽取 319 人，再纳入被这些人提名的 425 名朋友，共 744 人。按校医诊断，朋友组的累计发病曲线比随机组提前约 13.9 天（95% 置信区间 9.9–16.6 天）；疫情第 16 天朋友组已显著领先，比全体每日发病高峰早 46 天。以自报症状为准时，提前量只有 3.2 天。作者也指出，能提前多少取决于疫情和网络本身；这项研究只涉及一所大学的一次流感季。","output":"In 2010, Nicholas Christakis and James Fowler reported a field study in PLoS ONE. They tracked influenza at Harvard College from September 1 to December 31, 2009: a random sample of 319 students from 6,650 undergraduates, plus 425 friends nominated by these students, totaling 744 individuals. According to physician diagnoses, the cumulative incidence curve of the friends group was approximately 13.9 days (95% confidence interval 9.9–16.6 days) ahead of the random group; by day 16 of the outbreak, the friends group had significantly led, being 46 days ahead of the overall daily peak. When based on self-reported symptoms, the lead time was only 3.2 days. The authors also noted that the extent of the lead time depends on both the outbreak and the network itself; this study only involved one university during one influenza season."},{"id":"950ea9b6ccee96366c7c50718af9cc695e6e27ea","source":"所有干预村拿到的是同一套核心方案，共五个部分：入户一次性免费发放口罩并讲解佩戴要点；8 周内每周 3–6 天在市场发放口罩；前 4 周内选 3 个星期五在清真寺发放；推广员在市场和公共场所提醒没戴口罩的人戴上；村干部和伊玛目带头示范，伊玛目在周五聚礼时宣读研究团队提供的讲稿。入户时还会播放一段短片，出镜者包括总理谢赫·哈西娜、伊玛目培训学院负责人和板球明星沙基布·阿尔·哈桑，并发放依据 WHO 材料制作的佩戴手册。","output":"All intervention villages received the same core package consisting of five components: one-time free distribution of masks at household visits with instructions on proper wearing; mask distribution three to six days per week in markets over an eight-week period; mask distribution on three Friday selections within the first four weeks; outreach workers reminding individuals not wearing masks to put them on in markets and public places; village committee members and imams leading by example, with imams reciting the prepared script provided by the research team during Friday prayers; a short video was shown during household visits featuring Prime Minister Sheikha Hasina, the head of the Imams' Training College, and the cricketer Shakib Al Hasan, along with distribution of a mask-wearing handbook prepared based on WHO materials."}];

test('QA13 preserves the six observed count, duration, component and cross-month date fragments',()=>{
 for(const row of observedQa13)passes(row.source,row.output);
 const changes=[['three-year','four-year'],['five samples','six samples'],['one edge','two edges'],['third principal component','fourth principal component'],['September 1 to December 31, 2009','September 2 to December 31, 2009'],['eight-week','seven-week']];
 for(let i=0;i<observedQa13.length;i++){const row=observedQa13[i],[from,to]=changes[i];rejects(row.source,row.output.replace(from,to));}
 rejects(observedQa13[0].source,observedQa13[0].output.replace('four cases','three cases'));
 rejects(observedQa13[3].source,observedQa13[3].output.replaceAll('two','one'));
 rejects(observedQa13[5].source,observedQa13[5].output.replace('three Friday selections','two Friday selections'));
 rejects(observedQa13[5].source,observedQa13[5].output.replace('Shakib Al Hasan','Shahidul Alam'));
 // Numeric equivalence is not semantic approval: Sheikha Hasina remains a
 // full-article name review item, as does the prior control-group attribution.
});

test('QA13 count heads and duration adjectives do not borrow negative, decimal or large-number tails',()=>{
 for(const noun of ['cases','samples','edges','components','Friday selections']){
  const source=noun.startsWith('Friday')?'周五数量3。':'数量3。';
  passes(source,'Three '+noun+'.');rejects(source,'Four '+noun+'.');
  for(const word of ['negative three','minus three','−three','one point three','point three','one hundred and three','one hundred, three'])rejects(source,word+' '+noun+'.');
  rejects(source.replace('3','1'),'One could compare '+noun+'.');
 }
 for(const unit of ['year','month','week','day']){
  passes('时长3。','A three-'+unit+' period.');rejects('时长3。','A four-'+unit+' period.');
  for(const word of ['negative three','minus three','−three','-three','one point three','point three','one hundred and three'])rejects('时长3。','A '+word+'-'+unit+' period.');
  rejects('时长3。','A three-'+unit+' and a half period.');
 }
 rejects('数量3。','Three unrelated objects.');rejects('数量1。','One-yearning person.');
 rejects('两个量3和3。','Three cases.');
});

test('QA13 component ordinals and elliptical counts require their explicit component grammar',()=>{
 passes('2个主成分。','Two principal components.');rejects('2个主成分。','Three principal components.');
 passes('第3个成分，保留2个。','The third principal component is the elbow; the scree plot gives two.');
 passes('第3个主成分，保留2个。','The 3rd principal component is the elbow; the principal component rule retains two.');
 rejects('第3个成分。','There are three components.');rejects('数量3。','The third principal component.');
 rejects('第3个成分。','The first principal component.');rejects('第3个成分，第3个成分。','The third principal component.');
 for(const word of ['one hundred and third','thirty third','negative third','minus third','−third','-third','point third','one point two third','one point 2 third','one thousand third','thirty-third','thirty–third','thirty‐third','1.3rd','1/3rd','−3rd'])rejects('第3个成分。','The '+word+' principal component.');
 passes('第3个成分。','The third principal component.');passes('第3个成分。','The 3rd component.');passes('第23个成分。','The twenty-third principal component.');passes('第23个成分。','The twenty third principal component.');
 for(const prose of ['It gives two.','One retains two.','The first study gives two.','The principal component matters. It gives two.','The principal component rule gives two point five.','The scree plot gives two and a half.','The principal component rule retains negative two.','The scree plot gives one hundred and two.'])rejects('数量2。',prose);
});

test('QA13 cross-month ranges bind one year to both exact ordered endpoints only',()=>{
 const source='2009年9月1日至12月31日。';
 passes(source,'September 1 to December 31, 2009.');passes(source,'September 1, 2009 to December 31, 2009.');
 passes('2008年1月28日至2月29日。','January 28 to February 29, 2008.');
 for(const output of ['September 2 to December 31, 2009.','September 1 to December 30, 2009.','October 1 to December 31, 2009.','September 1 to December 31, 2010.','December 31 to September 1, 2009.','December 31, 2009 to September 1, 2009.','September 1 to December 31. It was 2009.','September 1 to December 31, 20090.','September 1, 2009 to December 31, 2010.','September 1, 2010 to December 31, 2009.','September 1 to December 32, 2009.'])rejects(source,output);
 rejects('2009年1月28日至2月28日。','January 28 to February 29, 2009.');
 rejects(source+source,'September 1 to December 31, 2009.');
});

const observedQa14=[{"id":"408c99dde9a371a659270da102982bf7f5c210aa","source":"实测用的是覆盖 57 个科目的选择题考试 MMLU。作者在各科均匀抽取 1,500 题，剔除“以上皆是”这类选项相互引用、打乱顺序就会失效的题目。参评的是 5 家开发者的 6 个 30 亿至 40 亿参数开源模型：Qwen3-4B、Qwen2.5-3B-Instruct、Phi-4-mini-instruct、Granite 4.1 3B、SmolLM3-3B 和 Falcon3-3B-Instruct，单独准确率在 58.3% 到 72.7% 之间（四选一瞎猜为 25%）。原计划的 Llama 3.2 3B 因下载失败未纳入；AI2 的 10 亿参数模型 OLMo-2 准确率仅 40%，低于 50%，被排除在分析之外。每个模型使用标准五样本提示，不做随机采样，直接读取它给下一个词元 A、B、C、D 的概率，因此结果可以复现。为排除“偏爱某个字母”造成的虚假一致，每个模型看到的选项顺序各自随机打乱，答案再映射回原选项后比较。","raw":"The evaluation used the MMLU multiple-choice exam covering 57 subjects. The authors uniformly sampled 1,500 questions per subject and excluded questions with options such as 'all of the above' that would become invalid if the order were randomized. The evaluated models are six open-source models developed by five different teams, each with parameters ranging from 3 billion to 40 billion: Qwen3-4B, Qwen2.5-3B-Instruct, Phi-4-mini-instruct, Granite 4.1 3B, SmolLM3-3B, and Falcon3-3B-Instruct, with individual accuracy ranging from 58.3% to 72.7% (baseline random guessing at 25% for four options). The originally planned Llama 3.2 3B model was excluded due to download failure; AI2's 10-billion-parameter model OLMo-2 achieved only 40% accuracy, below the 50% threshold, and was therefore excluded from the analysis. Each model used a standard five-sample prompt without random sampling, directly reading the probabilities assigned to the next token A, B, C, D, ensuring reproducible results. To eliminate false consistency caused by a preference for a particular letter, the order of the options seen by each model was randomly shuffled, and the answers were then mapped back to the original option order for comparison.","output":"The evaluation used the MMLU multiple-choice exam covering 57 subjects. The authors uniformly sampled 1,500 questions per subject and excluded questions with options such as 'all of the above' that would become invalid if the order were randomized. The evaluated models are six open-source models developed by five different teams, each with parameters ranging from 3 billion to 4 billion: Qwen3-4B, Qwen2.5-3B-Instruct, Phi-4-mini-instruct, Granite 4.1 3B, SmolLM3-3B, and Falcon3-3B-Instruct, with individual accuracy ranging from 58.3% to 72.7% (baseline random guessing at 25% for four options). The originally planned Llama 3.2 3B model was excluded due to download failure; AI2's 1-billion-parameter model OLMo-2 achieved only 40% accuracy, below the 50% threshold, and was therefore excluded from the analysis. Each model used a standard five-sample prompt without random sampling, directly reading the probabilities assigned to the next token A, B, C, D, ensuring reproducible results. To eliminate false consistency caused by a preference for a particular letter, the order of the options seen by each model was randomly shuffled, and the answers were then mapped back to the original option order for comparison."},{"id":"6cb5873dabb4ef2176fe8a7632aa3e032286b20a","source":"βⱼ 表示其他预测变量保持不变时，xⱼ 每增加 1 个单位，对数优势的变化量；exp(βⱼ) 是优势的乘数，也就是该变量校正后的优势比。截距的指数 exp(β₀) 是所有预测变量都取 0 时的优势，变量多时这个“基线”未必对应真实存在的人群。βⱼ>0 表示事件的优势和概率都随 xⱼ 增大而上升，βⱼ<0 则相反。连续变量的单位会改变优势比的数值：年龄按 10 岁为单位时，优势比是按 1 岁为单位时的 10 次方。","raw":"βⱼ represents the change in the log-odds of the outcome when xⱼ increases by 1 unit, with all other predictor variables held constant; exp(βⱼ) is the multiplicative odds ratio, i.e., the odds ratio for that variable adjusted for other predictors. The exponential of the intercept, exp(β₀), is the odds when all predictor variables are zero; this 'baseline' may not correspond to any realistically existing population when many variables are present. If βⱼ > 0, the odds and probability of the event increase as xⱼ increases; if βⱼ < 0, they decrease. The unit of a continuous variable affects the numerical value of the odds ratio: when age is measured in 10-year increments, the odds ratio is the 10th power of the odds ratio calculated per one-year increment.","output":"βⱼ represents the change in the log-odds of the outcome when xⱼ increases by 1 unit, with all other predictor variables held constant; exp(βⱼ) is the multiplicative odds ratio, i.e., the odds ratio for that variable adjusted for other predictors. The exponential of the intercept, exp(β₀), is the odds when all predictor variables are zero; this 'baseline' may not correspond to any realistically existing population when many variables are present. If βⱼ > 0, the odds and probability of the event increase as xⱼ increases; if βⱼ < 0, they decrease. The unit of a continuous variable affects the numerical value of the odds ratio: when age is measured in 10-year increments, the odds ratio is the 10th power of the odds ratio calculated per one-year increment."}];

test('QA14 accepts the observed explicit predictor zero without guessing fractional or negated values',()=>{
 const row=observedQa14.find(row=>row.id.startsWith('6cb'));passes(row.source,row.raw);
 for(const value of ['one','zero point five','zero.5','zero and a half','zero-inflated','negative zero','minus zero','not zero'])rejects(row.source,row.raw.replace('predictor variables are zero','predictor variables are '+value));
 passes('值0。','The predictor variable is zero.');rejects('值0。','The unrelated variable is zero.');
});

test('QA14 recognizes the actual team count but continues rejecting both tenfold model parameter errors',()=>{
 const row=observedQa14.find(row=>row.id.startsWith('408'));rejects(row.source,row.raw);passes(row.source,row.output);
 rejects(row.source,row.output.replace('4 billion','40 billion'));rejects(row.source,row.output.replace('1-billion-parameter','10-billion-parameter'));
 rejects(row.source,row.output.replace('five different teams','six different teams'));rejects(row.source,row.output.replace('from 3 billion','from 2 billion'));
 passes('10亿至40亿。','1 billion to 4 billion.');rejects('10亿至40亿。','10 billion to 40 billion.');
});

test('QA14 team counts retain multiplicity and bounded lexical values',()=>{
 passes('5组。','Five different teams.');passes('1组。','One team.');rejects('5组和5组。','Five teams.');
 for(const value of ['negative five','minus five','−five','one point five','point five','one hundred and five','one hundred, five'])rejects('5组。',value+' teams.');
 rejects('1组。','One could coordinate teams.');rejects('5组。','Five and a half teams.');
});

const observedQa14Batch=[{"id":"5a2e59b20e2fd0c8fe8611deffb6a1e1cbe43576","source":"运行后，summary 给出的累计方差比例依次为 0.620、0.868、0.957、1.000。碎石图上，特征值从第 1 个到第 2 个成分骤降，第 2 到第 3 个继续明显下降，之后趋平；虚线 y = 1 从第 2 个点上方紧贴着掠过，直观显示出 Kaiser 准则与拐点判断的分歧。Python 用户可以用 statsmodels 的 get","output":"After running, the cumulative variance proportions given by summary are sequentially 0.620, 0.868, 0.957, 1.000. On the scree plot, the eigenvalues drop sharply from the first to the second component, continue to decrease noticeably from the second to the third component, and then level off; the dashed line y = 1 closely passes just above the second point, intuitively illustrating the discrepancy between the Kaiser criterion and the elbow point judgment. Python users can use statsmodels' get"},{"id":"889fddd304b476eda62266cfcf930a81cb66f333","source":"Ludwig 等 2012 年在 Science 上用同一批数据分析主观幸福感。他们估计，社区贫困率下降 1 个标准差（13 个百分点）带来的幸福感提升，相当于年收入相差 13,000 美元的人之间的幸福感差距，而对照组平均收入约为 20,000 美元。论文还发现，主观幸福感对社区经济劣势的反应强于对种族隔离的反应。","output":"Ludwig et al. analyzed the same dataset in Science in 2012 to examine subjective well-being. They estimated that the increase in well-being resulting from a one-standard-deviation decrease (13 percentage points) in community poverty rate is equivalent to the difference in well-being between individuals whose annual incomes differ by $13,000, with the control group having an average income of about $20,000. The paper also found that subjective well-being responds more strongly to community economic disadvantage than to racial segregation."}];

test('QA14 batch preserves both actual ordinal-range and standard-deviation fragments',()=>{
 for(const row of observedQa14Batch)passes(row.source,row.output);
 const component=observedQa14Batch.find(row=>row.id.startsWith('5a2'));
 for(const [from,to] of [['0.620','0.621'],['first to the second component','second to the first component'],['second to the third component','second to the fourth component'],['second point','third point']])rejects(component.source,component.output.replace(from,to));
 const standard=observedQa14Batch.find(row=>row.id.startsWith('889'));
 rejects(standard.source,standard.output.replace('one-standard-deviation','two-standard-deviation'));
 rejects(standard.source,standard.output.replace('13 percentage points','14 percentage points'));
});

test('QA14 batch standard-deviation quantities do not generalize to arbitrary adjectives or incomplete numbers',()=>{
 passes('1个标准差。','A one-standard-deviation decrease.');passes('1个标准差。','One standard deviation.');
 passes('2个标准差。','Two standard deviations.');rejects('1个标准差。','Two standard deviations.');
 for(const word of ['negative one','minus one','−one','one point one','point one','one hundred and one'])rejects('1个标准差。','A '+word+'-standard-deviation decrease.');
 rejects('1个标准差。','A one-standard-deviation-and-a-half decrease.');
 rejects('数量1。','A one-important-adjective.');rejects('两个量1和1。','One standard deviation.');
});

test('QA14 batch component ranges preserve ordered pairs, shared heads and repeated endpoints on both sides',()=>{
 passes('第1个到第2个成分。','From the first to the second component.');
 passes('第1个成分到第2个成分。','From the first component to the second component.');
 passes('第3个到第2个成分。','From the third to the second component.');
 rejects('第3个到第2个成分。','From the second to the third component.');
 const source='第1个到第2个成分骤降，第2到第3个继续下降。',output='From the first to the second component, then from the second to the third component.';
 passes(source,output);rejects(source,output.replace('first to the second','second to the first'));
 rejects(source,output.replace('second to the third','third to the second'));
 rejects('第1个到第2个成分，第1个到第2个成分。','First to the second component.');
 rejects('第1个到第2个成分。','The first component and the second component.');
 for(const boundary of ['。','；','\n'])rejects('第1个到第2个成分'+boundary+'第2到第3个继续下降。',output);
 rejects('第1个到第2个成分，第2到第3个点继续下降。',output);
 rejects('第1个到第2个成分。','First point to the second component.');
 rejects('第1个到第2个成分。','First to the second point.');
 passes('第2个点。','The second point.');rejects('第2个点。','The second component.');rejects('数量2。','The second point.');
 for(const word of ['one hundred and third','thirty third','negative third','minus third','point third','1.3rd','thirty-third','thirty–third']){
  rejects('第3个到第4个成分。','The '+word+' to the fourth component.');
  rejects('第2个到第3个成分。','The second to the '+word+' component.');
 }
 passes('第23个到第24个成分。','The twenty-third to the twenty-fourth component.');
});

const observedQa15={"source":"普通 Cox 模型里 karno 高度显著，但 cox.zph 对它的比例风险检验 p = 0.00107，说明作用随时间变化。按 0–90 天、90–180 天和 180 天以上分段后，前 90 天评分每高 10 分的风险比为 exp(−0.48755) ≈ 0.61，后两段系数接近 0 且不显著，分段模型的全局比例风险检验 p = 0.154。连续形式估计出 β(t) = −0.125 + 0.021 · log(t + 20)：随访起点评分每高 10 分的风险比约为 exp(−0.608) ≈ 0.54，到第 200 天约为 exp(−0.097) ≈ 0.91，已接近 1。相比之下，普通模型给出的 0.71（每 10 分）只是整个随访期的平均。小册子同时交代了局限：这条对数直线在 200 天以后偏高，又低估了初期的斜率；分段切点是看图后选的，各段差异的检验有偏。对于作用衰减的原因，小册子给出两种解释，即急性病中半年前的测量已不再相关，或低分病人早期大量死亡造成选择，但并未判定哪一种成立。","output":"In the standard Cox model, karno is highly significant, but the Cox.zph test for its proportional hazards assumption yields p = 0.00107, indicating that its effect changes over time. After stratifying into periods 0–90 days, 90–180 days, and beyond 180 days, the hazard ratio for every 10-point increase in score during the first 90 days is exp(−0.48755) ≈ 0.61; the coefficients for the latter two periods are close to zero and not statistically significant; the global proportional hazards test for the stratified model yields p = 0.154. The continuous form estimates β(t) = −0.125 + 0.021 · log(t + 20): the hazard ratio for every 10-point increase in baseline score at the start of follow-up is approximately exp(−0.608) ≈ 0.54, and by day 200 it is approximately exp(−0.097) ≈ 0.91, approaching 1. In contrast, the standard model gives 0.71 (per 10 points), which represents only the average over the entire follow-up period. The booklet also outlines limitations: the logarithmic line overestimates the hazard beyond day 200 and underestimates the initial slope; the cutpoints for stratification were selected based on visual inspection of the plot, and the tests for differences between strata are biased. Regarding the reason for the attenuation of effect, the booklet proposes two explanations: that measurements taken six months prior to acute illness are no longer relevant, or that early large-scale mortality among low-score patients leads to selection bias; however, it does not determine which explanation is valid."};

test('QA15 accepts the observed explicitly close-to-zero coefficients while retaining value and fractional-negation boundaries',()=>{
 passes(observedQa15.source,observedQa15.output);
 for(const replacement of ['are close to one','are close to zero point five','are close to zero.5','are close to zero and a half','are close to zero-inflated','are close to negative zero','are not close to zero','are never close to zero'])rejects(observedQa15.source,observedQa15.output.replace('are close to zero',replacement));
 rejects(observedQa15.source,observedQa15.output.replace('p = 0.154','p = 0.155'));
 for(const verb of ['is','are','was','were'])passes('系数接近0。','The coefficient '+verb+' close to zero.');
 rejects('系数接近1。','The coefficient is close to zero.');rejects('两处0和0。','The coefficients are close to zero.');
 rejects('系数接近0。','The coefficient is not close to zero.');rejects('系数接近0。','An unrelated zero was mentioned.');
 // These are numeric checks only. The actual response's stratified-model
 // terminology, Cox.zph casing and invented hazard object still need review.
});

const observedQa16=[{"id":"0aa383d0af3abdcd8514dab3e5bbcaee41a34336","source":"直觉被带偏，往往是因为默认“我看到的”就是“全体的”。唐尼 2015 年整理过几个日常例子：他记录波士顿地铁红线下午 4 点到 5 点之间约 70 趟列车的到站时间，列车平均间隔 7.8 分钟，乘客经历的间隔平均 8.8 分钟，平均等待约 4.4 分钟，比按平均间隔推算的多约 15%；航空公司抱怨空座太多、乘客却觉得航班总是很满；按他对美国联邦刑期的粗略估算，刑期均值约 121 个月，而在随机时刻随机遇到的犯人，刑期均值约 183 个月。偏差大小取决于分布有多分散：红线的间隔差异不算大，偏差也温和；朋友数这类长尾分布，偏差可以超过一倍。","raw":"Intuition is biased because we default to thinking that 'what I see' represents 'the whole'. In 2015, Downey collected several everyday examples: he recorded the arrival times of about 70 trains on the Boston Red Line between 4 and 5 p.m., finding an average headway of 7.8 minutes between trains, an average passenger experience headway of 8.8 minutes, and an average waiting time of about 4.4 minutes—about 15% longer than what would be expected based on the average headway; airlines complain about too many empty seats, while passengers feel flights are always full; based on his rough estimate of U.S. federal prison sentences, the average sentence is about 121 months, whereas the average sentence encountered at a random moment is about 183 months. The magnitude of the bias depends on how dispersed the distribution is: the headway variation on the Red Line is not large, and the bias is mild; for long-tailed distributions like the number of friends, the bias can exceed a factor of two.","output":"Intuition is biased because we default to thinking that 'what I see' represents 'the whole'. In 2015, Downey collected several everyday examples: he recorded the arrival times of about 70 trains on the Boston Red Line between 4 and 5 p.m., finding an average headway of 7.8 minutes between trains, an average passenger experience headway of 8.8 minutes, and an average waiting time of about 4.4 minutes—about 15% longer than what would be expected based on the average headway; airlines complain about too many empty seats, while passengers feel flights are always full; based on his rough estimate of U.S. federal prison sentences, the average sentence is about 121 months, whereas the average sentence encountered at a random moment is about 183 months. The magnitude of the bias depends on how dispersed the distribution is: the headway variation on the Red Line is not large, and the bias is mild; for long-tailed distributions like the number of friends, the bias can exceed a factor of two."},{"id":"2357d27cf3df9200b53d270fc0787248c8c941a9","source":"Power 是免费的独立程序，第 3 版覆盖 t、F、χ² 检验族，以及 z 检验和部分精确检验（Faul 等, 2007）。本例在 G","raw":"Power is a free standalone program, version 3 covers t, F, χ² test families, as well as z tests and some exact tests (Faul et al., 2007). This example in G","output":"Power is a free standalone program, version 3 covers t, F, χ² test families, as well as z tests and some exact tests (Faul et al., 2007). This example in G"},{"id":"408c99dde9a371a659270da102982bf7f5c210aa","source":"实测用的是覆盖 57 个科目的选择题考试 MMLU。作者在各科均匀抽取 1,500 题，剔除“以上皆是”这类选项相互引用、打乱顺序就会失效的题目。参评的是 5 家开发者的 6 个 30 亿至 40 亿参数开源模型：Qwen3-4B、Qwen2.5-3B-Instruct、Phi-4-mini-instruct、Granite 4.1 3B、SmolLM3-3B 和 Falcon3-3B-Instruct，单独准确率在 58.3% 到 72.7% 之间（四选一瞎猜为 25%）。原计划的 Llama 3.2 3B 因下载失败未纳入；AI2 的 10 亿参数模型 OLMo-2 准确率仅 40%，低于 50%，被排除在分析之外。每个模型使用标准五样本提示，不做随机采样，直接读取它给下一个词元 A、B、C、D 的概率，因此结果可以复现。为排除“偏爱某个字母”造成的虚假一致，每个模型看到的选项顺序各自随机打乱，答案再映射回原选项后比较。","raw":"The evaluation used the MMLU multiple-choice exam covering 57 subjects. The authors uniformly sampled 1,500 questions per subject and excluded questions with options such as 'all of the above' that would become invalid if the order were randomized. The evaluated models are six open-source models developed by five different teams, with parameters ranging from 3 billion to 4 billion: Qwen3-4B, Qwen2.5-3B-Instruct, Phi-4-mini-instruct, Granite 4.1 3B, SmolLM3-3B, and Falcon3-3B-Instruct. Their individual accuracy ranges from 58.3% to 72.7% (baseline random guessing at 25% for four options). The originally planned Llama 3.2 3B model was excluded due to download failure; AI2's 10-billion-parameter model OLMo-2 achieved only 40% accuracy, below the 50% threshold, and was therefore excluded from the analysis. Each model used a standard five-sample prompt without random sampling, directly reading the probabilities assigned to the next token A, B, C, D, ensuring reproducible results. To eliminate false consistency caused by a preference for a particular letter, the order of the options was randomly shuffled for each model, and the answers were then mapped back to the original option order for comparison.","output":"The evaluation used the MMLU multiple-choice exam covering 57 subjects. The authors uniformly sampled 1,500 questions per subject and excluded questions with options such as 'all of the above' that would become invalid if the order were randomized. The evaluated models are six open-source models developed by five different teams, with parameters ranging from 3 billion to 4 billion: Qwen3-4B, Qwen2.5-3B-Instruct, Phi-4-mini-instruct, Granite 4.1 3B, SmolLM3-3B, and Falcon3-3B-Instruct. Their individual accuracy ranges from 58.3% to 72.7% (baseline random guessing at 25% for four options). The originally planned Llama 3.2 3B model was excluded due to download failure; AI2's 1-billion-parameter model OLMo-2 achieved only 40% accuracy, below the 50% threshold, and was therefore excluded from the analysis. Each model used a standard five-sample prompt without random sampling, directly reading the probabilities assigned to the next token A, B, C, D, ensuring reproducible results. To eliminate false consistency caused by a preference for a particular letter, the order of the options was randomly shuffled for each model, and the answers were then mapped back to the original option order for comparison."},{"id":"6cb5873dabb4ef2176fe8a7632aa3e032286b20a","source":"优势比在整条曲线上是恒定的乘数，概率的变化量却随基线而变。对 π 求导得 dπ/dx = β·π(1−π)，在 π = 0.5 时最大，等于 β/4。例如某连续变量 β = 0.2，每增加 1 个单位，优势乘以 e^0.2 ≈ 1.22；基线概率在 50% 附近时，概率约上升 5 个百分点，基线概率为 10% 时只上升约 1.8 个百分点。因此报告结果时，宜同时给出优势比和典型取值下的预测概率或概率差。","raw":"The odds ratio is a constant multiplier along the entire curve, while the change in probability varies with the baseline. The derivative of π is dπ/dx = β·π(1−π), which is maximized at π = 0.5, equaling β/4. For example, with a continuous variable β = 0.2, each one-unit increase multiplies the odds by e^0.2 ≈ 1.22; when the baseline probability is near 50%, the probability increases by approximately 5 percentage points, but when the baseline probability is 10%, the increase is only about 1.8 percentage points. Therefore, when reporting results, it is advisable to provide both the odds ratio and the predicted probability or probability difference under typical values.","output":"The odds ratio is a constant multiplier along the entire curve, while the change in probability varies with the baseline. The derivative of π is dπ/dx = β·π(1−π), which is maximized at π = 0.5, equaling β/4. For example, with a continuous variable β = 0.2, each one-unit increase multiplies the odds by e^0.2 ≈ 1.22; when the baseline probability is near 50%, the probability increases by approximately 5 percentage points, but when the baseline probability is 10%, the increase is only about 1.8 percentage points. Therefore, when reporting results, it is advisable to provide both the odds ratio and the predicted probability or probability difference under typical values."},{"id":"81c297ca6f37fb656a9138fe542a5ab8d46c7b64","source":"这项评估的对象是“小学驱虫项目”（Primary School Deworming Project，PSDP），由荷兰非营利组织 ICS（Internationaal Christelijk Steunfonds Africa）与布西亚区卫生部门合作实施。项目区位于肯尼亚西部布西亚区南部，是该区肠道蠕虫感染率最高的地带。75 所项目学校几乎涵盖了区内全部农村小学，在校学生超过 3 万名，年龄 6 至 18 岁。论文刊于《Econometrica》2004 年 1 月号（第 72 卷第 1 期，159–217 页），在线首发日期为 2003 年 12 月 10 日。","raw":"The evaluation focuses on the 'Primary School Deworming Project' (PSDP), implemented in collaboration between the Dutch non-profit organization ICS (Internationaal Christelijk Steunfonds Africa) and the Busia District Health Department. The project area is in southern Busia District, western Kenya, a region with the highest prevalence of intestinal worm infections in the district. Seventy-five project schools cover nearly all rural primary schools in the area, with over 30,000 students enrolled, aged between 6 and 18 years. The paper is published in Econometrica, January 2004 (Volume 72, Issue 1, pages 159–217), with online first publication date of December 10, 2003.","output":"The evaluation focuses on the 'Primary School Deworming Project' (PSDP), implemented in collaboration between the Dutch non-profit organization ICS (Internationaal Christelijk Steunfonds Africa) and the Busia District Health Department. The project area is in southern Busia District, western Kenya, a region with the highest prevalence of intestinal worm infections in the district. Seventy-five project schools cover nearly all rural primary schools in the area, with over 30,000 students enrolled, aged between 6 and 18 years. The paper is published in Econometrica, January 2004 (Volume 72, Issue 1, pages 159–217), with online first publication date of December 10, 2003."},{"id":"af60c035ab68c1a589b9558d7fb1d17e41cad69e","source":"州政府在 2008 年 3 月至 9 月间进行了 8 次抽签，每次抽出的人数大致相同，共抽中 35,169 人，来自 29,664 户。抽中者本人及其家庭成员获得申请资格，需在州政府寄出申请表后 45 天内交回材料，符合条件即可入保。研究者先按事先信息剔除不在研究范围内的人（州外地址、年龄不符、抽签前已去世、机构地址、由第三方代为登记、研究期内将转入 Medicare、名单重复），得到 74,922 人（66,385 户）的研究总体：抽中的 29,834 人为处理组，未抽中的 45,088 人为对照组。抽签以个人为单位，但申请资格落到整户，所以分析中控制了每户登记人数，标准误按家庭聚类。","raw":"The state government conducted 8 draws from March to September 2008, each drawing approximately the same number of individuals, resulting in a total of 35,169 individuals from 29,664 households. The individuals selected and their household members were eligible to apply, and had to return the application materials within 45 days of receiving the application form from the state government, with eligibility for coverage determined upon meeting the criteria. Researchers first excluded individuals not within the study scope based on pre-existing information (out-of-state addresses, age mismatches, death prior to the draw, institutional addresses, third-party registration, transition to Medicare during the study period, duplicate entries), resulting in a study population of 74,922 individuals (66,385 households): 29,834 individuals who were selected formed the treatment group, and 45,088 individuals who were not selected formed the control group. The draws were conducted on an individual basis, but eligibility applied to the entire household, so analysis controlled for the number of registered individuals per household, with standard errors adjusted for household clustering.","output":"The state government conducted 8 draws from March to September 2008, each drawing approximately the same number of individuals, resulting in a total of 35,169 individuals from 29,664 households. The individuals selected and their household members were eligible to apply, and had to return the application materials within 45 days of receiving the application form from the state government, with eligibility for coverage determined upon meeting the criteria. Researchers first excluded individuals not within the study scope based on pre-existing information (out-of-state addresses, age mismatches, death prior to the draw, institutional addresses, third-party registration, transition to Medicare during the study period, duplicate entries), resulting in a study population of 74,922 individuals (66,385 households): 29,834 individuals who were selected formed the treatment group, and 45,088 individuals who were not selected formed the control group. The draws were conducted on an individual basis, but eligibility applied to the entire household, so analysis controlled for the number of registered individuals per household, with standard errors adjusted for household clustering."},{"id":"e916d80c2dbaea7dab2ed58d1b0d98ab84f87382","source":"这个方法有明确的使用条件，Ruggles 与 Brodie 的原文里处处是对条件的检验。第一，编号要从已知起点连续分配；底盘号段的空缺迫使分析员额外估算百号块的使用率，Goodman 也专门讨论过起始编号未知的情形。第二，样本要近似随机；轮胎样本里飞机轮胎占了近一半，而按序列号推算飞机轮胎只占产量的 15%，因为样本多取自在英国被击落的德军飞机，分析员把两类轮胎分开后才用于估计。第三，要弄清编号计数的是哪道工序：V-1 飞弹的估计依据零部件编号，而薄钢板短缺让总装跟不上零件生产，1944 年 6、7 月的序列号估计为 18000 枚，实际可能不超过 6000 枚。反过来说，如果编号不按生产顺序发放，这种推断也就失去了依据。","raw":"This method has clearly defined usage conditions, and Ruggles and Brodie's original text repeatedly includes checks for these conditions. First, the numbering must be continuously assigned from a known starting point; gaps in the chassis number segments force analysts to make additional estimates of the utilization rate of hundred-blocks, a situation Goodman specifically discussed when the starting number is unknown. Second, the sample must be approximately random; in the tire sample, aircraft tires accounted for nearly half, whereas sequence-number-based calculations indicated aircraft tires made up only 15% of production, because the sample was predominantly drawn from German aircraft shot down over Britain, and analysts separated the two types of tires before using them for estimation. Third, it is necessary to determine which production stage the numbering corresponds to: the estimate for V-1 rockets is based on component serial numbers, but shortages of thin steel plates caused final assembly to lag behind component production, leading to an estimated 18,000 units in June and July 1944, while the actual number may have been no more than 6,000. Conversely, if the numbering is not issued in production sequence, such inferences lose their basis.","output":"This method has clearly defined usage conditions, and Ruggles and Brodie's original text repeatedly includes checks for these conditions. First, the numbering must be continuously assigned from a known starting point; gaps in the chassis number segments force analysts to make additional estimates of the utilization rate of hundred-blocks, a situation Goodman specifically discussed when the starting number is unknown. Second, the sample must be approximately random; in the tire sample, aircraft tires accounted for nearly half, whereas sequence-number-based calculations indicated aircraft tires made up only 15% of production, because the sample was predominantly drawn from German aircraft shot down over Britain, and analysts separated the two types of tires before using them for estimation. Third, it is necessary to determine which production stage the numbering corresponds to: the estimate for V-1 rockets is based on component serial numbers, but shortages of thin steel plates caused final assembly to lag behind component production, leading to an estimated 18,000 units in June and July 1944, while the actual number may have been no more than 6,000. Conversely, if the numbering is not issued in production sequence, such inferences lose their basis."},{"id":"889fddd304b476eda62266cfcf930a81cb66f333","source":"13–18 岁才被分组的孩子则看不到收益：多数差异不显著，点估计偏负，例如实验组的个人收入差异为 −967 美元。作者的解释是“扰动效应”：青春期搬到差异很大的环境，可能切断原有的社交网络。收益随搬家年龄增大而下降，符合“童年在更好环境中待得越久越好”的暴露效应模型；但作者也指出，在 MTO 里搬家年龄和暴露时长完全共线，实验本身无法把两者分开。","raw":"Children grouped at ages 13–18 do not observe benefits: most differences are not significant, and point estimates are negatively biased, for example, the individual income difference in the treatment group is −967 dollars. The authors explain this as a 'disturbance effect': moving during adolescence into a very different environment may disrupt existing social networks. Benefits decline with increasing age at move, consistent with the exposure effect model that 'the longer a child spends in a better environment during childhood, the better the outcome'; however, the authors also note that in MTO, age at move and duration of exposure are completely collinear, and the experiment itself cannot separate the two.","output":"Children grouped at ages 13–18 do not observe benefits: most differences are not significant, and point estimates are negatively biased, for example, the individual income difference in the treatment group is −967 US dollars. The authors explain this as a 'disturbance effect': moving during adolescence into a very different environment may disrupt existing social networks. Benefits decline with increasing age at move, consistent with the exposure effect model that 'the longer a child spends in a better environment during childhood, the better the outcome'; however, the authors also note that in MTO, age at move and duration of exposure are completely collinear, and the experiment itself cannot separate the two."}];

test('QA16 covers the six observed typed and quantity forms while the actual tenfold value stays rejected',()=>{
 for(const row of observedQa16)passes(row.source,row.output);
 const bad=observedQa16.find(row=>row.id.startsWith('408'));rejects(bad.source,bad.raw);const currency=observedQa16.find(row=>row.id.startsWith('889'));rejects(currency.source,currency.raw);
 const changed={'0aa':['between 4 and 5 p.m.','between 5 and 4 p.m.'],'2357':['version 3','version 4'],'6cb':['one-unit','two-unit'],'81c':['Seventy-five project schools','Seventy-four project schools'],'af60':['March to September 2008','September to March 2008'],'e916':['June and July 1944','June and August 1944']};
 for(const [prefix,[from,to]] of Object.entries(changed)){const row=observedQa16.find(r=>r.id.startsWith(prefix));rejects(row.source,row.output.replace(from,to));}
 // Deadline anchoring and negative estimates versus estimator bias remain
 // full-article semantic review items, not conclusions of numeric validation.
});

test('QA16 software versions require a matching same-clause software context and exact typed value',()=>{
 const source='这是独立程序，第3版。';passes(source,'This is a standalone program, version 3.');passes(source,'The third edition of this software.');
 for(const output of ['This software is version 4.','This software is version 3.1.','This software is version -3.','This software is version 3-1.','A program was mentioned. Version 3.','Version 3.'])rejects(source,output);
 rejects('这本书第3版。','This software is version 3.');rejects('普通数量3。','This software is version 3.');
 rejects(source,'The software uses the third edition of the book.');rejects('该软件使用这本书第3版。','The software is version 3.');
 passes('该软件使用这本书第3版。','The software uses the third edition of the book.');
 rejects('软件第3版和第3版。','This software is version 3.');
});

test('QA16 finite project-school and unit quantities preserve full lexical numbers',()=>{
 passes('75所学校。','Seventy-five project schools.');passes('75所学校。','Seventy-five schools.');passes('每增加1个单位。','Each one-unit increase.');
 for(const word of ['negative one','minus one','one point one','one hundred and one'])rejects('1单位。','A '+word+'-unit increase.');
 rejects('1单位。','A one-unit-and-a-half increase.');rejects('75所学校。','One hundred and seventy-five project schools.');
 rejects('75所学校。','Negative seventy-five project schools.');rejects('数量1。','One could compare schools.');rejects('数量1。','One-project adjective.');
});

test('QA16 explicit clock ranges share only their stated period and preserve the ordered endpoints',()=>{
 const source='下午 4 点到 5 点。';passes(source,'Between 4 and 5 p.m.');passes(source,'Between 4 p.m. and 5 p.m.');passes('下午4点到下午5点。','4 p.m. to 5 p.m.');
 passes(source,'From 4:00 p.m. to 5:00 p.m.');passes(source,'From 16:00 to 17:00.');
 rejects(source,'From 17:00 to 16:00.');rejects(source,'From 4:01 p.m. to 5:00 p.m.');
 for(const output of ['Between 4 and 6 p.m.','Between 5 and 4 p.m.','Between 4 and 5 a.m.','Between 4 and 5. Later it was p.m.','Between 4 and 25 p.m.','-4 to 5 p.m.','1.4 to 5 p.m.'])rejects(source,output);
 rejects(source+source,'Between 4 and 5 p.m.');
});

test('QA16 explicit month ranges and two-month enumerations bind both years without cross-sentence borrowing',()=>{
 const range='2008年3月至9月。';passes(range,'March to September 2008.');passes(range,'March 2008 to September 2008.');
 for(const output of ['September to March 2008.','March to October 2008.','March to September 2009.','March to September. It was 2008.','March 2008 to September 2009.'])rejects(range,output);
 passes('1944年6、7月。','June and July 1944.');passes('1944年6月、1944年7月。','June 1944 and July 1944.');
 for(const output of ['June and August 1944.','June and July 1945.','June and July. It was 1944.','July 1944.'])rejects('1944年6、7月。',output);
 rejects(range+range,'March to September 2008.');rejects('1944年6、7月。1944年6、7月。','June and July 1944.');
});

test('QA16 quantity hints use only literal Arabic 亿 values with exact decimal scaling',()=>{
 assert.deepEqual(translationQuantityHints('30 亿至 40 亿；10 亿。'),{'30 亿':'3000000000','40 亿':'4000000000','10 亿':'1000000000'});
 assert.deepEqual(translationQuantityHints('0.25亿；-0.5 亿；1,000亿。'),{'0.25亿':'25000000','-0.5 亿':'-50000000','1,000亿':'100000000000'});
 assert.deepEqual(translationQuantityHints('Qwen3-4B、AI2、10B、10万亿、50万、0.000000001亿、Qwen3亿。'),{});
 assert.deepEqual(translationQuantityHints('10亿；10亿。'),{'10亿':'1000000000'});
 assert.deepEqual(translationQuantityHints('30 -40亿；30−40亿。'),{});
 assert.deepEqual(translationQuantityHints('1/2亿；1 / 2亿；1⁄2亿；1/(2亿)。'),{});
 const model=observedQa16.find(row=>row.id.startsWith('408'));assert.deepEqual(translationQuantityHints(model.source),{'30 亿':'3000000000','40 亿':'4000000000','10 亿':'1000000000'});
});
