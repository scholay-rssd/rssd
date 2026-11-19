import test from 'node:test';
import assert from 'node:assert/strict';
import {ANNOTATION_FORM,annotationSectionsFor,annotationItemsFor,annotationProfile,validateAnnotationAnswers,validateAnnotationForm,MAX_ANNOTATION_NOTE} from '../contracts/annotation-forms.mjs';

const answer=item=>({value:item.type==='scale'?4:item.type==='check'?true:item.options[0].id});
const sheet=items=>Object.fromEntries(items.map(item=>[item.id,answer(item)]));

test('the form is valid: one set of dimensions for every article and note, each with a scale and its signs',()=>{
 assert.equal(ANNOTATION_FORM.schemaVersion,1);assert.match(ANNOTATION_FORM.version,/^(draft-)?\d+$/);
 const dimensions=ANNOTATION_FORM.sections.filter(section=>section.id!=='overall');
 assert.deepEqual(dimensions.map(section=>section.id),['staging','rhythm','inflation','structure','residue','substance','stance','voice']);
 for(const section of ANNOTATION_FORM.sections){
  assert.deepEqual(section.appliesTo,{workTypes:['article','note']},section.id+' applies to every work');
  assert.ok(section.traces,section.id+' says where its results point');
 }
 for(const section of dimensions){
  assert.equal(section.items.filter(item=>item.type==='scale').length,1,section.id+' has one scale');
  const checks=section.items.filter(item=>item.type==='check');
  assert.ok(checks.length>=2&&checks.every(item=>['tell','good'].includes(item.polarity)),section.id+' has signs, each saying which answer is the bad one');
 }
 // The question about the weakest dimension offers exactly the dimensions, and none.
 const worst=ANNOTATION_FORM.sections.at(-1).items.find(item=>item.id==='overall-worst').options.map(option=>option.id);
 assert.deepEqual(worst,[...dimensions.map(section=>section.id),'none']);
 assert.throws(()=>{ANNOTATION_FORM.sections.push({});},TypeError,'the form is frozen');
});
test('every work gets the same sections, in order, whatever its type, family or card page',()=>{
 const ids=work=>annotationSectionsFor(ANNOTATION_FORM,work).map(section=>section.id),all=ANNOTATION_FORM.sections.map(section=>section.id);
 for(const work of [{workType:'article'},{workType:'article',family:'animal',cards:true},{workType:'note'},{workType:'note',adapted:true}])assert.deepEqual(ids(work),all);
 assert.throws(()=>annotationSectionsFor(ANNOTATION_FORM,{workType:'event'}),{code:'invalid_annotation'});
 assert.ok(annotationItemsFor(ANNOTATION_FORM,{workType:'article'}).length<=40);
});
test('a profile gives each dimension its scale and how many of its signs point to machine writing',()=>{
 const work={workType:'note'},items=annotationItemsFor(ANNOTATION_FORM,work);
 const human=Object.fromEntries(items.map(item=>[item.id,{value:item.type==='scale'?5:item.type==='check'?item.polarity==='good':item.options.at(-1).id}]));
 const machine=Object.fromEntries(items.map(item=>[item.id,{value:item.type==='scale'?1:item.type==='check'?item.polarity!=='good':item.options[0].id}]));
 const best=annotationProfile(ANNOTATION_FORM,work,human),worst=annotationProfile(ANNOTATION_FORM,work,machine);
 for(const section of ANNOTATION_FORM.sections){
  assert.equal(best[section.id].scale,5);assert.equal(best[section.id].tells,0);
  assert.equal(worst[section.id].scale,1);assert.equal(worst[section.id].tells,worst[section.id].checks);
 }
 assert.deepEqual(annotationProfile(ANNOTATION_FORM,work,{'staging-direct':{value:4},'staging-runup':{value:true}}),{staging:{scale:4,tells:1,checks:1}});
 assert.deepEqual(annotationProfile(ANNOTATION_FORM,work,{}),{});
});
test('an answer sheet must answer every item that applies, and nothing else',()=>{
 const work={workType:'article',family:'animal'},items=annotationItemsFor(ANNOTATION_FORM,work),full=sheet(items);
 assert.deepEqual(validateAnnotationAnswers(ANNOTATION_FORM,work,full),full);
 const required=items.find(item=>!item.optional),{[required.id]:_missing,...incomplete}=full;
 assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,incomplete),/Missing answer/);
 assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,{...full,'no-such-item':{value:true}}),/no item no-such-item/);
 assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,[]),{code:'invalid_annotation'});
});
test('each kind of item takes only its own kind of answer, and a note only where allowed',()=>{
 const work={workType:'article',family:'animal'},items=annotationItemsFor(ANNOTATION_FORM,work),full=sheet(items);
 const of=type=>items.find(item=>item.type===type),bad=(item,value)=>assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,{...full,[item.id]:value}),{code:'invalid_annotation'},item.id+' '+JSON.stringify(value));
 for(const value of [0,6,3.5,'3',true])bad(of('scale'),{value});
 for(const value of [1,'yes',null])bad(of('check'),value===null?{value:'x'}:{value});
 for(const value of ['no-such-option',1,true])bad(of('choice'),{value});
 bad(of('scale'),{value:3,extra:1});bad(of('scale'),3);
 const noted=items.find(item=>item.note),plain=items.find(item=>!item.note);
 assert.equal(validateAnnotationAnswers(ANNOTATION_FORM,work,{...full,[noted.id]:{...answer(noted),note:'第三段的年份查不到出处'}})[noted.id].note,'第三段的年份查不到出处');
 assert.equal('note' in validateAnnotationAnswers(ANNOTATION_FORM,work,{...full,[noted.id]:{...answer(noted),note:''}})[noted.id],false);
 bad(plain,{...answer(plain),note:'不该有备注'});bad(noted,{...answer(noted),note:'x'.repeat(MAX_ANNOTATION_NOTE+1)});
});
test('a malformed form is refused',()=>{
 const base=()=>structuredClone({schemaVersion:1,version:'t-1',sections:[{id:'s',title:'T',appliesTo:{workTypes:['article']},items:[{id:'q',type:'scale',text:'Q',anchors:{1:'a',3:'b',5:'c'}}]}]});
 assert.equal(validateAnnotationForm(base()).sections.length,1);
 const broken=[d=>{d.schemaVersion=2;},d=>{d.sections=[];},d=>{d.sections.push(d.sections[0]);},d=>{d.sections[0].appliesTo.workTypes=['video'];},d=>{d.sections[0].appliesTo.families=['nope'];},
  d=>{d.sections[0].appliesTo.cards=false;},d=>{d.sections[0].items[0].anchors={1:'a',5:'c'};},d=>{d.sections[0].items[0].type='essay';},d=>{d.sections[0].items[0].options=[];},
  d=>{d.sections[0].items.push({id:'q',type:'check',text:'again'});},d=>{d.sections[0].items.push({id:'c',type:'choice',text:'C',options:[{id:'only',label:'one'}]});},d=>{d.sections[0].items[0].polarity='tell';},d=>{d.sections[0].items.push({id:'k',type:'check',text:'K',polarity:'bad'});},d=>{d.sections[0].traces='';},d=>{d.sections[0].items[0].weight=2;}];
 for(const mutate of broken){const document=base();mutate(document);assert.throws(()=>validateAnnotationForm(document,{families:['animal']}),{code:'invalid_annotation'},mutate.toString());}
});
