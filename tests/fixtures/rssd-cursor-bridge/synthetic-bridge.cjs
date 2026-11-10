const readline=require('node:readline');
let status='idle',counter=0;
const send=(id,result)=>process.stdout.write(JSON.stringify({id,result})+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params={}}=JSON.parse(line);
 if(method==='task_create'){const out=()=>send(id,{id:'task-'+ ++counter,mode:'image',agentId:'cursor',title:params.title});if(params.title==='RSSD slow')setTimeout(out,200);else out();}
 else if(method==='task_list')send(id,[]);
 else if(method==='gallery_prompt'){status='running';send(id,{runId:'run-1'});}
 else if(method==='cancel'){status='stopped';send(id,{ok:true});}
 else if(method==='status')send(id,status==='running'?{busy:true,pending:[],status:'正在处理'}:{busy:false,pending:[],status:status==='stopped'?'已停止':'已完成'});
 else if(method==='task_get')send(id,{id:params.taskId,mode:'image',agentId:'cursor'});
 else process.stdout.write(JSON.stringify({id,error:'unsupported'})+'\n');
});
