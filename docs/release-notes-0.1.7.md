# dsh-version-manager 0.1.7

## 简体中文

- 将主分支已有的 HTTP 路由准入修复纳入发行包：全部 16 条路由先调用宿主 `connection.requestRejection(request)`，执行 Host/Origin 与身份检查，再验证 owner 权限、读取请求体和访问 profile 服务。
- 宿主检查缺失、抛错或返回非法值时拒绝访问。该接口必须同步返回 `undefined`、`401` 或 `403`；异步结果也拒绝，并消费其 Promise 拒绝，避免出现未处理拒绝。
- 保留只允许 owner、HTTP 方法限制、写操作显式确认和路由卸载清理；新增异步拒绝及 connection 服务不可读的全路由回归测试。
- 已核对的官方 rc.3 宿主中，`requestRejection` 委托 `admit`，而 `admit` 本身已检查 Host/Origin；本次明确调用宿主公开检查接口并加强失败时拒绝访问的处理，不据此宣称该宿主已有准入绕过。
- 保留 0.1.6 的客户端布局和现有 Node.js `>=22`、DSH `>=0.2.2-rc.1` 声明。宿主必须提供上述同步准入接口；无法验证该接口时 HTTP 功能不可用。
- 更新既有 profile 中的插件后，确认宿主已重新加载新版，再打开版本管理。版本恢复仍不回滚配置、依赖树或 agent presets。

## English

- Include the HTTP route admission fix already on main in the distribution: all 16 routes call the host's `connection.requestRejection(request)` for Host/Origin and authentication checks before owner authorization, body parsing or profile service access.
- Refuse access if the host check is missing, throws or returns an invalid value. The contract is synchronous and accepts only `undefined`, `401` or `403`. Asynchronous results are refused and their promise rejections are consumed to avoid unhandled rejections.
- Preserve owner-only access, HTTP method checks, explicit write confirmation and route disposal. Add regressions across every route for rejected asynchronous verdicts and unavailable connection services.
- In the verified official rc.3 host, `requestRejection` delegates to `admit`, which already checks Host/Origin. This release explicitly uses the host's public check and strengthens fail-closed handling; it does not establish an admission bypass in that host.
- Retain the 0.1.6 client layout and declared Node.js `>=22` / DSH `>=0.2.2-rc.1` ranges. The host must provide the synchronous admission API above; HTTP features remain unavailable when that check cannot be verified.
- After updating the plugin in the existing profile, confirm that the host has reloaded the new version before opening Version manager. Version restore still does not roll back configuration, dependency trees or agent presets.
