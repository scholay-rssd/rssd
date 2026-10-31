---
name: scholay-desktop-publishing
description: Save, preview, hand off and retrieve Scholay website manuscripts through the desktop scholay-workbench MCP. Use for local-to-cloud drafts, version conflicts and publication receipts; not for AdsPower or third-party platform publishing.
---

# 桌面稿件交接

1. 使用 works_list 确定文章 ID，draft_read 读取正文与 SHA；只处理用户选定的稿件。
2. 新稿用 draft_create；修改用 draft_save 并携带读取时的 expectedSha256。图片保存在本篇 assets 目录，正文用相对路径。
3. 上传前检查日期、摘要、栏目、出处和图片，调用 cloud_prepare，intent=draft 表示非公开交稿，intent=publish 表示请求公开。阅读工具返回的预览与 fingerprint。
4. 使用 cloud_submit 进入客户端确认卡；让用户检查并确认。具体参数以 MCP tools/list 为准，不猜字段。
5. 分别报告“本地保存”“云端私稿成功”“已公开”。未得到成功回执不声称完成。超时保留原请求编号，使用 cloud_status 查原任务。
6. 继续编辑云端稿时先 works_list / cloud_pull，保留版本信息；有本地修改时根据冲突结果比较，不覆盖。多设备编辑遵循服务端版本检查。

公开、撤回、删除和私稿上传都由客户端处理权限及确认。不要读取令牌、手工写回执、直接请求管理接口、调用旧仓库脚本或另建一套文章索引。暂不执行第三方平台分发。
