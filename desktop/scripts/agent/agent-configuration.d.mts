export type AgentConfiguration={configOptions?:{id:string;name?:string;category?:string;type?:string;currentValue?:string;options?:any[]}[];models?:{currentModelId:string;availableModels:{modelId:string;name?:string}[]}|null};
export function agentModelOptions(configuration?:AgentConfiguration):{id:string;category:string;currentValue:string|null;options:{value:string;label:string;description?:string}[]}|null;
export function configurationRequest(configuration:AgentConfiguration,id:string,value:string):{method:string;params:object;category?:string};
export function normalizeAgentTool(tool:any):any;
