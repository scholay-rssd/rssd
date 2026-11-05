import {describe,expect,it} from 'vitest';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ACADEMIC,domainType} from '../../scripts/agent/domain-pack.mjs';
import {TASK_TYPES,TASK_TYPE_IDS,DISCOVERY_TASK,OTHER_TASK_MODES} from '../../scripts/agent/task-types.mjs';
import {defaultTemplates,defaultTopicBoard} from '../editorial/topicTemplates';

// The editorial workspace is a private overlay; public checkouts verify the shipped template only.
const desktop=join(__dirname,'../..'),editorial=join(desktop,'../editorial'),workspaces=[join(desktop,'resources/workspace-template'),...(existsSync(editorial)?[editorial]:[])];
describe('academic domain pack',()=>{
 it('fills every content type and the discovery service, and nothing else',()=>{
  expect(Object.keys(ACADEMIC.types).sort()).toEqual([...TASK_TYPE_IDS].sort());
  expect(domainType('rss')).toBe(ACADEMIC.discovery);
  for(const mode of ['image','legacy','constructor','',undefined])expect(domainType(mode)).toBeNull();
 });
 it.each([...TASK_TYPE_IDS,'rss'] as const)('%s has a skill, a subject line and usable topic cards',mode=>{
  const d=domainType(mode)!;
  expect(d.skill).toMatch(/^[a-z][a-z0-9-]+$/);expect(d.subject.trim()).not.toBe('');expect(d.cards.length).toBeGreaterThan(0);
  for(const card of d.cards){expect(card).toHaveLength(3);for(const text of card)expect(text.trim()).not.toBe('');}
  for(const [title,indexes] of d.columns||[]){expect(title.trim()).not.toBe('');for(const i of indexes)expect(d.cards[i]).toBeDefined();}
  if(mode!=='rss'){expect(d.illustrations).toHaveLength(2);expect(d.subject.startsWith(TASK_TYPES[mode].name+'：')).toBe(true);}
  if(d.recordShelf)expect(mode!=='rss'&&TASK_TYPES[mode].structured).toBe(true);
  expect(defaultTemplates(mode).filter(t=>t.kind==='material')).toHaveLength(d.cards.length);expect(defaultTopicBoard(mode)).not.toBeNull();
 });
 it('points only at skills and references that both workspaces ship',()=>{
  const paths=[...[...TASK_TYPE_IDS,'rss'].map(mode=>'.agents/skills/'+domainType(mode)!.skill+'/SKILL.md'),...ACADEMIC.references.board,...ACADEMIC.references.article,...ACADEMIC.imageStyle.files];
  for(const required of ACADEMIC.references.required)expect(ACADEMIC.references.article).toContain(required);
  for(const root of workspaces)for(const path of paths)expect(existsSync(join(root,path)),root+'/'+path).toBe(true);
 });
 it('keeps the type registry free of subject-area wording',()=>{
  const registry=JSON.stringify([TASK_TYPES,DISCOVERY_TASK,OTHER_TASK_MODES]);
  expect(registry).not.toMatch(/学术|科研|论文|期刊|学者|学界|基金|scholay/i);
  for(const id of TASK_TYPE_IDS)for(const key of ['skill','subject','illustrations','recordShelf'])expect(TASK_TYPES[id]).not.toHaveProperty(key);
 });
});
