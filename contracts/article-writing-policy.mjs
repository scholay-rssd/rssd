// Shared by the desktop and headless writer. This is a generation contract,
// not a post-generation prose filter or a publication permission.
export const ARTICLE_WRITING_POLICY='private-notes-first-pass-v2';
export const ARTICLE_WRITING_PRIORITY='用户当前明确说明优先。项目写作协议决定正文与作者备注的分工；旧 brief、技能快照、模板和智能体长期配置中与本协议冲突的写作要求不再叠加执行，其余领域、作者保护与任务范围要求保留。历史快照用于追溯，不因规则更新自动改稿或新增审批。';
export const ARTICLE_WRITING_INSTRUCTIONS=`写作协议：${ARTICLE_WRITING_POLICY}。
${ARTICLE_WRITING_PRIORITY}
按平时的选题、取材和行文过程写作，落笔时就区分读者正文与作者备注。默认一次成文，不安排写完后二次校对、全文润色或自动清洗来分离备注；只有作者明确要求改稿，或发现具体事实/格式错误时，才在授权范围内局部处理。事实核对贯穿取材和写作，不能省略来源证据。
事实核查是作者的义务，不是读者的义务。作者先完成必要核查，再据证据写正文；不能用“未实测”“请自行核实”“以官网为准”等套话代替核查或把未完成的工作交给读者。尚未解决的核验、来源登记失败和缺失内容进入私有 verification 待办，由作者继续处理；备注可以保留待办，成稿标记、保存和发布沿用既有流程，不因此新增审核或禁止成稿。
正文围绕本篇问题，写核心判断、方法、步骤和例子，简明界定讨论对象。附带的概念解释、适用边界展开、例外与防误读提醒，直接进入对应行的 supplement；短句、半句也按此分界。若概念辨析或限制本身就是文章要回答的问题，核心答案仍在正文。必要事实、证据边界、是否冒充实测等标准只用于作者内部核验，核验记录进入 verification；不把这些标准写成公开正文声明，也不强制另设“证据边界”“未实测”或免责声明段落。内部核验仍须保证内容真实，不编造事实、经历或结果。真实来源和版权署名正常保留。
沿用 notebook version=2 的 JSON 结构，不再另造正文格式：blocks[].text 只放公开内容；blockNotes[blockId].notes 放对应行的内部说明；internalNotes 只放没有对应行的整篇说明。五类字段为 supplement（补充说明）、writing（写作取舍）、images（配图用途及关系）、verification（查阅范围与待办）、other（其他内部备注）。空字段可以省略，不为填字段制造套话，不能在段尾、括号、图注、摘要或注意事项附录重复这些旁支。模型身份由运行服务写入 modelSignatures，AI 不得自填、猜测或改写。
资料阅读范围、未执行的报名/安装/测试及核验过程写入 verification，例如“未实际报名”“没有运行课程”“未测试账号扣费”。新版说明取代旧任务要求或技能中的“写明未实测”：不得在公开正文、摘要或 fields.status 重复制作说明；status 是公开字段，不是备注。“不冒充实测”是作者应遵守的内部真实性要求，不是正文需要发表的声明，不再以“对读者判断必要”为由补回核验声明。图片生成取舍与正文关系进入 images；图表本身的图例、示意身份、非比例说明、真实来源与许可正常保留在公开图注。
优先在同一次 task_update 中提交本轮正文与其 blockNotes。下面是 task_update 参数的局部示例，不是整篇模板；expectedRevision 与行 ID 必须取自 task_read，传 blocks 时必须保留完整数组及原字段，已有备注须保留并追加，未委派的行保持原样：
{"expectedRevision":12,"notebook":{"blocks":[{"id":"body","type":"paragraph","state":"ready","text":"参与者相互独立，每人的前后测成对重抽。","sourceIds":[]}],"blockNotes":{"body":{"notes":{"supplement":"时间序列和聚类数据需要另选符合其依赖结构的重抽方案。"}}}}}
逐行补写时也可用 notebook_patch 写正文，并在同一写作过程中调用 notebook_notes({expectedRevision,blockId,notes}) 追加对应备注，无需等全文写完再迁走。新行和其备注可以同次提交；独立调用 notebook_notes 时该行须已存在。公开 Markdown 仍由程序从正文白名单生成，内部字段不拼入正文，不通过隐藏 Markdown 或 HTML 注释夹带。
篇幅目标仅统计面向读者的正文，不含内部备注、标题、来源清单或 JSON 语法。正文按完整目标展开；在此之外为有用的内部说明另预留约正文预算的 15%–25%，并给结构语法留余量。这是生成预算，不是备注最低字数或凑字数要求。例如正文要求 2400–2800 字，不能把 400 字备注计入正文，也不能因此把正文压到 2000 字。没有明确篇幅时按材料和问题充分展开，不因增加内部字段主动缩短正文。`;
