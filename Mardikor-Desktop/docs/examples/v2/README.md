# MDK v2 定稿版工程示例

这些目录是 [v2 规范](<../../MDK Format Specification v2.md>) 的解包示例，可用 Mardikor 0.3.1 的桌面端和 CLI 打包、打开及校验。各工程的 `mimetype` 均为规范规定的精确字节，无结尾换行。

| 目录／文件 | 用途 |
| --- | --- |
| [minimal/](minimal/) | 3 个文件的空工程，缺省为 `default`；可编辑，但没有可出版的正文节点。 |
| [book/](book/) | 9 个文件；3 篇正文、4 次正文展示，包含分组、跨文稿锚点、SVG 封面及 PDF／EPUB 预设。 |
| [comic/](comic/) | 8 个文件。2 篇正文、3 次正文展示，使用 RTL 双页。包含可直接导出的 EPUB 固定版式预设，视口容纳完整图文。 |
| [extension/](extension/) | 4 个文件的扩展声明演示；`org.example.review@1` 是假设能力，JSON 为不透明占位数据，不是批注标准。 |
| [settings.full.toml](settings.full.toml) | 完整设置字段模板；174 个活动字段及 5 个注释中的字体集字段，不属于独立工程。 |

`book` 的正文节点顺序为 `node-intro → node-road → node-home → node-intro-again`；`comic` 为 `node-one → node-two → node-three`。它们通过不同节点重复引用正文，没有复制相同正文文件。漫画第一组为右侧 `node-one`、左侧 `node-two`，最后的 `node-three` 独自在右侧。

两个示例的图片是相同字节的静态 SVG，不依赖外部资源。完整预览／出版需要支持 SVG；仅实现最低 PNG／JPEG 封面支持的出版器不能据此宣称已完整出版书籍示例。PDF 必须解决并嵌入实际使用的字体；EPUB 必须补入本次产物的生成时间。示例不是预先生成的 PDF／EPUB。

在 `Mardikor-Desktop` 安装项目依赖后运行：

```powershell
node scripts/check-v2-examples.mjs
```

脚本检查规范中的文件片段与磁盘示例是否一致、TOML 语法、示例的目录与链接，以及设置模板的字段覆盖；然后在 `.test-artifacts/mdk-v2-examples/` 生成四个 `.mdk` 测试包和 `report.json`，复查物理首两项及解压后字节。它不会改写源示例。

此脚本仅检查受控示例，不能作为任意不可信工程的安全校验器，也不验证 PDF／EPUB 渲染、全部高级样式或完整的外部标准符合性。打包示例应使用该脚本；普通 ZIP 工具的默认条目顺序、压缩方法和名称标志不一定符合 MDK 的附加约束。
