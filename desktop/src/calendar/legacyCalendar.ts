import {invoke} from '../lib/nativeCore';
import type {HistoryEvent} from './types';
import type {GrowSeed} from './yearGrow';
export type LegacyCalendar={version:number;sha256:string;history:HistoryEvent[];harvested:GrowSeed[];official:GrowSeed[]};
export async function loadLegacyCalendar():Promise<LegacyCalendar|null>{
 const value=await invoke<LegacyCalendar|null>('publications_call',{method:'legacy_calendar'});
 if(value&&(value.version!==1||!Array.isArray(value.history)||!Array.isArray(value.harvested)||!Array.isArray(value.official)))throw Error('本机日历归档格式无效');
 return value||null;
}
