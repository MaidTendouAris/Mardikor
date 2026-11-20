# MDK v2 定稿版工程示例

容器规则修订：2026-11-17。打包后所有条目必须为 STORE，正文和资源也不得使用 DEFLATE；压缩分发交给独立的 `.mdke` 格式。目录中的解包源文件内容不因这一修订改变。

这些目录是 [v2 规范](<../../MDK Format Specification v2.md>) 的解包示例。各工程的 `mimetype` 均为规范规定的精确字节，无结尾换行。原有四个工程可用 Mardikor 0.3.3 的桌面端和 CLI 按 STORE 修订打包及校验；附件示例对应 2026-11-20 修订。

| 目录／文件 | 用途 |
| --- | --- |
| [minimal/](minimal/) | 3 个文件的空工程，缺省为 `default`；可编辑，但没有可出版的正文节点。 |
| [book/](book/) | 9 个文件；3 篇正文、4 次正文展示，包含分组、跨文稿锚点、SVG 封面及 PDF／EPUB 预设。 |
| [comic/](comic/) | 8 个文件。2 篇正文、3 次正文展示，使用 RTL 双页。包含可直接导出的 EPUB 固定版式预设，视口容纳完整图文。 |
| [extension/](extension/) | 4 个文件的扩展声明演示；`org.example.review@1` 是假设能力，JSON 为不透明占位数据，不是批注标准。 |
| [attachments/](attachments/) | 2026-11-20 附件修订示例。嵌套文稿以插图、普通链接和引用式链接使用被动 SVG、文本和无扩展名二进制附件。 |
| [settings.full.toml](settings.full.toml) | 完整设置字段模板；174 个活动字段及 5 个注释中的字体集字段，不属于独立工程。 |

`book` 的正文节点顺序为 `node-intro → node-road → node-home → node-intro-again`；`comic` 为 `node-one → node-two → node-three`。它们通过不同节点重复引用正文，没有复制相同正文文件。漫画第一组为右侧 `node-one`、左侧 `node-two`，最后的 `node-three` 独自在右侧。

两个示例的图片是相同字节的静态 SVG，不依赖外部资源。完整预览／出版需要支持 SVG；仅实现最低 PNG／JPEG 封面支持的出版器不能据此宣称已完整出版书籍示例。PDF 必须解决并嵌入实际使用的字体；EPUB 必须补入本次产物的生成时间。示例不是预先生成的 PDF／EPUB。

在桌面端目录执行示例检查：

```powershell
node scripts/check-v2-examples.mjs
```

脚本检查规范中的文件片段与磁盘示例是否一致、TOML 语法、示例的目录与链接，以及设置模板的字段覆盖。在 `.test-artifacts/mdk-v2-examples/` 生成五个 `.mdk` 测试包和 `report.json`，逐项检查本地头、中央目录的 STORE 方法、大小、CRC 和实际字节。

附件示例另可按主规范 §16.4 核对。打开 `attachments/markdown/field/day.md`，正文中「原始采样记录」和「同一份记录」均指向 `resources/other/run 100%#1`。提取所得的完整十六进制内容应为 `00 ff 4d 44 4b 0d 0a 80`。

此脚本仅检查受控示例，不能作为任意不可信工程的安全校验器，也不验证 PDF／EPUB 渲染、全部高级样式或完整的外部标准符合性。打包工具必须明确将每个条目设为 STORE，并检查本地头、中央目录、大小及 CRC；普通 ZIP 工具的默认压缩或“等级 0 的 DEFLATE”均不能代替 STORE。全 STORE 规则不要求改变 PNG／JPEG 等资源自身的编码。
