import test from 'node:test';
import assert from 'node:assert/strict';
import {ANNOTATION_FORM,annotationSectionsFor,annotationItemsFor,annotationProfile,validateAnnotationAnswers,validateAnnotationForm,MAX_ANNOTATION_NOTE} from '../contracts/annotation-forms.mjs';

const answer=item=>({value:item.type==='scale'?4:item.type==='check'?true:item.options[0].id});
const sheet=items=>Object.fromEntries(items.map(item=>[item.id,answer(item)]));

test('the form is the published slop taxonomy: an initial judgement, then three themes with eleven yes or no codes',()=>{
 assert.equal(ANNOTATION_FORM.schemaVersion,1);assert.equal(ANNOTATION_FORM.version,'2');
 assert.deepEqual(ANNOTATION_FORM.sections.map(section=>section.id),['overall','information-utility','information-quality','style-quality']);
 for(const section of ANNOTATION_FORM.sections){
  assert.deepEqual(section.appliesTo,{workTypes:['article','note']},section.id+' applies to every work');
  assert.ok(section.traces,section.id+' says where its results point');
 }
 const codes=ANNOTATION_FORM.sections.slice(1).flatMap(section=>section.items);
 assert.deepEqual(codes.map(item=>item.id),['iu1-density','iu2-relevance','iq1-factuality','iq2-bias','sq1-repetition','sq2-templatedness','sq3-coherence','sq4-naturalness','sq5-verbosity','sq6-word-complexity','sq7-tone']);
 // Objective items: every code is a yes or no whose yes is the bad sign, with room to paste the passage.
 for(const item of codes){assert.equal(item.type,'check');assert.equal(item.polarity,'tell');assert.equal(item.note,true);}
 const all=ANNOTATION_FORM.sections.flatMap(section=>section.items);
 assert.equal(all.filter(item=>item.type==='check').length,12);assert.equal(all.filter(item=>item.type==='scale').length,1);assert.equal(all.filter(item=>item.type==='choice').length,0);
 // Where the form comes from is stated in the form itself.
 assert.ok(ANNOTATION_FORM.sources.some(source=>source.url.includes('2509.19163')));
 assert.throws(()=>{ANNOTATION_FORM.sections.push({});},TypeError,'the form is frozen');
});
test('every work gets the same sections, in order, whatever its type, family or card page',()=>{
 const ids=work=>annotationSectionsFor(ANNOTATION_FORM,work).map(section=>section.id),all=ANNOTATION_FORM.sections.map(section=>section.id);
 for(const work of [{workType:'article'},{workType:'article',family:'animal',cards:true},{workType:'note'},{workType:'note',adapted:true}])assert.deepEqual(ids(work),all);
 assert.throws(()=>annotationSectionsFor(ANNOTATION_FORM,{workType:'event'}),{code:'invalid_annotation'});
 assert.equal(annotationItemsFor(ANNOTATION_FORM,{workType:'article'}).length,13);
});
test('a profile counts, per theme, how many of its codes were found',()=>{
 const work={workType:'note'},items=annotationItemsFor(ANNOTATION_FORM,work);
 const clean=Object.fromEntries(items.map(item=>[item.id,{value:item.type==='scale'?5:false}])),sloppy=Object.fromEntries(items.map(item=>[item.id,{value:item.type==='scale'?5:true}]));
 const best=annotationProfile(ANNOTATION_FORM,work,clean),worst=annotationProfile(ANNOTATION_FORM,work,sloppy);
 assert.deepEqual([best['information-utility'],best['information-quality'],best['style-quality']],[{tells:0,checks:2},{tells:0,checks:2},{tells:0,checks:7}]);
 assert.deepEqual([worst['information-utility'].tells,worst['information-quality'].tells,worst['style-quality'].tells],[2,2,7]);
 assert.deepEqual(worst.overall,{scale:5,tells:1,checks:1});
 assert.deepEqual(annotationProfile(ANNOTATION_FORM,work,{'sq1-repetition':{value:true},'sq7-tone':{value:false}}),{'style-quality':{tells:1,checks:2}});
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
 // A small form with one item of each kind, so this does not depend on which kinds the current form uses.
 const form=validateAnnotationForm({schemaVersion:1,version:'t-1',sections:[{id:'s',title:'T',appliesTo:{workTypes:['article']},items:[
  {id:'scale-item',type:'scale',text:'S',anchors:{1:'a',3:'b',5:'c'}},{id:'check-item',type:'check',text:'K',polarity:'tell',note:true},
  {id:'choice-item',type:'choice',text:'C',options:[{id:'one',label:'One'},{id:'two',label:'Two'}]}]}]});
 const work={workType:'article'},full={'scale-item':{value:4},'check-item':{value:false},'choice-item':{value:'two'}};
 assert.deepEqual(validateAnnotationAnswers(form,work,full),full);
 const bad=(id,value)=>assert.throws(()=>validateAnnotationAnswers(form,work,{...full,[id]:value}),{code:'invalid_annotation'},id+' '+JSON.stringify(value));
 for(const value of [0,6,3.5,'3',true])bad('scale-item',{value});
 for(const value of [1,'yes','x'])bad('check-item',{value});
 for(const value of ['no-such-option',1,true])bad('choice-item',{value});
 bad('scale-item',{value:3,extra:1});bad('scale-item',3);
 assert.equal(validateAnnotationAnswers(form,work,{...full,'check-item':{value:true,note:'第三段的年份查不到出处'}})['check-item'].note,'第三段的年份查不到出处');
 assert.equal('note' in validateAnnotationAnswers(form,work,{...full,'check-item':{value:true,note:''}})['check-item'],false);
 bad('scale-item',{value:4,note:'不该有备注'});bad('check-item',{value:true,note:'x'.repeat(MAX_ANNOTATION_NOTE+1)});
});
test('a malformed form is refused',()=>{
 const base=()=>structuredClone({schemaVersion:1,version:'t-1',sections:[{id:'s',title:'T',appliesTo:{workTypes:['article']},items:[{id:'q',type:'scale',text:'Q',anchors:{1:'a',3:'b',5:'c'}}]}]});
 assert.equal(validateAnnotationForm(base()).sections.length,1);
 const broken=[d=>{d.schemaVersion=2;},d=>{d.sections=[];},d=>{d.sections.push(d.sections[0]);},d=>{d.sections[0].appliesTo.workTypes=['video'];},d=>{d.sections[0].appliesTo.families=['nope'];},
  d=>{d.sections[0].appliesTo.cards=false;},d=>{d.sections[0].items[0].anchors={1:'a',5:'c'};},d=>{d.sections[0].items[0].type='essay';},d=>{d.sections[0].items[0].options=[];},
  d=>{d.sections[0].items.push({id:'q',type:'check',text:'again'});},d=>{d.sections[0].items.push({id:'c',type:'choice',text:'C',options:[{id:'only',label:'one'}]});},d=>{d.sections[0].items[0].polarity='tell';},d=>{d.sections[0].items.push({id:'k',type:'check',text:'K',polarity:'bad'});},d=>{d.sections[0].traces='';},d=>{d.sections[0].items[0].weight=2;}];
 for(const mutate of broken){const document=base();mutate(document);assert.throws(()=>validateAnnotationForm(document,{families:['animal']}),{code:'invalid_annotation'},mutate.toString());}
});
