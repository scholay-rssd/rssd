import type {TaskTypeId} from './task-types.mjs';
export type DestinationRecord={kind:string;fields:string;placement:string;verify?:(fields:Record<string,unknown>)=>void};
export type DestinationUse={column:string;record?:DestinationRecord};
export type DestinationProfile={id:string;name:string;uses:Record<TaskTypeId,DestinationUse>};
export const SCHOLAY_TODAY:DestinationProfile;
export function destinationUse(mode:string,profile?:DestinationProfile):DestinationUse|null;
export function destinationRecord(mode:string,profile?:DestinationProfile):DestinationRecord|null;
export function draftPlacement(mode:string,fields:unknown,profile?:DestinationProfile):{column:string;archiveCategory:string;type:string;record?:{kind:string;fields:unknown}};
export function useOptions(mode:string,profile?:DestinationProfile):string[];
export function typeOfColumn(column:string,profile?:DestinationProfile):TaskTypeId|null;

export const CURRENT_DESTINATION:DestinationProfile;
