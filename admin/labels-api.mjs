import {labelsFeed} from './labels-store.mjs';

// The HTTP server knows no provider key and cannot schedule a paid request.
export function registerLabelsApi(app,{labelsDb,bearer,session,limit}){
  app.get('/manage/api/labels',async request=>{
    if(request.headers.authorization)bearer(request,['editorial_draft','news_publish','editorial_publish']);else session(request);
    limit('labels-read:'+request.actor,90,60000);
    if(!labelsDb)throw Object.assign(Error('云端标签缓存暂不可用'),{statusCode:503});
    return labelsFeed(labelsDb);
  });
}
