import {describe,it,expect,vi} from 'vitest';
import {recordDate,recordMaterial,recordEnrichmentTemplate,recordOnDay,recordSources,recordsForMonth,historyRecords,loadAcademicRecords} from './academicRecords';
import {templatePrompt} from '../editorial/topicTemplates';
import {sourceUsable} from '../editorial/topicSources';
import type {CalendarEvent} from './types';
const {readOfficial,readRss}=vi.hoisted(()=>({readOfficial:vi.fn(),readRss:vi.fn()}));
vi.mock('../api',()=>({listCalendarEvents:readOfficial}));
vi.mock('./yearGrow',async importOriginal=>({...await importOriginal<any>(),loadGrowSeeds:readRss}));
const fixture=(patch:Partial<CalendarEvent>={}):CalendarEvent=>({id:'history:1949:03-21:机构成立',title:'机构成立',tags:['科学机构史'],source:'history',kind:'point',precision:'day',approximate:false,start:{year:1949,month:3,day:21},payload:{factSummary:'档案记载事实',sources:[{label:'原始档案',url:'https://archive.example.org/founding'}]},...patch});
describe('academic maintenance evidence',()=>{
 it('fills manual material with original identity and exact historical date, keeping existing records unchanged',()=>{
  const record=fixture(),copy=structuredClone(record),item=recordMaterial(record,'slot-1');
  expect(item).toMatchObject({id:'slot-1',acquiredVia:'record',recordId:record.id,recordKind:'history',datePrecision:'day',date:'1949-03-21',url:'https://archive.example.org/founding',publisher:'原始档案',locked:true,selected:true});
  expect(item.summary).toContain('科学机构史');expect(record).toEqual(copy);
  expect(sourceUsable({kind:'record',event:record},[item.url])).toBe(false);
 });
 it('preserves month-only evidence and never invents the first of a month',()=>{
  const record=fixture({precision:'month',approximate:true,start:{year:1949,month:3,day:null}}),material=recordMaterial(record,'month-slot');
  expect(recordDate(record)).toBe('1949-03');expect(material.datePrecision).toBe('month');expect(material.dateBasis).toContain('不以月首补造日期');
  expect(recordOnDay(record,2026,3,1)).toBe(false);
 });
 it('searches by category and anniversary rather than the current publication year and includes multi-month windows',()=>{
  const history=fixture(),window=fixture({id:'grant',source:'year',start:{year:2026,month:2,day:20},end:{year:2026,month:4,day:10}});
  expect(recordsForMonth([history],3,'档案','科学机构史','03-21',2026)).toEqual([history]);
  expect(recordsForMonth([window],3,'','',null,2026)).toEqual([window]);expect(recordOnDay(window,2026,3,21)).toBe(true);
  expect(recordsForMonth([window],3,'','',null,2027)).toEqual([]);
 });
 it('creates a targeted smart slot request carrying recorded facts, dates, classifications, URLs and exact gaps',()=>{
  const record=fixture({precision:'month',approximate:true,start:{year:1949,month:3,day:null}}),template=recordEnrichmentTemplate(record),prompt=templatePrompt(template);
  for(const value of [record.id,'1949-03','科学机构史','https://archive.example.org/founding','确切月日','原记录只读','最新 task revision'])expect(prompt).toContain(value);
  expect(prompt).not.toContain('最近 7 天');expect(prompt.length).toBeLessThanOrEqual(1000);
 });
 it('retains multiple sources and rejects unsafe/missing evidence for a manual selection',()=>{
  const record=fixture({payload:{sources:[{label:'javascript',url:'javascript:run()'},{label:'档案',url:'https://archive.example.org/1'},{label:'出版社',url:'https://publisher.example.org/2'}]}});
  expect(recordSources(record)).toHaveLength(2);expect(recordMaterial(record,'s').summary).toContain('https://publisher.example.org/2');
  expect(sourceUsable({kind:'record',event:record},['https://publisher.example.org/2'])).toBe(false);
  expect(()=>recordMaterial(fixture({payload:{}}),'s')).toThrow('没有原文链接');
 });
 it('reads history locally and falls back honestly when local calendar evidence fails',async()=>{
  readOfficial.mockRejectedValue(Error('local unavailable'));readRss.mockResolvedValue([]);
  expect((await loadAcademicRecords('history',2026)).events).toEqual(historyRecords);
  const calendar=await loadAcademicRecords('calendar',2026);expect(calendar.events.length).toBeGreaterThan(0);expect(calendar.notice).toContain('未完整读取');
 });
 it('keeps enrichment requests for all bundled history records within the saved-slot limit',()=>{
  for(const record of historyRecords)expect(templatePrompt(recordEnrichmentTemplate(record)).length).toBeLessThanOrEqual(1000);
 });
});
