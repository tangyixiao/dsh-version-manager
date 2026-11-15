# dsh-version-manager 0.1.6

## 简体中文

- 修复长包名与本地安装路径挤压表格列宽、导致预发布版本号断行的问题。
- 为版本、状态和操作列保留稳定空间；长名称与路径省略显示，悬停或展开详情可读取全文。
- 窄窗口下，插件和 Skill 表格在自身区域内横向滚动，避免撑宽整个页面。
- 为中英文标签分别预留列宽，保留键盘展开、筛选及更新前确认流程。
- 继续支持 DSH `>=0.2.2-rc.1` 和 Node.js `>=22`。本次仅调整客户端呈现，不改变宿主写入操作。

## English

- Fix long package names and local installation paths squeezing table columns and wrapping prerelease versions.
- Reserve space for versions, states and actions. Abbreviate long summary text while keeping full values in tooltips and expanded, selectable details.
- Contain horizontal scrolling within plugin and Skill tables on narrow windows.
- Account for Chinese and English label widths, preserving keyboard expansion, filtering and update confirmation.
- Retain DSH `>=0.2.2-rc.1` and Node.js `>=22` support. This release changes client presentation only, without changing host write operations.
