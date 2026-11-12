# Mardikor

基于 Electron、TypeScript 7 和 React 的本地 Markdown / MDK 编辑器。

- 源码、可视化、预览与双栏编辑，支持标题大纲和资源拖入。
- MDK 文稿层级、工程文件管理、规范校验及 PDF / EPUB 导出。

- 可视化编辑器通过分页处理大幅优化了性能，但在遇到过大的单个markdown文档时仍会禁用，源码编辑始终可用。

Windows 安装版自动关联 `.mdk`，可选择关联 `.md`；便携版无需安装。

[下载最新版本](<https://github.com/MaidTendouAris/Mardikor/releases/latest>)。安装版默认每日检查更新，下载与安装由用户手动发起。

许可证为 [MIT](LICENSE)。

## 关于MDK文件

`.mdk` 是Mardikor定义的文件格式，其本质为`.zip` 压缩包，文件头部两位十六进制值用于声明文件用途。当前`.mdk` 的定位是工程文件，软件支持将`.mdk`文件导出为PDF/epub。

设计`.mdk` 的最初目的是解决原版markdown文件在内嵌图片等媒体时分发过程繁琐的问题，同时提供一个更直观的方案制作epub电子书。文档目录由contents.toml控制，不依赖文件名，非必要请勿在整体目录内更改资源文件名，可能会导致资源映射问题。

由于本身属于`.zip` 的变种，你可以在`.mdk`内包含任意文件，即使Mardikor不支持预览和编辑。

## 文档

- [使用指南](<docs/USER_GUIDE.md>)
- [命令行指南](<docs/CLI.md>)
- [开发指引](<docs/DEVELOPMENT.md>) · [构建与打包](<docs/BUILDING.md>)
- [更新与发布](<docs/UPDATING.md>) · [许可证说明](<docs/LICENSING.md>)
- [导出配置](<docs/EXPORTING.md>) · [出版字体](<docs/EXPORT_FONT.md>)
- [MDK v1 规范](<docs/MDK%20Format%20Specification%20v1.md>) · [功能核对](<docs/MDK%20Feature%20Audit.md>)
- [迁移记录](<docs/MIGRATION.md>) · [项目规划](<docs/Planning%20Document.md>) · [图标说明](<docs/ICONS.md>)
