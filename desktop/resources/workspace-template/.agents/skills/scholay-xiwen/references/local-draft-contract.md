# 本地交稿约定

## 位置、状态和保护

- 唯一稿件索引为 `_ops/inventory/article-index.json`；栏目目录必须在 `annexColumns` 中，官网栏目另由 `archiveCategory` 表达。
- 内容工作台的编辑步骤使用 `draft_create` 注册新稿，只传 id、title、markdown（结构化类型另传 fields），栏目目录与官网栏目由工作台按任务类型决定；外部脚本使用现有 `scripts/editorial-workspace.mjs` 的 `createDraft`。稳定 ID 不随标题改变；不要只写一个孤立的 Markdown 文件。
- 修改已有稿件用 `readDraft` 取得当前 SHA，再用 `saveDraft` 的 `expectedSha256` 保存。冲突时读取新版本，不强行覆盖。
- 新稿正文固定为 `articles/annex/<栏目>/<序号>_<中文标题>/正文.md`，登记时保留来源 URL，RSS 来稿另保留实际 RSS ID。
- 无发布回执的新稿只表示本地草稿；不伪造云端/平台状态。正文可标“本地未发布稿”，供编辑明确识别。
- 不改既有正文、发布包或远端服务。批量写作不授权上传、提交、推送 Git 或飞书写入。

从统一项目根调用的最小示例（参数需替换成实际已核对内容）：

```js
import {createDraft} from './scripts/editorial-workspace.mjs';
await createDraft({
  id: 'stable-article-id',
  title: '实际中文标题',
  column: '学界犀闻',
  archiveCategory: '学界犀闻',
  markdown: '# 实际中文标题\n\n完整正文',
  sources: [{url: 'https://example.org/actual-source', cleanedAt: 'YYYY-MM-DD'}]
});
```

## 配图与复用

- `assets/source/` 保存 Cursor 实际生成的 PNG/JPEG/WebP 原图（历史 SVG 图源保留）；`assets/rendered/` 保存正文引用的 WebP。不要引用机器绝对路径、热链图片或其他稿件的图片路径。
- 图要解释正文里的结构、过程或对照。没有数据时不画虚假坐标和性能数值；概念示意明确标注。图库对话生图提示不要绘制 `scholay today` 水印，原图登记到图库，选入文章并上传时统一加一次；不能冒充实验室原图。
- 建议宽 1200 像素，正文字号至少 26–28 像素。单图小于 1 MiB、每篇配图合计小于 2 MiB，以适配现有发布分支。
- 文章编辑时先使用占位图，编辑完成后再配图。图库对话使用 `asset_register` 校验并登记真实文件；文章编辑器从图库选用或手动导入，替换检查当前正文 SHA，保留原图与前一版。文章流程不调用 GenerateImage 或 asset_register。历史 SVG 渲染脚本可继续用于原有批量稿，不能代替本轮明确要求的 Cursor 生图验收。
- 每张成图逐一核对文字、日期、数值、箭头和历史年代，至少抽查每种布局的小屏预览。错误图片明确指定 `replaceId` 重新生成并保留旧版；生成失败不自动重试。

## 证据、brief 与清单

- `_ops/inventory/briefs/<id>.md`：读者问题、核心事实/方法、材料范围、边界、配图、目标状态。
- `_ops/inventory/sources/<批次>.json`：URL、机构/维护者、发布日期或空值、核对日期、来源类型；项目另记许可与归档状态。不要写登录信息或原始个人 RSS 正文。
- 在 `_ops/inventory/link-targets.md` 登记本批来源清单。正文链接紧邻相应事实；机构转述和独立重现实验必须区分。
- 批量输出 `_ops/inventory/batches/<批次>.json` 和 `.md`：逐篇 ID、栏目、路径、SHA、图片、来源与本地状态。SHA 只是本次交付记录，后续编辑应由工作区重新读取，不能强制拿旧 SHA 覆盖新正文。

## 完成检查

1. 数量、栏目、标题与 ID 无重复；新稿已在索引中。
2. 桌面预览开启 `embedImages` 后应正常显示图片；MCP `draft_preview` 为控制上下文大小不嵌入图片，其“未打包”提示不能当成图片缺失，也不能作为图片成功证据。使用 `packedDraft` 或发布检查实际解码、打包并逐图核对。至少现场查看三类样稿；客户端若未刷新，明确区分文件已创建与界面已显示。
3. 比较本次开始时的既有正文 SHA，确认未改用户原稿。
4. 从项目根运行 `npm run editorial:check` 与 `npm run editorial:test`。检查范围不等于已发布或平台验收。
5. 新增/修改 Skill 时运行 `skill-creator` 的 `quick_validate.py`。交付时分别说明稿件、图片、Skill、校验和未完成项。
