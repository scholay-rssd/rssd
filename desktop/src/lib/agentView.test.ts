import {it,expect} from 'vitest';
import {lineDiff,modelDetail} from '../editorial/agent-view';
it('renders only real changes with stable old and new line numbers',()=>{const rows=lineDiff('A\nB\nC','A\nX\nC');expect(rows).toEqual([{kind:'same',text:'A',oldLine:1,newLine:1},{kind:'remove',text:'B',oldLine:2},{kind:'add',text:'X',newLine:2},{kind:'same',text:'C',oldLine:3,newLine:3}]);});
it('bounds diff work for long articles',()=>{const a=Array.from({length:1000},(_,i)=>'old'+i).join('\n'),b=a.replaceAll('old','new');expect(lineDiff(a,b).length).toBe(2000);});
it('preserves provider variant properties for model selection',()=>expect(modelDetail('grok[context=256k,reasoning_effort=high,fast=true]')).toBe('context=256k · high · Fast'));
