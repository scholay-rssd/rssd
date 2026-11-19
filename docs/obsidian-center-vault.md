# Obsidian：一个 vault 装多个空间（设计稿）

状态：待审。Obsidian 插件线，2026-11-19。

## 目标

现在一个 vault 只能绑一个空间，需求池还要另开一个 vault。有 10 个空间的人要开 11 个 vault，
而兼职通常只碰一两个空间。目标是：

- **一个 vault 对应一个 Center**，里面装这台设备被授权的所有空间，也可以只勾选其中几个。
- 作品、选题、发布状态这些都在同一个 vault 里看，范围由同一组勾选决定。
- 兼职的设备只被批准一两个空间，打开后看到的就是这一两个，体验和现在的单空间 vault 几乎一样。
- 现有的单空间 vault 不用重新下载，可以直接收编进来，未保存的编辑和等待中的保存都留着。

不做：在插件里发布；在插件里管权限（权限只由 Center 的设备授权决定）。

## 现状：哪些地方绑死了一个空间

- 设置：`workspaceId` 和 `boundSpace` 只有一个值，绑定后不能改（`src/main.js`）。
- 路径：`notePath()` 固定是 `Works/<id>.md` 或 `Works/en/<id>.md`；自动同步、路径保护、命令链接都按这个路径匹配。
- vault 根目录下的固定文件夹：`article-media/`、`.rssd/private-additions/`、`card-styles/<栏目>.css`、`Card Samples/`、`Exports/cards/`。
  栏目 ID 在不同空间之间可能重名，`card-styles/` 混在一起会冲突。
- 需求池 vault 和作品 vault 只能二选一（`canBecomePool`）。
- 同步记录 `baselines`、`baselinesByLocale` 已经按空间分开存，**这一层不用改**。

## 结构

vault 根目录对应一个 Center。每个空间一个文件夹，**用站点主机名命名**，文件夹里面和今天的单空间 vault 完全一样，
另外多一个 `Topics/`：

```
<Center vault>/
  .obsidian/                      插件和它的同步记录（一份，覆盖所有空间）
  pet.piggytuck.com/              空间 pets
    Works/<id>.md   Works/en/<id>.md
    Topics/<栏目>/<标题>.md        这个空间的选题（原来在需求池 vault 里）
    article-media/  .rssd/private-additions/  card-styles/<栏目>.css
    Card Samples/   Exports/cards/
  xsiching.com/                   空间 xsiching
    ...
```

为什么这样分：

- **周边脚本不用改。** `scripts/output-check.mjs --vaults <文件夹>` 本来就按主机名找子文件夹下的 `Works/`。
  `scripts/rssd-card-samples.mjs` 把 `Works/` 的上一级当作 vault，`Card Samples/` 自然落在空间文件夹里。
  `scripts/rssd-image-supplement.mjs` 传空间文件夹就行。
- **笔记里的相对链接不变。** `../article-media/x.png`、`../../article-media/x.png` 在空间文件夹里照样成立。
- **不会冲突。** 栏目样式、卡片样本、私有记录都按空间分开。
- **好清理。** 不再要某个空间时，删掉它的文件夹就行。
- **用主机名命名**，和现在常见的单空间 vault 叫法一致（`legis.wiki`、`pet.piggytuck.com`……）。
  主机名取自 `sites/profiles.json` 的 `origin`。站点改名时（`contracts/site-renames.mjs`），文件夹名保持不变，以设置里记的为准。

## 装哪些空间

- **能装的** = 这台设备在 Center 上被批准的空间（`/registry`）。这是唯一的权限边界：没批准的空间，插件根本读不到。
- **实际下载的** = 能装的空间里勾选的那些。设置里每个空间有两个勾：**作品**、**选题**。
  - 第一次登录时默认全勾。某个空间作品超过 500 篇（目前只有 academic，2648 篇）时，先只勾选题，作品需要手动打开，避免第一次同步太久。
  - 取消勾选：停止同步，文件留着，不再更新；有没保存的编辑时会提醒。删除文件夹需要另外的明确操作。
  - Center 撤回了某个空间的授权：文件夹留着、标成只读，提示授权已撤回。
- 只装一个空间时，作品列表、筛选和状态栏都不显示空间这一层，看起来和现在一样。

## 同步

