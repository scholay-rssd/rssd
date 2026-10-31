import {deriveSelectOption} from './vendor/aionui/config-options.mjs';
export function agentModelOptions(configuration){
 const option=deriveSelectOption(configuration?.configOptions,'model',['model']);
 if(option)return option;
 const models=configuration?.models;
 return models?.availableModels?.length?{id:'$model',category:'model',currentValue:models.currentModelId,options:models.availableModels.map(m=>({value:m.modelId,label:m.name||m.modelId}))}:null;
}
export function configurationRequest(configuration,id,value){
 const option=configuration.configOptions?.find(o=>o.id===id);
 if(option&&(option.options||[]).flatMap(o=>o.options||[o]).some(o=>o.value===value))return {method:'session/set_config_option',params:{configId:id,value},category:option.category};
 if(id==='$model'&&configuration.models?.availableModels?.some(m=>m.modelId===value))return {method:'session/set_model',params:{modelId:value},category:'model'};
 throw Error('智能体未提供此选项');
}
// Names come from the adapter, not source documents. Normalize only exact MCP
// tool identifiers; the existing task authorization still checks every call.
export function normalizeAgentTool(tool){
 const title=String(tool?.name?.startsWith('mcp__')?tool.name:tool?.title||'');
 const match=title.match(/^mcp__(scholay-workbench|scholay-rss|scholay-today)__([a-z_]+)$/)||title.match(/^mcp\.(scholay-workbench|scholay-rss|scholay-today)\.([a-z_]+)$/);
 return match?{...tool,title:match[1]+'-'+match[2]+': '+match[2]}:tool;
}
