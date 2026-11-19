# 开发 rssd 的约定

本文件写给在这个仓库里开发 rssd 本身的会话。写作工作区里的智能体规则在
`desktop/resources/workspace-template/AGENTS.md`，不在这里。

## 仓库组成

rssd 是总仓库，另有五个子模块，各自是独立的公开仓库：

| 路径 | 仓库 |
| --- | --- |
| `center` | scholay-rssd/rssd-center |
| `obsidian` | scholay-rssd/rssd-obsidian |
| `sites` | scholay-rssd/rssd-sites |
| `web/themes` | scholay-rssd/rssd-themes |
| `web/demo` | scholay-rssd/rssd-examples |

子模块在总仓库里只是一个指针（gitlink）。改子模块的代码，要先在对应子仓库开 PR、合并，
总仓库再把指针移到合并后的提交。

所有仓库都是公开的。主机名、IP、本机路径、令牌和真实数据一律不进仓库；私有内容放在
`editorial/`、`deploy/` 等私有叠加目录（见 `docs/private-data-overlay.md`）。
`scripts/check-public-boundary.mjs` 会拦截其中一部分，可以用
`git config core.hooksPath .githooks` 在提交前自动检查。

## 按主题线分工

开发按主题线并行进行，每条线默认负责下面这些目录。这是默认归属，不是硬边界：
跨线的功能由一个会话从头做到尾，在 PR 描述里写明碰到了哪些线的目录。

| 主题线 | 默认负责 | 改动提到 |
| --- | --- | --- |
| 写作效果 | `contracts/writing-skills/`、`contracts/writing-defaults*`、`contracts/article-writing-policy.mjs`、`contracts/editorial-column-policy.mjs`、`contracts/writing-column-families.json`、`contracts/annotation-forms.*`；选题、取材、配图脚本 `scripts/rssd-topic-*`、`scripts/rssd-source-*`、`scripts/rssd-image-*`；`scripts/*writing-defaults*`；工作区模板 `desktop/resources/workspace-template/`；`docs/writing-defaults.md`、`docs/mounts.md` | rssd；由 Center 下发的部分也提到 rssd-center |
| 站点样式 | `web/engine/`、`web/modules/`、`web/guestbook/`、`contracts/site-*.mjs`，子模块 `web/themes`、`sites`、`web/demo` | rssd-themes、rssd-sites、rssd-examples、rssd |
| 中心收发 | 子模块 `center`；`receiver/`、`admin/`；`scripts/rssd-center-*`、`scripts/rssd-production-worker.mjs`、`scripts/rssd-multisite-*`、`scripts/publishing-*`、`scripts/publication-*`、`scripts/website-*` | rssd-center、rssd |
| Obsidian 插件 | 子模块 `obsidian` | rssd-obsidian |
| 桌面与无头 | `desktop/`（工作区模板除外）、`HEADLESS.md` | rssd |
| 架构优化 | 不固定。产出方案文档放 `docs/`；要动代码时拆成小 PR，交给对应主题线，或在其他线空闲时做。当前待办见 `docs/architecture-backlog.md` | rssd |
| 集成维护 | 子模块指针、`.github/workflows/`、根目录 `package.json` 的依赖；合并、部署、发版 | rssd |

## 协同规则

1. **一个任务一个 worktree、一个分支、一个 PR。** 分支名用 `claude/<主题>`，PR 尽量小。
2. **动手前先看有没有开着的 PR 在改同一处：**

   ```bash
   for r in rssd rssd-center rssd-obsidian rssd-sites rssd-themes rssd-examples; do echo "== $r"; gh pr list --repo scholay-rssd/$r; done
   ```

3. **`contracts/` 是各端共用的协议。** 改协议的 PR 只改协议和它直接需要的测试，先合并；
   其他线再 rebase。谁改了协议，谁负责把下游的测试修好。
