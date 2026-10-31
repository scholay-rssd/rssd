#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {applySiteEnv} from './env.mjs';
import {AgentRegistry,agentEnvironment} from '../agent-registry.mjs';
import {probeAgent} from '../agent-probe.mjs';
const [site,action='list',id]=process.argv.slice(2);
try{
 if(!site||!['list','check','default','login'].includes(action))throw Error('Usage: agents <siteId> [list|check|default|login] [agentId]');
 const {root}=applySiteEnv(site),{TaskStore}=await import('../task-store.mjs'),store=new TaskStore(root),registry=new AgentRegistry();
 if(action==='list')console.log(JSON.stringify({agents:await registry.list(),defaultAgentId:(await store.settings()).defaultAgentId||'cursor'},null,2));
 else if(!id)throw Error('请指定智能体 ID');
 else if(action==='check')console.log(JSON.stringify(await probeAgent(registry,id),null,2));
 else if(action==='default'){await registry.launch(id);await store.settings({defaultAgentId:id});console.log('当前空间默认智能体：'+id);}
 else {const agent=await registry.get(id);if(!agent.loginArgs)console.log('请运行：'+(agent.loginCommand||agent.command));else{const launch=await registry.launch(id,{login:true});const child=spawn(launch.command,launch.args,{env:agentEnvironment(launch.env),stdio:'inherit'});child.on('error',()=>{console.error('登录进程无法启动');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code||0;});}}
}catch(e){console.error(e.message);process.exitCode=1;}
