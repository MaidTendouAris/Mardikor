# Mardikor

基于 Electron、TypeScript 7 和 React 的本地 Markdown / MDK 编辑器。

- 源码、可视化、预览与双栏编辑，支持标题大纲和资源拖入。
- MDK 文稿层级、工程文件管理、规范校验及 PDF / EPUB 导出。

- 可视化编辑器通过分页处理大幅优化了性能，但在遇到过大的单个markdown文档时仍会禁用，源码编辑始终可用。

Windows 安装版自动关联 `.mdk`，首次安装默认勾选 `.md` 关联，可取消勾选。便携版无需安装。

[下载最新版本](<https://github.com/MaidTendouAris/Mardikor/releases/latest>)。安装版默认每日检查更新，下载与安装由用户手动发起。

许可证为 [MIT](LICENSE)。

## 关于MDK文件

当前桌面端和 CLI 使用 MDK v2。工程采用标准 ZIP 封装，`mdk.toml` 声明格式版本、用途和作品信息，`contents.toml` 分别登记正文和目录节点。同一篇正文可以在目录中出现多次。解包后可直接查看 Markdown、资源和附加文件。

MDK 工程可按 `publication.toml` 中的命名预设发布 PDF 或 EPUB。旧版 MDK 请用对应版本的 Mardikor 打开。

## 文档

- [使用指南](<docs/USER_GUIDE.md>)
- [命令行指南](<docs/CLI.md>)
- [开发指引](<docs/DEVELOPMENT.md>) · [构建与打包](<docs/BUILDING.md>)
- [更新与发布](<docs/UPDATING.md>) · [许可证说明](<docs/LICENSING.md>)
- [导出配置](<docs/EXPORTING.md>) · [出版字体](<docs/EXPORT_FONT.md>)
- [MDK v2 规范](<docs/MDK%20Format%20Specification%20v2.md>) · [v2 设置目录](<docs/MDK%20v2%20Settings%20Reference.md>) · [v2 样例](docs/examples/v2/README.md) · [历史 v1 规范](<docs/MDK%20Format%20Specification%20v1.md>)
- [迁移记录](<docs/MIGRATION.md>) · [项目规划](<docs/Planning%20Document.md>) · [图标说明](<docs/ICONS.md>)
