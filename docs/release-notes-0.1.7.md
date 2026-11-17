# dsh-version-manager 0.1.7

## 简体中文

- 修复主面板纵向滚动，根据窗口与宿主裁切区域计算可见高度；保留窄屏横向滚动。
- 单项检查自动展开结果；新增批量检查、版本变化预览与统一确认更新，逐项执行且失败即停。
- 支持明确确认后将本地 `.tgz` 安装迁移到同名 npm 正式版；检查包身份、兼容性、旧来源及安装包指纹，失败时尝试恢复原来源，保留停用状态。
- 批量迁移默认关闭；不替换 Git、目录、别名和官方内置来源，不自动降级或选择预发布。
- 更新前保存快照，共享写入锁；完成后回读实际版本及来源。保留 DSH Host/Origin 与 owner 认证检查。
- 推荐使用 npm 安装，后续可以直接在线更新。

## English

- Bound vertical scrolling to the actual visible host area while retaining narrow-screen horizontal scrolling.
- Expand individual version results automatically; add batch checks, exact previews and confirmed sequential updates that stop on failure.
- Opt into migrating local `.tgz` installs to the same named stable npm bundle. Validate identity, compatibility, source and archive fingerprint, preserve disabled state, and attempt rollback to the retained original archive on failure.
- Local migration is off by default. Git, directories, aliases, official bundles, downgrades and prereleases are excluded.
- Snapshot before changes, serialize writes and verify the installed version/source after completion. Preserve host admission and owner authentication.
- Prefer npm installation for subsequent online updates.
