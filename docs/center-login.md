# 登录 RSSD 中心

RSSD 使用中心现有的 Postiz 账号和组织。登录设备不会自动开启工作模式，也不会移动原有本地稿件。

## 桌面客户端

在「中心 → 中心账号连接」填写中心的 HTTPS 地址和设备名称，点击「登录 RSSD 中心」。系统浏览器会沿用已有登录会话；未登录时，先完成中心原有的登录流程。

在授权页确认当前组织，勾选这台设备需要访问的工作空间，再批准授权并返回 RSSD。授权申请五分钟内有效。系统可能要求允许 RSSD 访问钥匙串或系统凭据库；密码和验证码只在系统或中心页面输入。

浏览器已经批准、但客户端连接尚未保存时，可以展开「恢复已确认的授权」，点击「继续保存连接」。如果申请过期或被拒绝，重新发起登录即可。验证新连接失败时，原连接仍保留。

需要更换中心或组织时，先停止工作模式，保存本机草稿。存在未解决的认领时，先恢复原任务，或在确认不再由本机处理后明确释放认领。不同中心、组织的草稿和未确认回执分别保存；切换连接不会把旧请求发送到新组织。

「退出中心连接」只退出本机连接，保留稿件和原请求。要撤销设备访问，在中心「执行设备」中选择对应设备并撤销。旧设备凭据继续有效，不因升级而要求周期性登录。

## Linux 无头客户端

安装固定版本制品后运行：

```sh
rssd center login https://your-center.example --name 'Linux worker'
```

终端会显示授权网址、设备码和有效期。在另一台有浏览器的设备上打开该网址，使用原 Postiz 账号确认组织和工作空间。服务器按规定间隔等待批准，不需要安装或启动浏览器。设备码十分钟内有效；按 Ctrl+C 可取消本次等待，过期或拒绝后重新运行命令。

连接成功后先检查身份和工作空间：

```sh
rssd center status
rssd center registry
```

登录不会启动生产。工作模式需要另外显式指定智能体和工作空间；迁移尚未完成的工作空间不能领取和提交任务。

```sh
rssd center work --agent codex --workspace example --once
rssd center work --agent codex --workspace example --once --resume
rssd center recover
```

已有中文作品的英文补译：默认 `enqueue-translate` 在栏目含 en 目标时仍可能创建发布任务。若只要中心存英、不发、且禁止其他设备抢领，须中心已部署 [rssd-center PR 10](https://github.com/scholay-rssd/rssd-center/pull/10) 的 `f38d8e6b`，overview `contracts.storeOnlyTranslate` 为整数 `version >= 1` 且十一项 guarantees 齐全（含 `receiptIsolation` / `openWorkFence`），再按 [store-en](rssd-store-only-translate.md) 对单个 `workId` 执行 `store-en`，然后 `center work --agent <本机 Agent Registry 标识> --workspace <id> --id <demandId> --once --store-only`。中心 CI 通过不等于已上线。`1db773af` 的九项包必须拒绝。不要对 `enqueue-translate` 加 `--store-only`。不要新建中文作品，也不要用 `cloud-sync`、`rssd produce` 或 `SCHOLAY_CLOUD_EXECUTOR` 冒充启动。本云验收 VM 缺 CLI 只说明该 VM；共享电脑已有的 Codex/Cursor CLI 不由本仓库自动调用。

恢复时使用原认领和原请求，不另建稿件或重新发布。已失效的认领不能继续提交，必须先处理它的恢复或释放状态。

Linux 设备状态位于独立的私有认证目录，可通过 `RSSD_CENTER_HOME` 指定；新建目录权限为 `0700`，凭据文件为 `0600`。安装和更新运行时不会替换设备状态。不要把这个目录放入源码、公开发布目录或共享日志中。
