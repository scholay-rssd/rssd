import {describe,it,expect} from 'vitest';
import {mergeQueueJobs,queueState,queueCounts} from './backgroundQueue';
describe('background queue',()=>{
 it('keeps identical IDs from different spaces and newer receipts without counting twice',()=>{
  const jobs=mergeQueueJobs([{id:'same',spaceId:'metho',title:'Old',status:'queued',updatedAt:'2026-10-22'},{id:'same',spaceId:'today',title:'Other',status:'running'}],[{id:'same',spaceId:'metho',title:'New',status:'complete',updatedAt:'2026-10-23'}]);
  expect(jobs).toHaveLength(2);expect(jobs[0].spaceId).toBe('today');expect(jobs[1].title).toBe('New');
  expect(queueCounts(jobs)).toEqual({queued:0,running:1,attention:0,complete:1});
 });
 it('accepted or waiting work is never displayed as completed',()=>{
  for(const status of ['queued','waiting','accepted','submitted'])expect(queueState({id:'x',title:'x',status})).toBe('queued');
  expect(queueState({id:'x',title:'x',status:'needs_review'})).toBe('attention');
 });
});