4. **子模块指针。** 只移动指针的 PR 由集成线统一做，一次把各个指针移到对应子仓库 main 的最新提交。
   功能 PR 如果依赖子仓库的新提交，可以顺带移动指针，但只能指向子仓库 main 上已合并的提交，
   并在 PR 描述里写明。rebase 时指针冲突，取两边里较新的那个 main 提交：
   `git update-index --cacheinfo 160000,<sha>,<路径>`。
   CI 会检查这一条：`submodule-pins` 工作流在指向 main 的 PR 和 main 的推送上运行
   `node scripts/check-submodule-pins.mjs`，指针不在子仓库 GitHub main 上就失败。
5. **worktree 里的子模块。** 如果本机 git 配置把子模块地址指向主 checkout，
   worktree 里就检出不了主 checkout 还没 fetch 的提交。单条命令临时改用 GitHub 地址即可，
   不要改共享配置：

   ```bash
   git -c submodule.center.url=https://github.com/scholay-rssd/rssd-center.git submodule update --depth 1 -- center
   ```

6. **合并顺序：** 协议 PR → 子仓库 PR → 依赖它们的总仓库 PR → 只移动指针的 PR。
   每个 PR 合并前都由 CI 跑全量测试，见下文"必需检查与自动合并"。
7. **部署与发版同一时间只由一个会话做。** 包括 Center 镜像切换、站点服务器任务、
   Obsidian 插件签名发版。线上运行的提交不一定在 main 上：部署前先查清线上实际运行的提交，
   两个方向都对比一遍（`git log 线上..新`、`git log 新..线上`），既不丢线上已有的改动，
   也不顺手带上没打算发布的改动。
8. **PR 描述就是交接单。** 写清改了什么、为什么、怎么验证的，以及下一步需要谁做什么
   （例如"需要集成线把 center 指针移到 `abc1234`"）。其他线需要知道的决定写进 `docs/` 或本文件，
   不要只留在对话里。

## 必需检查与自动合并

main 有分支保护，合并前必须通过下面四项检查，结果都要来自 GitHub Actions：

| 检查 | 内容 |
| --- | --- |
| `public-boundary` | 公开边界检查 |
| `secrets-schema` | 代码读取的每个密钥都已在 rssd-secrets 里声明 |
| `public-build` | `npm run check`、`npm test`、Obsidian 插件（指针所指提交）的测试和构建、Python 测试、demo 构建、桌面端类型检查和网页构建 |
| `linux` | 打包 receiver，并用装好的包跑双语页面测试 |

- PR 开好、自己的检查做完之后，可以直接设成通过即自动合并：`gh pr merge <编号> --auto --merge`。
  仓库用 merge commit 合并，合并后远端分支自动删除，本地 worktree 和分支要自己清理。
- 不要求 PR 先 rebase 到最新 main，也不要求审查。管理员可以绕过保护，但不要为了赶时间绕过；
  检查失败就修好再合。
- 三平台无头打包（`package`）和 `browser` 导出不是必需检查；桌面打包只在 main 上按路径触发。
- 这四项在同仓库的 PR 上也会真正运行，不像无头打包那样跳过：跳过的同名检查会被 GitHub 算作通过。
  以后新增必需检查，也要保证它在每个 PR 上都会真正运行，否则要么形同虚设，要么永远等不到结果。
- 来自 fork 的外部 PR，要维护者在 GitHub 上批准后 CI 才会运行。会话不要代为批准。

## 提 PR 前

- `npm run check`
- `node scripts/check-public-boundary.mjs`
- 跑和改动相关的测试：`node --test tests/<名称>.test.mjs`；改了桌面端加跑 `npm run desktop:test`；改了 `contracts/`、`web/themes` 或 `sites`，在 `obsidian/` 里跑 `npm ci && npm test && npm run build`

## 用词

内容的基本单位叫"作品"（work）：一篇内容连同它的各语言版本和生成的视图（文章页、笔记页、
卡片等）。中英文版本属于同一个作品，不是两个作品。下面这些词已有别的含义，不要混用：
bundle 指一次发布出去的修订；web 引擎代码里的 collection 指栏目；合集类的容器另有命名。
