import test from 'node:test';
import assert from 'node:assert/strict';
import {ANNOTATION_FORM,ANNOTATION_FAMILIES,annotationSectionsFor,annotationItemsFor,validateAnnotationAnswers,validateAnnotationForm,MAX_ANNOTATION_NOTE} from '../contracts/annotation-forms.mjs';

const answer=item=>({value:item.type==='scale'?4:item.type==='check'?true:item.options[0].id});
const sheet=items=>Object.fromEntries(items.map(item=>[item.id,answer(item)]));

test('the form is valid, and every writing family has its own questions',()=>{
 assert.equal(ANNOTATION_FORM.schemaVersion,1);assert.match(ANNOTATION_FORM.version,/^draft-\d+$/);
 const named=new Set(ANNOTATION_FORM.sections.flatMap(section=>section.appliesTo.families||[]));
 assert.deepEqual([...named].sort(),ANNOTATION_FAMILIES);
 assert.throws(()=>{ANNOTATION_FORM.sections.push({});},TypeError,'the form is frozen');
});
test('a work gets the sections that apply to it, in order',()=>{
 const ids=work=>annotationSectionsFor(ANNOTATION_FORM,work).map(section=>section.id);
 assert.deepEqual(ids({workType:'article',family:'animal'}),['article-facts','article-answer','article-prose','article-images','article-overall','family-animal']);
 assert.deepEqual(ids({workType:'article',family:'legal',cards:true}),['article-facts','article-answer','article-prose','article-images','article-overall','article-cards','family-legal']);
 assert.deepEqual(ids({workType:'article'}),['article-facts','article-answer','article-prose','article-images','article-overall']);
 assert.deepEqual(ids({workType:'note',family:'animal',cards:true}),['note-common']);
 assert.deepEqual(ids({workType:'note',adapted:true}),['note-common','note-adapted']);
 assert.throws(()=>annotationSectionsFor(ANNOTATION_FORM,{workType:'event'}),{code:'invalid_annotation'});
 // Short enough to finish: an article with cards and family questions stays under 25 items.
 for(const family of ANNOTATION_FAMILIES)assert.ok(annotationItemsFor(ANNOTATION_FORM,{workType:'article',family,cards:true}).length<=25,family);
});
test('an answer sheet must answer every item that applies, and nothing else',()=>{
 const work={workType:'article',family:'animal'},items=annotationItemsFor(ANNOTATION_FORM,work),full=sheet(items);
 assert.deepEqual(validateAnnotationAnswers(ANNOTATION_FORM,work,full),full);
 const optional=items.find(item=>item.optional),{[optional.id]:_skipped,...withoutOptional}=full;
 assert.equal(optional.id in validateAnnotationAnswers(ANNOTATION_FORM,work,withoutOptional),false);
 const required=items.find(item=>!item.optional),{[required.id]:_missing,...incomplete}=full;
 assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,incomplete),/Missing answer/);
 assert.throws(()=>validateAnnotationAnswers(ANNOTATION_FORM,work,{...full,'legal-jurisdiction':{value:true}}),/no item legal-jurisdiction/);
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
  d=>{d.sections[0].items.push({id:'q',type:'check',text:'again'});},d=>{d.sections[0].items.push({id:'c',type:'choice',text:'C',options:[{id:'only',label:'one'}]});},d=>{d.sections[0].items[0].weight=2;}];
 for(const mutate of broken){const document=base();mutate(document);assert.throws(()=>validateAnnotationForm(document,{families:['animal']}),{code:'invalid_annotation'},mutate.toString());}
});