- 一个操作闸门，所有空间共用，和现在一样同一时间只跑一个操作。
- 自动同步对勾选的空间逐个轮流扫描（每小时一轮），编辑仍然在几秒后保存。
- 现在 10 个 vault 在启动后 20 分钟内错开（`startupDelay`）。合成一个 vault 后不再需要按 vault 错开，改成在一个 vault 内部按空间错开。
- 保存、冲突、私有记录、按路径复用图片等规则全部不变，只是每次都带上作品所在的空间。
- "保存全部"按空间分批：一个空间拒绝保存时只停那个空间。

## 界面

- **作品列表**：多一个 **空间** 筛选（单空间时隐藏），卡片上的栏目标签前加空间名。搜索、其他筛选、排序都不变。
- **四个标签页、审阅侧栏、卡片**：都跟着当前作品所在的空间走：站点样式、栏目模板、栏目 AI 样式表都取自那个空间。
- **选题**：作品列表旁边加一个 **选题** 标签，按空间 › 栏目分组。选题完成后带上 `rssd-work`，可以直接打开同一个 vault 里的作品。
- **发布状态**（第 4 步）：作品卡片显示网站上发布的是哪个版本，卡住的发布标红，并说明原因。
- **阅读器**：保留，切换站点时只列出这个 vault 里勾选的空间。

## 需求池 vault 怎么办

需求池 vault 不再是一种单独的模式：它就是一个只勾了 **选题**、没勾 **作品** 的 Center vault。现有的需求池 vault 收编时，
选题笔记从 `Topics/<空间>/<栏目>/` 移到 `<主机名>/Topics/<栏目>/`，`rssd-demand` 属性不变，所以不会重复。

## 收编旧 vault

两种方式，都不用重新下载：

1. **就地收编（推荐）**：旧 vault 都放在同一个父文件夹里、并且按主机名命名时，把这个父文件夹直接作为 Center vault 打开，里面的 `legis.wiki/` 这些就是空间文件夹。
   插件读每个子文件夹里旧的 `.obsidian/plugins/rssd/data.json` 和 `baselines.journal`，核对 Center 地址和空间，
   把同步记录、路径记录、等待中的保存（含请求键）加上文件夹前缀并入新 vault，然后把旧的 `.obsidian/` 改名留档（不删）。
2. **新建后收编**：在新 vault 里把旧 vault 文件夹拖进来，再执行同样的收编命令。

收编前必须关掉旧 vault 的 Obsidian 窗口；插件检测到旧设置在 5 分钟内被写过，就拒绝收编。收编不发任何请求，
设备令牌也不搬：新 vault 自己登录一次。

不想收编的话，新建一个空的 Center vault，从 Center 拉取即可（Center 是真实来源）。但要先在旧 vault 里把编辑都存上去。

## 对其他线的影响

- **桌面与无头**：桌面端、无头端和智能体有没有直接打开 vault 或写 vault 里的路径？目前看到的是 `rssd-image-supplement` 和 `rssd-card-samples`，
  这两个不受影响。**需要桌面与无头线确认**还有没有别的。
- **命令链接**：`path=` 改成相对 vault 根的路径（`<主机名>/Works/<id>.md`）。只装一个空间时，旧的 `Works/<id>.md` 仍然接受。
- **Center**：作品和选题不用改。发布状态这一步需要 `/publications` 支持按作品或 `updatedSince` 查询：现在只能按空间分页，3676 条要全量翻页。
  留言审核目前只有管理员能用（`admin(ctx)`），设备做不了；要做就得在 Center 上加一项授权，这一步先不排。

## 手机

3600 篇作品放进一个 vault，Obsidian 手机端能打开，但第一次索引会慢。手机端仍然只读；建议手机上只勾自己常看的空间。

## 分步

每一步都是 rssd-obsidian 里的一个 PR，合并后发一个插件版本。

1. **空间文件夹 + 多空间同步。** 新 vault 用新结构；现有的单空间 vault 不动，继续按原样工作（`Works/` 在根目录，视为唯一的空间）。
2. **收编旧 vault**，包括需求池 vault。
3. **选题并入**：空间的两个勾、选题标签页，需求池模式退役。
4. **发布状态**：先给 Center 加查询参数（中心收发线），再做插件这边。
5. **写作规则**：在详情里显示栏目的写作规则，接口是公开的 `writing-defaults`。

## 待定

1. 第一次登录默认全勾，academic 这类大空间先只勾选题：可以吗？
2. 文件夹用主机名（`pet.piggytuck.com`），还是用空间 ID（`pets`）？主机名能和现有文件夹、脚本对上；空间 ID 更短，站点改名也不受影响。
3. 收编时旧的 `.obsidian/` 是改名留档，还是直接删？
