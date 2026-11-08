# PDF 与 EPUB 导出

在「校验与导出 → 出版导出」配置、严格预检并导出。需要保存配置时可用「保存并导出」。应用会显示校验、排版、生成与写入阶段，并在发布文件前核对源工程和输出路径的修订。

| 工程          | PDF  | EPUB 3           | MDK 容器交付 |
| ------------- | ---- | ---------------- | ------------ |
| default（00） | 支持 | 不支持           | 保留         |
| book（01）    | 支持 | 可重排或固定版式 | 保留         |
| comic（02）   | 支持 | 固定版式         | 保留         |
| 单 Markdown   | 支持 | 不支持           | 不适用       |

## 配置随工程分发

新增配置在 `settings.toml` 的 `[extensions.mardikor.publication]`，版本为 1，包含 `metadata`、`pdf`、`epub` 三个表。排版继续复用 `appearance`、`colors`、`layout`、`mode.book`、`mode.comic` 和 `preview.render_containers`。旧 v1 读取器可保留扩展并打开基础内容，原规范的 `export.default_target` 继续表示 MDK 交付；规范文件未修改。

| 配置组     | 可控制内容                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 作品信息   | 标题、作者、语言、稳定 URI / UUID、UTC 出版日期、出版者、简介、版权、工程内封面                                                |
| 字体与正文 | 工程内 OTF / TTF、字号、行高、段间距、正文/背景/链接/引用颜色、书籍编号和目录深度、容器显示                                    |
| 页面       | A4 / A5 / Letter 或自定义宽高、四侧边距；界面用 mm，settings 使用 96 dpi 的 CSS px                                             |
| PDF        | 横向、缩放、背景、灰度、无障碍标签、标题书签、封面、目录、连续/另页/右页分页、递增不重叠页码范围、起始页码、页眉页脚文字与字号 |
| EPUB       | 可重排/固定版式、嵌入字体、目录是否加入 spine、封面、翻页方向                                                                  |
| 漫画       | 按 contents 实际条目编排，单双页、LTR/RTL、contain/cover/width；虚拟分组不占页，重复文稿分别导出，奇数末项单独展示             |

页眉页脚仅接受普通单行文字及 `{title}`、`{author}`、`{page}`、`{pages}`，不执行 HTML。页码范围按完整文档的物理页选择；输出保留原页码，总页数表示全文页数。选择缩放时重新计算可用内容宽高；固定页面溢出会报错，`cover` 是用户显式选择的图片裁切方式。

单 Markdown 的配置保存在应用数据目录，不产生 TOML，也不将 Markdown 转换为 MDK；要分发完整排版配置请使用 MDK 工程。

## PDF 的可复现条件

PDF 导出需要保存过的配置、工程内字体、相同字体 SHA-256 和相同渲染器标识。渲染器标识包含出版源码/依赖锁定摘要、Electron/Chromium 版本及平台架构；打印不使用系统打印机、系统默认字体或网络资源。内置 Noto 字体首次保存配置时写入工程，许可证一并保留；自定义字体须允许嵌入/子集且覆盖全部实际输出字符。

生成 PDF 使用固定的 CSS 页面和页边距，页眉页脚与正文由同一 Chromium 字体管线渲染。PDF 创建/修改时间使用保存的 UTC 出版日期，文档 ID 从一致快照生成，不写入当前时钟、用户数据目录或源文件的本机路径。修正 CFF 字体把汉字反向映射为同形部首的问题，保留中文搜索与复制；无法无损区分的同形字符组合会报告并拒绝，避免猜测。

因此应分发同一个 MDK，并在另一台相同平台架构的电脑上使用匹配的应用渲染版本。工程不匹配时会报错；重新保存配置明确采用当前渲染规则和字体摘要。不能把“同名应用版本”或不同操作系统视作渲染器相同，也不承诺不同渲染版本的 PDF 字节一致。

## EPUB 转换的严格检查

转换前检查整个 MDK 的容器、控制文件、全部已知引用，以及转换使用的阅读顺序、UTF-8/XML 字符、元数据、内部文稿/标题锚点、字体、图片签名和解码结果。资源必须是包内静态 PNG、JPEG 或被动纯图形 SVG；动画 PNG、不支持的媒体、附件链接、外部展示资源、查询参数或不存在的锚点会报告路径并拒绝。原始 HTML 按文本输出，EPUB 预检会提示。SVG 文本、样式表、实体和动画不在此转换支持范围。

输出包含 OCF 首项 STORE 的 `mimetype`、container、OPF、导航、完整 XHTML、CSS、实际引用资源和可选字体；再次核对 XML、资源清单、spine、导航、锚点及内部引用后原子发布。导航超链接可使用 HTTP(S)/mailto。阅读内容只包含 contents 编排的文稿和使用的资源；未编排文稿、批注、恢复状态和其他附件继续保留在 MDK 中，不自动转为 EPUB 正文。

comic 固定版式一篇文稿一个展示页，EPUB spine 保持逻辑顺序，由方向和 page-spread 属性描述双页；PDF 按实际条目配对。固定版式字体强制嵌入，正文/表格/代码超出页面时拒绝，要求调整版面或拆分文稿。书籍可重排 EPUB 可不嵌入字体，阅读器可采用自己的字体、字号和分页，因此 EPUB 不承诺跨阅读器版面相同。

## 检查与支持范围

`npm run test:publication` 通过真实 preload/IPC、导出界面、隔离的 Chromium 渲染和文件对话框授权验证 PDF / EPUB；`tests/publication.test.ts` 检查保留扩展、模式限制、不可转换内容、错误锚点、虚拟层级、重复文稿、RTL、过期预检和生成文件损坏。

`python scripts/verify-publication.py` 使用 PDFium 独立渲染实际输出，检查漫画两页均有可见图片、RTL 奇数末项位于右侧，并检查原汉字搜索文本、页码范围与偏移。依赖 pdfplumber、pypdfium2、Pillow；可传入开发测试的 latest.json，默认检查打包程序样例。

出版转换的实现限额为 1,000 个目录项、8 MiB Markdown、单张位图 4,000 万像素、单次渲染 60 秒、输出 256 MiB；沿用 MDK 容器的安全限额。这些是实现限额，不改变 v1 格式容量。失败保留原工程、现有输出和待保存状态。实际生成的书籍、封面/无嵌入字体书籍及漫画样例使用 W3C 官方 EPUBCheck 独立校验；PDF 使用 Poppler 渲染及文本提取检查。

实现参考：[Electron printToPDF](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)、[Chromium CSS 页面边距](https://developer.chrome.com/blog/print-margins)、[EPUB 3.3](https://www.w3.org/TR/epub-33/)、[W3C EPUBCheck](https://www.w3.org/publishing/epubcheck/)。
