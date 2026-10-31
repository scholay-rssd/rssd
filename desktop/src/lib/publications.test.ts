import {describe,it,expect} from "vitest";
import {groupRecords,recordMatches,matchesStatus,feishuLink,type Publication} from "../publications/model";
const record=(patch:Partial<Publication>):Publication=>({id:"one",sourceId:"source",taskId:"task",title:"标题",platform:"平台甲",status:"已发布",url:"https://example.org",...patch});
describe("publication center identities and combined filtering",()=>{
  it("combines variants by canonical ID and never conflates identical titles",()=>{
    const groups=groupRecords([record({}),record({id:"two",title:"不同平台改写后的标题"}),record({id:"three",sourceId:"other"}),record({id:"four",sourceId:""}),record({id:"five",sourceId:""})]);
    expect(groups).toHaveLength(4);expect(groups.find(x=>x.sourceId==="source")?.records).toHaveLength(2);
  });
  it("requires platform and status on the same record",()=>{
    const records=[record({}),record({id:"two",platform:"平台乙",status:"失败",url:""})];
    expect(groupRecords(records.filter(r=>recordMatches(r,"","平台乙","published")))).toHaveLength(0);
    expect(groupRecords(records.filter(r=>recordMatches(r,"标题","平台乙","action")))).toHaveLength(1);
    expect(matchesStatus(record({status:"未发布"}),"published")).toBe(false);
    expect(matchesStatus(record({status:"需人工处理"}),"action")).toBe(true);
    expect(matchesStatus(record({url:""}),"link")).toBe(true);
  });
  it("uses only a returned HTTPS Feishu URL for record deep links",()=>{
    expect(feishuLink({configured:true,records:[],updatedAt:null,baseUrl:"javascript:alert(1)"},"rec")).toBe("");
    expect(feishuLink({configured:true,records:[],updatedAt:null,baseUrl:"https://example.feishu.cn/base/example",tableId:"table"},"rec")).toBe("https://example.feishu.cn/base/example?table=table&record=rec");
  });
});
