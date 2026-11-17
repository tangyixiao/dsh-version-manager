# dsh-version-manager 0.1.8

## 简体中文

- 修复主面板纵向滚动，根据窗口与宿主裁切区域计算可见高度；保留窄屏横向滚动。
- 单项检查自动展开结果；新增批量检查、版本变化预览与统一确认更新，逐项执行且失败即停。
- 支持明确确认后将本地 `.tgz` 安装迁移到同名 npm 正式版；检查包身份、兼容性、旧来源及安装包指纹，失败时尝试恢复原来源，保留停用状态。
- 批量迁移默认关闭；不替换 Git、目录、别名和官方内置来源，不自动降级或选择预发布。
- 更新前保存快照，共享写入锁；完成后回读实际版本及来源。保留 DSH Host/Origin 与 owner 认证检查。
- 推荐使用 npm 安装，后续可以直接在线更新。
- 将主分支已有的 HTTP 路由准入修复纳入发行包：全部 16 条路由先调用宿主 `connection.requestRejection(request)`，执行 Host/Origin 与身份检查，再验证 owner 权限、读取请求体和访问 profile 服务。
- 宿主检查缺失、抛错或返回非法值时拒绝访问。该接口必须同步返回 `undefined`、`401` 或 `403`；异步结果也拒绝，并消费其 Promise 拒绝，避免出现未处理拒绝。
- owner 准入同样要求同步结果；异步结果及不可读取的服务、拒绝状态或身份字段会安全拒绝，Promise/thenable 的拒绝被消费。
- 保留只允许 owner、HTTP 方法限制、写操作显式确认和路由卸载清理；新增异步拒绝及 connection 服务不可读的全路由回归测试。
- 已核对的官方 rc.3 宿主中，`requestRejection` 委托 `admit`，而 `admit` 本身已检查 Host/Origin；本次明确调用宿主公开检查接口并加强失败时拒绝访问的处理，不据此宣称该宿主已有准入绕过。
- 保留现有 Node.js `>=22`、DSH `>=0.2.2-rc.1` 声明。宿主必须提供上述同步准入接口；无法验证该接口时 HTTP 功能不可用。
- 更新既有 profile 中的插件后，确认宿主已重新加载新版，再打开版本管理。版本恢复仍不回滚配置、依赖树或 agent presets。

## English

- Bound vertical scrolling to the actual visible host area while retaining narrow-screen horizontal scrolling.
- Expand individual version results automatically; add batch checks, exact previews and confirmed sequential updates that stop on failure.
- Opt into migrating local `.tgz` installs to the same named stable npm bundle. Validate identity, compatibility, source and archive fingerprint, preserve disabled state, and attempt rollback to the retained original archive on failure.
- Local migration is off by default. Git, directories, aliases, official bundles, downgrades and prereleases are excluded.
- Snapshot before changes, serialize writes and verify the installed version/source after completion. Preserve host admission and owner authentication.
- Prefer npm installation for subsequent online updates.
- Include the HTTP route admission fix already on main in the distribution: all 16 routes call the host's `connection.requestRejection(request)` for Host/Origin and authentication checks before owner authorization, body parsing or profile service access.
- Refuse access if the host check is missing, throws or returns an invalid value. The contract is synchronous and accepts only `undefined`, `401` or `403`. Asynchronous results are refused and their promise rejections are consumed to avoid unhandled rejections.
- Owner admission also requires a synchronous result. Asynchronous results and unreadable service, rejection or principal fields fail closed, and rejected promises/thenables are consumed.
- Preserve owner-only access, HTTP method checks, explicit write confirmation and route disposal. Add regressions across every route for rejected asynchronous verdicts and unavailable connection services.
- In the verified official rc.3 host, `requestRejection` delegates to `admit`, which already checks Host/Origin. This release explicitly uses the host's public check and strengthens fail-closed handling; it does not establish an admission bypass in that host.
- Retain the declared Node.js `>=22` / DSH `>=0.2.2-rc.1` ranges. The host must provide the synchronous admission API above; HTTP features remain unavailable when that check cannot be verified.
- After updating the plugin in the existing profile, confirm that the host has reloaded the new version before opening Version manager. Version restore still does not roll back configuration, dependency trees or agent presets.
