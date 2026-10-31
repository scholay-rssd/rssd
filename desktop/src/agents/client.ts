import {taskCall} from '../editorial/taskWorkbench';
export type Agent={id:string;name:string;command:string;args?:string[];enabled:boolean;available:boolean;detail?:string;custom?:boolean;docs?:string;authNote?:string;adapter?:string;loginCommand?:string};
export type AgentList={agents:Agent[];defaultAgentId:string};
export type AgentAuth={type:string;agentId:string;status:string;url?:string;code?:string};
export type LoginResult={started?:boolean;manual?:boolean;command?:string;docs?:string;note?:string};
export const agentCall=taskCall;
export function openAgentSettings(){window.dispatchEvent(new CustomEvent('papr-open-settings',{detail:{section:'agents'}}));}
