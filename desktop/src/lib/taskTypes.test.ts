import {describe,expect,it} from 'vitest';
import {TASK_TYPES,TASK_TYPE_IDS,TASK_MODE_NAMES,DISCOVERY_TASK,taskType,isArticleType,defaultDays,defaultSections} from '../../scripts/agent/task-types.mjs';
import {defaultTemplates} from '../editorial/topicTemplates';

describe('task type registry',()=>{
 it.each(TASK_TYPE_IDS)('%s is completely defined',id=>{
  const t=TASK_TYPES[id];
  for(const key of ['name','description','icon'] as const)expect(t[key].trim(),key).not.toBe('');
  expect(t.days).toBeGreaterThan(0);expect(t.sections).toBeGreaterThan(0);expect(['recent','event','none']).toContain(t.dateRule);
  if(t.structured){expect(t.recordLabels?.length).toBeGreaterThan(0);expect(t.rules?.trim()).toBeTruthy();}
  expect(defaultTemplates(id).length).toBeGreaterThan(0);
 });
 it('keeps the stored mode ids and gives every mode a unique name',()=>{
  expect(TASK_TYPE_IDS).toEqual(['xiwen','observation','opensource','calendar','history']);
  const names=Object.values(TASK_MODE_NAMES);expect(new Set(names).size).toBe(names.length);
  expect(Object.keys(TASK_MODE_NAMES)).toEqual([...TASK_TYPE_IDS,'rss','image','legacy']);
 });
 it('treats unknown, image and legacy modes as non-content',()=>{
  for(const mode of ['image','legacy','constructor','',undefined]){expect(taskType(mode)).toBeNull();expect(isArticleType(mode)).toBe(false);expect(defaultDays(mode)).toBe(30);expect(defaultSections(mode)).toBe(1);}
  expect(isArticleType('rss')).toBe(false);expect(taskType('rss')).toBe(DISCOVERY_TASK);expect(TASK_TYPES).not.toHaveProperty('rss');expect(TASK_TYPE_IDS.every(id=>TASK_TYPES[id].article)).toBe(true);expect(defaultDays('xiwen')).toBe(7);expect(defaultSections('xiwen')).toBe(3);
 });
});
