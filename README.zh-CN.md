<p align="center"><img src="assets/logo.webp" width="128" height="128" alt="DSH Version Manager logo"></p>

<h1 align="center">DSH Version Manager</h1>

<p align="center">查看运行中 profile 的插件与 Skills，预览更新、保存可验证快照，并明确哪些状态能恢复。</p>

<p align="center">[简体中文](README.zh-CN.md) · [English](README.md)</p>

[![Stars](https://img.shields.io/github/stars/tangyixiao/dsh-version-manager?style=flat)](https://github.com/tangyixiao/dsh-version-manager/stargazers) [![CI](https://img.shields.io/github/actions/workflow/status/tangyixiao/dsh-version-manager/check.yml?branch=main)](https://github.com/tangyixiao/dsh-version-manager/actions/workflows/check.yml) [![License](https://img.shields.io/github/license/tangyixiao/dsh-version-manager)](LICENSE) [![npm](https://img.shields.io/npm/v/dsh-version-manager)](https://www.npmjs.com/package/dsh-version-manager)

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/feature-1-zh-CN-dark.svg"><img src="docs/assets/feature-1-zh-CN-light.svg" width="260" alt="真实安装清单: 声明、磁盘版本与加载状态分开"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/feature-2-zh-CN-dark.svg"><img src="docs/assets/feature-2-zh-CN-light.svg" width="260" alt="更新前快照: 保存并回读 SHA-256 证据"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/feature-3-zh-CN-dark.svg"><img src="docs/assets/feature-3-zh-CN-light.svg" width="260" alt="明确恢复边界: 保留原状态与可用返回路径"></picture>
</p>

## 开始使用

Desktop：从发行页下载 `.tgz`，在“扩展 → 插件管理 → 添加插件”中安装。命令行示例用于你明确控制的 Web profile：

```sh
dsh plugin --profile web add dsh-version-manager@0.1.3
```

在原有 Desktop/Web profile 中安装并打开“版本管理”。先查看清单与更新预览，再确认具体 from → to；新建空 profile 还需要 Web 应用 bundle。

## 当前状态与兼容性

| 项目 | 当前依据 |
| --- | --- |
| 源码版本 | `0.1.3` · 以 [package.json](package.json) 为准 |
| 分发方式 | `npm` · [Releases](https://github.com/tangyixiao/dsh-version-manager/releases) |
| DSH | `>=0.2.2-rc.1` |
| Node.js | `>=22` |
| 开发状态 | [Open issues](https://github.com/tangyixiao/dsh-version-manager/issues?q=is%3Aissue+is%3Aopen) · [CI](https://github.com/tangyixiao/dsh-version-manager/actions) |

恢复不等于完整备份：插件版本恢复不回滚配置、依赖树和 agent presets。Git、tarball 与本地来源能否重放按实际证据判断。

[Detailed guide](docs/guide.en.md)

## 开发与参与

```sh
npm test
node tools/check-repository.mjs
```

[Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Questions](https://github.com/tangyixiao/dsh-version-manager/discussions) · [Report a bug](https://github.com/tangyixiao/dsh-version-manager/issues/new/choose) · [Security](SECURITY.md) · [Maintenance](docs/maintenance.md)

## Star History

<picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=tangyixiao/dsh-version-manager&amp;type=date&amp;theme=dark&amp;legend=top-left"><img src="https://api.star-history.com/chart?repos=tangyixiao/dsh-version-manager&amp;type=date&amp;legend=top-left" width="900" alt="DSH Version Manager Star History"></picture>

[Interactive chart](https://www.star-history.com/?repos=tangyixiao%2Fdsh-version-manager&type=date) · [GitHub Stars](https://github.com/tangyixiao/dsh-version-manager/stargazers)

图表由外部服务按真实星标数据生成，可能缓存或暂时不可用；未填造开发百分比。

## 来源与许可

[Software license](LICENSE) · [Logo artwork and attribution](assets/NOTICE.md)

软件保持原许可证；鲸鱼娘衍生美术单独采用 CC BY-NC-SA 4.0，并保留上善、ZipZipPipe、Small-tailqwq 的署名链。
