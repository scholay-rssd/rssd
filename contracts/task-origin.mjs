// Every content task starts from a Center demand, so its space, section and planned format are fixed before
// production. An ad-hoc article is first written down as a real demand. Discovery, image and legacy tasks are
// not content and are exempt. Not enforced by the desktop yet: it still creates local tasks freely.
import protocol from './rssd-v1.cjs';
import {isContentMode,isModeKey,modeName} from './task-modes.mjs';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const validId=value=>typeof value==='string'&&ID.test(value);

/** Problems with where a task came from; an empty list means the task may be produced. */
export function taskOriginProblems(task){
 if(!isModeKey(task?.mode))return ['unknown_mode'];
 if(!isContentMode(task.mode))return [];
 const demand=task.demand,problems=[];
 if(!demand)return ['no_demand'];
 if(!validId(demand.id))problems.push('invalid_demand_id');
 if(!validId(demand.workspaceId))problems.push('invalid_workspace');
 if(!validId(demand.sectionId))problems.push('invalid_section');
 if(!validId(demand.claimToken))problems.push('unclaimed');
 return problems;
}
export function assertTaskOrigin(task){
 const problems=taskOriginProblems(task);
 if(problems.length)throw Error('Task cannot be produced without a claimed demand: '+problems.join(', '));
 return task;
}

/**
 * Turns an ad-hoc article idea into a demand body the Center accepts. Protocol v1 has no field for the task
 * mode, so the planned format is returned beside the validated demand rather than inside it.
 */
export function adHocDemand({workspaceId,sectionId,title,brief='',mode,requiredLocales,priority}){
 if(!isContentMode(mode))throw Error('An ad-hoc demand needs a content mode, not: '+mode);
 const demand=protocol.demand({workspaceId,sectionId,kind:'write',title,brief,requiredLocales,priority});
 return {demand,format:{mode,name:modeName(mode)}};
}
