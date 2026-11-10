export default {
  "文稿显示名称不能为空或包含控制字符。": "A document display name must be non-empty and contain no control characters.",
  "多选": "Multi-select",
  "选择文件 {0}": "Select file {0}",
  "提取文件": "Extract File",
  "选择文件提取的目标目录": "Select a destination for extracted files",
  "此操作仅限 resources 目录。": "This operation is limited to the resources directory.",
  "请选择要导入的资源。": "Select resources to import.",
  "资源导入仅支持普通文件和目录。": "Resource import accepts regular files and folders.",
  "导入期间源文件发生变化，请重试。": "A source file changed during import. Try again.",
  "请选择要提取的资源。": "Select resources to extract.",
  "所选目录没有可提取的资源。": "The selected folder has no resources to extract.",
  "无法安全更新 {0} 中的资源引用，已保留原路径。": "The resource references in {0} could not be updated safely. The original path was kept.",
  "资源分类目录由 Mardikor 管理。": "Mardikor manages the standard resource folders.",
  "内置字体及其许可证由 Mardikor 管理。": "Mardikor manages the bundled font and its license.",
  "导入资源文件": "Import Resource Files",
  "导入资源文件夹": "Import Resource Folders",
  "提取资源文件": "Extract Resource File",
  "提取资源目录": "Extract Resource Folder",
  "选择资源导出的目标目录": "Select a destination for extracted resources",
  "选择资源 {0}": "Select resource {0}",
  "将同步可识别的 Markdown、工程字体和封面引用。未知扩展或附件内部的引用需手动确认。": "Recognized Markdown, project font, and cover references will be updated. Check references in unknown extensions or attachments manually.",
  "已导入 {0} 项资源至 {1}。": "Imported {0} resource entries into {1}.",
  "已提取 {0} 个文件至 {1}。": "Extracted {0} files to {1}.",
  "在 resources 新建文件夹": "New Folder in resources",
  "批量提取资源": "Extract Multiple Resources",
  "提取所选项（{0}）": "Extract Selected ({0})",
  "提取目标文件已存在，请选择其他名称。": "The destination file already exists. Choose a different name.",
  "显示分页标记": "Show page markers",
  "在连续滚动的正文旁标出每页起点。": "Mark the start of each page beside the continuous document.",
  "编辑第 {0} 页": "Edit page {0}",
  "；": "; ",
  "    代码行一\n    代码行二":
    "    First line of code\n    Second line of code",
  " · {0}{1} 字符": " · {0}{1} characters",
  " · 新版本：{0}": " · New version: {0}",
  " · 正在处理": " · Working",
  " 个资源。": " resource(s).",
  " 包含无效的 Unicode 字符。": " contains invalid Unicode characters.",
  " 含禁止字符或过长。": " contains prohibited characters or is too long.",
  " 必须为表。": " must be a table.",
  " 标题": " Heading",
  " 的类型或取值无效。": " has an invalid type or value.",
  " 级标题": " Heading Level",
  "![图片说明](../resources/image/image.png)":
    "![description](../resources/image/image.png)",
  '![图片说明][image-id]\n\n[image-id]: ../resources/image/image.png "图片标题"':
    '![description][image-id]\n\n[image-id]: ../resources/image/image.png "Image title"',
  "**文字**": "**text**",
  "*文字*": "*text*",
  "- [ ] 待办\n- [x] 已完成": "- [ ] To do\n- [x] Done",
  "- 项目一\n- 项目二": "- First item\n- Second item",
  "-草稿": "-draft",
  "00 通用": "00 General",
  "01 书籍": "01 Book",
  "02 漫画": "02 Comic",
  "1. 项目一\n2. 项目二": "1. First item\n2. Second item",
  '<nav class="preview-toc" aria-label="文稿目录"><strong>目录</strong>{0}</nav>':
    '<nav class="preview-toc" aria-label="Document contents"><strong>Contents</strong>{0}</nav>',
  "> 引用内容": "> Quoted text",
  "CLI 信息": "CLI Info",
  "CLI 工程信息": "CLI Project Info",
  "EPUB 3 电子书": "EPUB 3 Ebook",
  "EPUB 3 转换执行前严格检查容器、控制文件、阅读顺序、链接锚点、字体和资源兼容性。原始 HTML 按文本显示。外部媒体、附件链接和不兼容图片须先处理；生成后再次检查 XHTML、manifest、spine 和导航。":
    "EPUB 3 conversion checks the package, control files, reading order, anchors, fonts, and resources first. Raw HTML is displayed as text. Resolve external media, attachment links, and incompatible images before export. The generated XHTML, manifest, spine, and navigation are checked again.",
  "EPUB XHTML 根元素或标题无效。": "Invalid EPUB XHTML root element or title.",
  "EPUB manifest 的 ID、资源路径或 MIME 无效。":
    "Invalid ID, resource path, or media type in the EPUB manifest.",
  "EPUB mimetype 必须是无扩展字段的首个未压缩项。":
    "The EPUB mimetype must be the first entry, stored without compression or extra fields.",
  "EPUB rootfile 无效。": "Invalid EPUB rootfile.",
  "EPUB 不允许事件属性。": "Event handler attributes are not allowed in EPUB.",
  "EPUB 不允许脚本、嵌入活动内容或表单。":
    "EPUB scripts, active embedded content, and forms are not allowed.",
  "EPUB 仅支持 book / comic；default 与单 Markdown 仅支持 PDF。":
    "EPUB is available for book and comic projects. General and single Markdown projects export to PDF only.",
  "EPUB 包含未声明的出版资源。":
    "The EPUB contains undeclared publication resources.",
  "EPUB 含不安全或外部展示引用。":
    "The EPUB has an unsafe or external display reference.",
  "EPUB 容器存在重复文件或错误 mimetype。":
    "The EPUB has duplicate files or an invalid mimetype.",
  "EPUB 嵌入字体（固定版式强制嵌入）":
    "Embed EPUB Font (Required for Fixed Layout)",
  "EPUB 引用未在 manifest 声明：":
    "EPUB reference not declared in the manifest: ",
  "EPUB 必需出版元数据不完整。": "Required EPUB metadata is incomplete.",
  "EPUB 必须且只能有一份导航文档。":
    "An EPUB must have exactly one navigation document.",
  "EPUB 插入封面": "Include EPUB Cover",
  "EPUB 文档存在重复锚点。": "The EPUB document contains duplicate anchors.",
  "EPUB 未嵌入字体，阅读器可能使用自己的字体和排版。":
    "The EPUB has no embedded font. Readers may use their own fonts and layout.",
  "EPUB 版式": "EPUB Layout",
  "EPUB 电子书": "EPUB Ebook",
  "EPUB 的 MathML 内容与 manifest 声明不一致：":
    "EPUB MathML content does not match its manifest declaration: ",
  "EPUB 翻页方向": "EPUB Page Direction",
  "EPUB 转换选项": "EPUB Conversion Options",
  "EPUB 配置保存在 settings.toml，内置字体的子集直接写入电子书。":
    "EPUB settings are saved in settings.toml. A subset of the built-in font is embedded in the ebook.",
  "EPUB 锚点不存在：": "EPUB anchor not found: ",
  "EPUB 阅读顺序无效。": "Invalid EPUB reading order.",
  "GFM 表格": "GFM Table",
  "GPLv3 许可证全文": "Full GPLv3 License",
  "GitHub 仓库": "GitHub Repository",
  "IPC 参数数量无效。": "Invalid number of IPC arguments.",
  "IPC 参数类型或大小无效。": "Invalid IPC argument type or size.",
  "IPC 命令无效。": "Invalid IPC command.",
  "IPC 页面来源无效。": "Invalid IPC page origin.",
  "JPEG 尺寸段损坏。": "Corrupt JPEG dimensions segment.",
  "JPEG 数据被截断。": "Truncated JPEG data.",
  "JPEG 标记损坏。": "Corrupt JPEG marker.",
  "MDK 交付": "MDK Delivery",
  "MDK 容器校验详情": "MDK Validation Details",
  "MDK 工程": "MDK Project",
  "MDK 工程容器交付": "Deliver an MDK Package",
  "MDK 文件头不完整。": "Incomplete MDK header.",
  "MDK 默认设置": "Default MDK Settings",
  "Mardikor 启动失败": "Mardikor Could Not Start",
  "Mardikor 工程": "Mardikor Projects",
  "Markdown 代码块": "Markdown Code Block",
  "Markdown 内容无效或超过 64 MiB。":
    "The Markdown content is invalid or exceeds 64 MiB.",
  "Markdown 加粗": "Markdown Bold",
  "Markdown 处理失败。": "Markdown processing failed.",
  "Markdown 文件": "Markdown Files",
  "Markdown 文件超过 64 MiB。": "The Markdown file exceeds 64 MiB.",
  "Markdown 斜体": "Markdown Italic",
  "Markdown 标题大纲": "Markdown Outline",
  "Markdown 编辑器尚未就绪。": "The Markdown editor is not ready.",
  "Markdown 表格": "Markdown Table",
  "Markdown 语法": "Markdown Syntax",
  "Markdown 语法类型": "Markdown Syntax Type",
  "Markdown 链接": "Markdown Link",
  "Noto Sans CJK SC（应用内置）": "Noto Sans CJK SC (Built-in)",
  "PDF CMap 数组不完整。": "The PDF CMap array is incomplete.",
  "PDF CMap 范围超出支持范围。":
    "The PDF CMap range exceeds the supported range.",
  "PDF 与 EPUB 导出": "PDF & EPUB Export",
  "PDF 使用工程内字体并校验全部字形，不回退到系统字体。自定义字体须允许分发与嵌入。字号和行距等通用选项同时用于工程排版。":
    "PDF checks glyph coverage against the pinned export font. Custom fonts must allow redistribution and embedding. Common font and spacing settings also apply to the project layout.",
  "PDF 插入封面页": "Include PDF Cover Page",
  "PDF 插入目录": "Include PDF Contents",
  "PDF 文档": "PDF Document",
  "PDF 横向纸张": "Landscape PDF",
  "PDF 纸张 / EPUB 固定画布": "PDF Paper / EPUB Fixed Canvas",
  "PDF 纸张尺寸、缩放、页码或页眉字号超出支持范围。":
    "The PDF paper size, scale, page number, or header font size is out of range.",
  "PDF 缩放": "PDF Scale",
  "PDF 选项": "PDF Options",
  "PDF 配置和字体校验值随 MDK 分发，使用匹配的应用版本复现导出。":
    "PDF configuration and font hashes travel with the MDK. Use a matching app version to reproduce the export.",
  "PDF 需要工程内的字体资源。请选择内置 Noto 字体，或导入字体后选择其 resources/font 路径；不使用本机字体替代。":
    "Choose the built-in Noto font or select an imported font under resources/font. The PDF exporter does not substitute system fonts.",
  "PDF 页码范围": "PDF Page Ranges",
  "PNG 数据被截断。": "Truncated PNG data.",
  "SVG 含不支持的元素或命名空间：": "Unsupported SVG element or namespace: ",
  "SVG 含文本、样式、动画或实体，不能保证便携排版。请转换为 PNG 或路径图形。":
    "The SVG contains text, styles, animation, or entities that cannot guarantee portable layout. Convert it to PNG or path graphics.",
  "SVG 含活动内容或外部引用，不能插入或预览。":
    "The SVG contains active content or external references and cannot be inserted or previewed.",
  "SVG 含活动内容或外部引用，仅提供源码或文件信息。":
    "The SVG contains active content or external references. Only source or file information is available.",
  "Setext 标题": "Setext Heading",
  "ZIP 校验失败：": "ZIP validation failed: ",
  "ZIP 路径重复或文件目录同名：{0}":
    "Duplicate ZIP path or a file and directory share a name: {0}",
  "[链接文字](https://example.com)": "[link text](https://example.com)",
  '[链接文字][link-id]\n\n[link-id]: https://example.com "链接标题"':
    '[link text][link-id]\n\n[link-id]: https://example.com "Link title"',
  "\\*文字\\*": "\\*text\\*",
  "```text\n代码\n```": "```text\ncode\n```",
  "`代码`": "`code`",
  "contents.toml 只控制目录；{0} 应写入 settings.toml。":
    "contents.toml controls only the contents. Write {0} to settings.toml.",
  "contents.toml 的 schema_version 必须为整数 1；更高版本需要升级应用。":
    "schema_version in contents.toml must be the integer 1. Higher versions require an app update.",
  "contents.toml 超过 64 MiB。": "contents.toml exceeds 64 MiB.",
  "data descriptor 与中央目录不一致。":
    "The data descriptor differs from the central directory.",
  "entries 必须为数组。": "entries must be an array.",
  "https://… 或工程内相对路径": "https://… or a project-relative path",
  "markdown/ 正文仅支持 .md 文件。":
    "The markdown/ folder only supports .md documents.",
  "mimetype 字节内容无效。": "Invalid mimetype bytes.",
  "mimetype 必须为物理首项 STORE，且不能使用 data descriptor。":
    "mimetype must be the first physical entry, stored without compression or a data descriptor.",
  "mimetype 必须保持规范中的固定值。":
    "mimetype must retain the value defined by the format.",
  "mode 必须是两位 ASCII 十六进制字符。":
    "mode must contain two ASCII hexadecimal digits.",
  "portable 交付需要包内媒体：":
    "Portable delivery requires media inside the project: ",
  "settings.toml 的 schema_version 必须为整数 1；整份设置临时使用默认值，原文件保持不变。":
    "schema_version in settings.toml must be the integer 1. Defaults apply temporarily and the original file is kept.",
  "settings.toml 缺省，按规范默认值解释，不写回源文件。":
    "settings.toml is absent. Format defaults apply and the source file is left intact.",
  "v1 不支持 4 GiB 及以上资源。":
    "Version 1 does not support resources of 4 GiB or more.",
  "v1 不支持 ZIP64。": "Version 1 does not support ZIP64.",
  "v1 不支持分卷 ZIP。": "Version 1 does not support split ZIP archives.",
  "v1 不支持加密 ZIP。": "Version 1 does not support encrypted ZIP archives.",
  "v1 不支持压缩方法 {0}。":
    "Version 1 does not support compression method {0}.",
  "v1 仅交付 MDK，最终检查始终执行。默认保留批注和未知 meta；剔除持久数据时确认本次范围。无法确保引用同步时保留源文件名。":
    "Version 1 delivers MDK and always runs final checks. Annotations and unknown metadata are kept by default. Confirm any exclusions and keep original filenames when references cannot be updated safely.",
  "{0} 个错误 · {1} 个警告 · {2} 条提示":
    "Errors: {0} · Warnings: {1} · Notes: {2}",
  "{0} 已同时分配给「{1}」和「{2}」。": "{0} is assigned to both {1} and {2}.",
  "{0} 已导出{1}。": "{0} exported{1}.",
  "{0} 已用于编辑器内置操作。": "{0} is used by a built-in editor action.",
  "{0} 必须为表；该表临时使用默认值。":
    "{0} must be a table. Defaults apply temporarily to that table.",
  "{0} 有未保存的更改。": "{0} has unsaved changes.",
  "{0} 的类型或取值无效；临时使用 {1}。":
    "{0} has an invalid type or value. Using {1} temporarily.",
  "{0}（无文稿）": "{0} (no document)",
  "| 标题一 | 标题二 |\n| --- | --- |\n| 内容 | 内容 |":
    "| First heading | Second heading |\n| --- | --- |\n| Content | Content |",
  "~~文字~~": "~~text~~",
  "。删除后无法撤销；子文稿将提升一级。被引用资源删除后会报告缺失，严格交付前须处理。":
    ". Deletion cannot be undone. Child documents move up one level. Missing referenced resources must be resolved before strict delivery.",
  "。支持图片、音视频和 PDF。":
    ". Supported formats include images, audio, video, and PDF.",
  "。请在整体目录中恢复同名文件，或显式删除目录项；不会自动创建空白正文。":
    ". Restore it in Project Files or remove its contents entry. A blank file will not be created automatically.",
  "。请换用覆盖这些字符的字体，不能回退到本机字体。":
    ". Choose a font that covers these characters. System fonts are not substituted.",
  "一次拖入的文件总量不能超过 64 MiB。":
    "Dropped files must total at most 64 MiB.",
  "一次最多插入 16 个文件。": "Insert at most 16 files at a time.",
  上一图片: "Previous Image",
  "上一行  \n下一行": "First line  \nSecond line",
  上一页: "Previous Page",
  上方插入行: "Insert Row Above",
  "上次检查：": "Last checked: ",
  上移: "Move Up",
  "上边距 / px": "Top Margin / px",
  "上边距（mm）": "Top Margin (mm)",
  下一图片: "Next Image",
  下一页: "Next Page",
  下方插入行: "Insert Row Below",
  下移: "Move Down",
  下载更新: "Download Update",
  "下边距 / px": "Bottom Margin / px",
  "下边距（mm）": "Bottom Margin (mm)",
  "不受信任的 IPC 来源。": "Untrusted IPC origin.",
  "不安全的工程内部路径：{0}": "Unsafe internal project path: {0}",
  "不支持分卷条目。": "Entries spread across disks are unsupported.",
  "不支持可能包含链接的 UNIX 扩展。":
    "UNIX extensions that may contain links are unsupported.",
  "不支持字体集合。": "Font collections are unsupported.",
  "不支持插入此类型：": "Unsupported file type: ",
  "不支持此剪贴板图片格式。": "Unsupported clipboard image format.",
  "不支持此版本的导出配置，请升级应用。":
    "This export configuration version is unsupported. Update the app.",
  "不支持的交付偏好已保留；当前仅支持 portable MDK。":
    "Unsupported delivery preferences are kept. Only portable MDK is supported.",
  "不支持的出版格式。": "Unsupported publication format.",
  "不支持跨目录链接资源。": "Linked resources cannot cross directories.",
  "不能修改单 Markdown 工程以外的文件。":
    "Files outside the single Markdown project cannot be modified.",
  "不能删除关键工程文件。": "Critical project files cannot be deleted.",
  "不能将文稿移入自身或其子目录。":
    "A document cannot be moved into itself or one of its descendants.",
  "不能将目录移入自身。": "A folder cannot be moved into itself.",
  "不能插入目录：": "Cannot insert a folder: ",
  "不能重命名关键工程文件。": "Critical project files cannot be renamed.",
  不设置封面: "No Cover",
  不透明附件: "Opaque Attachment",
  "丢弃本地修改并重新加载？": "Discard local changes and reload?",
  严格预检: "Strict Preflight",
  严格预检未通过: "Strict preflight failed",
  严格预检通过: "Strict preflight passed",
  个警告: " warning(s)",
  "个错误 ·": " error(s) ·",
  "中央目录偏移不是以 payload 起点为基准，或使用不支持的 ZIP 扩展。":
    "The central directory offset is not relative to the payload, or an unsupported ZIP extension is in use.",
  "中央目录大小或条目计数不一致。":
    "The central directory size or entry count is inconsistent.",
  "中央目录记录损坏。": "Corrupt central directory record.",
  主导航: "Main Navigation",
  书籍工程: "Book Project",
  书籍模式: "Book Mode",
  书籍章节编号: "Book Chapter Numbering",
  "二进制文件不能作为源码打开。": "Binary files cannot be opened as source.",
  "二进制资源不能作为源码打开。":
    "Binary resources cannot be opened as source.",
  "二进制附件，仅显示文件信息。":
    "Binary attachment. Only file information is available.",
  交付: "Deliver",
  "交付副本将剔除以下持久或未知数据，源工程仍保留：\n":
    "The following persistent or unknown metadata will be omitted from the exported copy. The original project keeps it:\n",
  "交付必须生成独立副本，请选择其他文件名。":
    "Delivery must create a separate copy. Choose another filename.",
  "交付预检后工程已变化，请重新预检。":
    "The project changed after delivery preflight. Run preflight again.",
  "交付预检后源工程已变化，请重新预检。":
    "The source project changed after delivery preflight. Run preflight again.",
  "仅允许普通文件和目录，不允许链接或设备。":
    "Only regular files and directories are allowed. Links and devices are unsupported.",
  仅在可视化正文内生效: "Visual editor only",
  "仅支持本地文件链接。": "Only local file links are supported.",
  从右到左: "Right to Left",
  "从左侧选择文稿或工程文件。":
    "Choose a document or project file on the left.",
  从左到右: "Left to Right",
  从文件导入: "Import from File",
  "从文件管理器打开 .md/.mdk 或启动时直接打开文件时使用，不影响新建工程。可视化不支持的内容将以源码打开。":
    "Applies to .md and .mdk files opened from the file manager or at startup. New projects are unaffected. Content unsupported by the visual editor opens as source.",
  代码: "Code",
  "代码、表格或公式超出正文宽度":
    "Code, tables, or formulas exceed the content width",
  代码内容: "Code Content",
  代码块: "Code Block",
  代码语言: "Code Language",
  "代码语言不能包含换行或反引号。":
    "The code language cannot contain line breaks or backticks.",
  任务列表: "Task List",
  作品信息与封面: "Publication Metadata & Cover",
  作品标题: "Title",
  "作品标题和有效的 BCP 47 语言标记为必填项。":
    "A title and a valid BCP 47 language tag are required.",
  作品简介: "Description",
  作者: "Author",
  "便携版及当前运行环境请在发布页下载对应版本。":
    "Download the appropriate build from the release page for portable or unsupported environments.",
  保存: "Save",
  保存偏好: "Save Preferences",
  保存导出配置至工程: "Save Export Settings to Project",
  保存工程: "Save Project",
  保存并关闭: "Save and Close",
  保存并导出: "Save and Export",
  保存并拆分: "Save and Split",
  保存并更新: "Save and Update",
  保存并预检: "Save and Preflight",
  保存快捷键: "Save Shortcuts",
  保存本机导出配置: "Save Local Export Settings",
  保存源码: "Save Source",
  保存设置: "Save Settings",
  保存配置时记录: "Recorded when settings are saved",
  保存配置时记录当前版本:
    "Current renderer is recorded when settings are saved",
  保存间隔: "Save Interval",
  保留已识别的编辑器状态: "Keep Recognized Editor State",
  "保留持久及未知 meta 数据": "Keep Persistent and Unknown Metadata",
  保留文稿文件名: "Keep Document Filenames",
  "保留：": "Included: ",
  "修改后保存时将转为 UTF-8。":
    "The file will be saved as UTF-8 after editing.",
  修改日期: "Last Modified",
  修订号: "Revision",
  "偏好设置无效。": "Invalid preferences.",
  允许覆盖导出文件: "Allow Overwriting Exports",
  全选: "Select All",
  公式字体未加载: "The math fonts could not be loaded",
  "公式无法排版：": "Could not typeset formula: ",
  "公式超过出版限额（单个 4000 字符，合计 5000 个）。":
    "The formula limit is 4,000 characters per formula and 5,000 formulas per publication.",
  "关于 Mardikor": "About Mardikor",
  "关键工程文件，保存前执行格式校验。":
    "This critical project file is validated before saving.",
  关闭: "Close ",
  "关闭后，未保存的正文、源码或目录更改会丢失。":
    "Closing this window discards unsaved document, source, or contents changes.",
  关闭对话框: "Close Dialog",
  关闭提示: "Dismiss Notification",
  关闭目录菜单: "Close Tree Menu",
  关闭窗口: "Close Window",
  其他: "Other",
  兼容模式: "Compatibility Mode",
  "内置字体的分发许可证缺失或被修改，请检查后重新保存导出配置。":
    "The built-in font license is missing or modified. Check it and save the export settings again.",
  "内置字体的分发许可证缺失，请重新保存导出配置。":
    "The bundled font license is missing. Save the export settings again.",
  "内置导出字体的完整性检查未通过。":
    "The built-in export font failed its integrity check.",
  "内部引用不能带查询参数。":
    "Internal references cannot contain a query string.",
  "内部超链接指向未编排文稿或附件，无法在出版物中保留：":
    "An internal link targets a document or attachment outside the reading order: ",
  减少列表层级: "Decrease List Indent",
  减少层级: "Outdent",
  "出版任务意外结束：": "Publication task exited unexpectedly: ",
  出版任务进度: "Publication Progress",
  出版字体无法解码或加载: "Could not decode or load the publication font",
  出版导出: "Publication Export",
  "出版导出支持独立 OTF / TTF 字体，不支持字体集合或压缩字体。":
    "Publication export supports standalone OTF and TTF fonts. Collections and compressed fonts are unsupported.",
  出版导出格式: "Publication Format",
  "出版日期须为有效的 UTC 时间，例如 2026-11-04T00:00:00Z。":
    "The publication date must be a valid UTC timestamp, e.g. 2026-11-04T00:00:00Z.",
  "出版日期（UTC）": "Publication Date (UTC)",
  "出版格式无效。": "Invalid publication format.",
  "出版渲染器版本清单损坏，请重新安装应用。":
    "The publication renderer manifest is damaged. Reinstall the app.",
  "出版渲染超过 5 分钟，已终止，未发布文件。":
    "Publication rendering exceeded five minutes and was stopped. No file was published.",
  出版物标识: "Publication Identifier",
  "出版物标识须为 URI，例如 urn:uuid:… 或 urn:isbn:…。":
    "The publication identifier must be a URI, for example urn:uuid:… or urn:isbn:….",
  出版者: "Publisher",
  出版转换: "Publication Conversion",
  "出版转换当前支持 PNG、JPEG 和纯图形 SVG；请先转换其他媒体，不能静默丢弃。":
    "Conversion supports PNG, JPEG, and graphic-only SVG. Convert other media first.",
  "出版转换最多支持 1,000 个目录项、8 MiB Markdown 正文。":
    "Publication conversion supports at most 1,000 contents entries and 8 MiB of Markdown text.",
  出版转换校验结果: "Publication Validation Results",
  分隔线: "Horizontal Rule",
  切换到右栏: "Focus Right Group",
  切换到左栏: "Focus Left Group",
  切换到源码: "Switch to Source",
  切换源码与预览分栏: "Toggle Split Source and Preview",
  列对齐: "Column Alignment",
  列数: "Columns",
  列表: "List",
  创建: "Create",
  创建文稿: "Create Document",
  创建新工程: "Create Project",
  删除: "Delete",
  删除当前列: "Delete Current Column",
  删除当前行: "Delete Current Row",
  "删除文件或目录？": "Delete this file or folder?",
  删除文稿: "Delete Document",
  "删除文稿？": "Delete this document?",
  删除线: "Strikethrough",
  删除表格: "Delete Table",
  "剔除：": "Excluded: ",
  剪切: "Cut",
  "剪贴板图片.": "Clipboard Image.",
  "剪贴板图片为空或超过 16 MiB。":
    "The clipboard image is empty or exceeds 16 MiB.",
  "剪贴板图片超过 16 MiB。": "The clipboard image exceeds 16 MiB.",
  "副本须使用 .mdk 扩展名。": "Use the .mdk extension for the copy.",
  加入文稿目录: "Add to Contents",
  加粗: "Bold",
  "动画 PNG 不能保证固定帧导出，请转换为静态 PNG 或 JPEG。":
    "Animated PNGs cannot guarantee a fixed frame on export. Convert to static PNG or JPEG.",
  "包内 .mdk-mode 与解包标记冲突，请在虚拟文件管理器中处理。":
    "The internal .mdk-mode file conflicts with the unpack marker. Resolve it in the project explorer.",
  "单 Markdown 仅导出 PDF；配置保存在本机，不产生 settings.toml。":
    "Single Markdown projects export to PDF. Settings are stored locally outside settings.toml.",
  "单 Markdown 工程": "Single Markdown Project",
  "单 Markdown 工程不支持文稿编排或工程文件管理。":
    "Single Markdown projects do not support project contents or file management.",
  "单 Markdown 工程只能保存当前文件。":
    "Single Markdown projects can save the current file only.",
  "单 Markdown 工程只能修改当前文件。":
    "Single Markdown projects can modify the current file only.",
  "单 Markdown 工程没有 TOML 设置或文稿编排。":
    "Single Markdown projects have no TOML settings or contents structure.",
  "单 Markdown 工程没有 settings.toml。":
    "Single Markdown projects have no settings.toml.",
  "单 Markdown 工程请使用 .md 扩展名。":
    "Use the .md extension for a single Markdown project.",
  "单 Markdown 工程须使用 .md 扩展名。":
    "Use the .md extension for a single Markdown project.",
  "单 Markdown 文件": "Single Markdown File",
  "单 Markdown 模式仅编辑当前 .md 文件。":
    "Single Markdown mode edits the current .md file only.",
  单页: "Single Page",
  "原始 HTML 将以文本显示，与 Markdown 预览一致。":
    "Raw HTML will be shown as text, as in Markdown preview.",
  双击文件时打开的视图: "View When Opening Files",
  双页: "Double Page",
  发现应用更新: "Update Available",
  "发现新版本 {0}": "Version {0} is available",
  "发现新版本 {0}，请手动下载。": "Version {0} is available for download.",
  取消: "Cancel",
  取消排版: "Cancel Layout",
  取消更新: "Cancel Update",
  "取消绑定{0}": "Clear binding for {0}",
  另存草稿副本: "Save Draft Copy",
  "只能写入有效的 UTF-8 文本：": "Only valid UTF-8 text can be written: ",
  "只能创建 UTF-8 纯文本文件。": "Only UTF-8 text files can be created.",
  "只能向 Markdown 文稿插入资源。":
    "Resources can only be inserted into Markdown documents.",
  "只能将 markdown/ 下的 .md 文稿加入目录。":
    "Only .md documents under markdown/ can be added to the contents.",
  "可在应用设置中查看并手动下载更新。":
    "Open Settings to view and download the update.",
  可视化: "Visual",
  "可视化编辑和预览共用此设置。实际页长会按 Markdown 块边界调整。":
    "Visual editing and preview share this setting. Actual pages break at Markdown block boundaries.",
  "可重排版式（书籍）": "Reflowable Layout (Book)",
  右侧插入列: "Insert Column Right",
  右对齐: "Align Right",
  右栏: "Right",
  "右边距 / px": "Right Margin / px",
  "右边距（mm）": "Right Margin (mm)",
  "同一文件不能在一次快照中重复提交。":
    "A snapshot cannot contain the same file twice.",
  "名称 / 路径": "Name / Path",
  "名称无法在 Windows 上安全表示：":
    "The name cannot be represented safely on Windows: ",
  "后台出版任务超过 5 分钟，已终止。":
    "The background publication task exceeded five minutes and was stopped.",
  向右拆分编辑器: "Split Editor Right",
  启用按标题拆分: "Enable Splitting by Heading",
  命令行使用指南: "Command-Line Guide",
  命令行指南全文: "Full Command-Line Guide",
  "固定字体将不同的源字符映射到同一 CJK 字形，无法保证 PDF 搜索文本无损；请换用能区分这些字符的字体。":
    "The pinned font maps different source characters to the same CJK glyph. Choose a font that distinguishes them to preserve searchable PDF text.",
  "固定字体缺少字形：": "The pinned font is missing glyphs: ",
  "固定渲染版本：": "Pinned renderer: ",
  固定版式: "Fixed Layout",
  "固定版式（漫画）": "Fixed Layout (Comic)",
  图片: "Images",
  图片地址: "Image URL",
  "图片尺寸无效或超过四千万像素，未进行解码。":
    "Image dimensions are invalid or exceed 40 million pixels. Decoding was skipped.",
  图片引用: "Image Reference",
  "图片引用不能带片段或查询参数。":
    "Image references cannot contain a fragment or query string.",
  图片无法解码或超过四千万像素:
    "Could not decode an image, or it exceeds 40 million pixels",
  "图片缺少替代文字，建议补充后再分发。":
    "The image has no alternative text. Add it before distribution.",
  图片说明: "Image Description",
  图片适应方式: "Image Fit",
  在旁侧打开: "Open to the Side",
  块级公式: "Display Formula",
  填充: "Cover",
  填充裁切: "Cover and Crop",
  增加列表层级: "Increase List Indent",
  增加层级: "Indent",
  复制: "Copy",
  "复制 JSON": "Copy JSON",
  "复制为 Markdown": "Copy as Markdown",
  "复制内容无效或过大。": "Copied content is invalid or too large.",
  "复制读取命令（PowerShell）": "Copy Read Command (PowerShell)",
  外观: "Appearance",
  大小: "Size",
  字体: "Fonts",
  "字体 SHA-256 无效。": "Invalid font SHA-256.",
  "字体 SHA-256：": "Font SHA-256: ",
  "字体内容与保存的摘要不一致，请检查资源后重新保存导出配置。":
    "The font contents do not match the saved hash. Check the resource and save the export settings again.",
  字体建议: "Font Suggestions",
  "字体的嵌入许可或子集限制不允许此导出，请换用可嵌入的字体。":
    "The font license or subsetting restrictions prohibit this export. Choose an embeddable font.",
  "字体集合不能用于固定导出。":
    "Font collections cannot be used for pinned exports.",
  字号: "Font Size",
  字节: " bytes",
  安装并重启: "Install and Restart",
  安装更新前处理未保存内容: "Unsaved Changes Before Updating",
  "安装更新将关闭所有 Mardikor 窗口。":
    "Installing the update will close all Mardikor windows.",
  "安装未开始：{0}": "Installation did not start: {0}",
  完整显示: "Contain",
  "实际大小或 CRC 不一致：{0}": "Actual size or CRC mismatch: {0}",
  宽度适应: "Fit Width",
  对比当前文稿: "Compare Current Document",
  "对比磁盘与本地 · ": "Compare Disk and Local Versions · ",
  导入本地资源: "Import Local Resource",
  导入资源: "Import Resource",
  导出: "Export",
  "导出 .mdk": "Export .mdk",
  导出字体: "Export Font",
  "导出结果超过 256 MiB，未写入文件。":
    "The export exceeds 256 MiB and was not written.",
  "导出配置已保存在本机，Markdown 原文件保持不变。":
    "Export settings saved locally. The Markdown file was left intact.",
  "导出配置已保存至工程。": "Export settings saved to the project.",
  导航: "Navigation",
  封面: "Cover",
  封面资源: "Cover Resource",
  "将保留稳定 ID。造成已知断链时保留原路径并拒绝操作；未知扩展可能按路径关联内容，请先确认其依赖或保留原路径。":
    "Stable IDs are preserved. The operation stops if it would break a known link. Check dependencies from unknown extensions before renaming.",
  将导航目录加入阅读顺序: "Include Contents in the Reading Order",
  "将按最浅层标题拆成 {0} 篇文稿，插入当前文稿之后。首篇保留原文件和 ID，子目录保持原位；正文、换行和相对资源路径保持原样。":
    "Split at the shallowest headings into {0} documents. Insert the new documents after this one. The first keeps its file and ID. Child entries, text, line endings, and relative resource paths are preserved.",
  尚有未保存的更改: "Unsaved Changes",
  "尚未检查更新。": "No update check yet.",
  居中: "Center",
  展开: "Expand",
  展开导航: "Expand Navigation",
  "展示资源必须在工程内，转换不访问网络。":
    "Display resources must be inside the project. Conversion does not access the network.",
  工作区加载失败: "Could not load the workspace",
  工程: "Projects",
  "工程 mode": "Project Mode",
  "工程.mdk": "Project.mdk",
  "工程、资源或配置在预检后已变化，请重新严格校验。":
    "The project, resources, or settings changed after preflight. Run strict validation again.",
  "工程中没有文件：{0}": "File not found in the project: {0}",
  工程图片: "Project Images",
  工程容器: "Project Package",
  "工程导出设置已变化，请重新读取配置后再保存。":
    "The export settings changed on disk. Reload them before saving.",
  "工程已保存。": "Project saved.",
  "正在保存…": "Saving…",
  已保存: "Saved",
  "重命名 MDK 工程": "Rename MDK project",
  "修改当前文件夹内的工程文件名。": "Rename the project file in its current folder.",
  "工程名称无效。": "Invalid project name.",
  "同名文件已存在，请使用其他名称。": "That name is already in use. Enter another name.",
  "请先关闭其他打开此工程的窗口。": "Close any other windows with this project open first.",
  "工程已创建。": "Project created.",
  "工程已变化，请重新读取导出配置。":
    "The project changed. Reload the export configuration.",
  "工程已导出。": "Project exported.",
  "工程已解包。": "Project unpacked.",
  工程文件: "Project Files",
  工程文件管理器: "Project Explorer",
  工程有: "This project has ",
  工程校验通过: "Project Validation Passed",
  工程模式: "Project Mode",
  "工程正在写入，请稍后重试。若进程已退出，可用 mardikor unlock 检查遗留锁：":
    "The project is being written. Try again later. If the writer exited, use mardikor unlock to check for a stale lock: ",
  "工程版本已变化，请重新拖入；原文和资源未修改。":
    "The project revision changed. Drop the files again. The original text and resources are intact.",
  "工程版本已变化，请重新插入。":
    "The project revision has changed. Insert the resources again.",
  工程类型: "Project Type",
  工程设置: "Project Settings",
  "工程设置已保存。": "Project settings saved.",
  "工程超过大小限制。": "The project exceeds the size limit.",
  工程路径: "Project Path",
  左侧插入列: "Insert Column Left",
  "左右边距之和必须小于页宽；页宽与左右边距临时使用 720 / 32 / 32，其他字段保持有效值。":
    "The combined horizontal margins must be smaller than the page width. Using 720 / 32 / 32 for the width and margins temporarily.",
  左对齐: "Align Left",
  左栏: "Left",
  "左边距 / px": "Left Margin / px",
  "左边距（mm）": "Left Margin (mm)",
  "已保存 {0}": "Saved {0}",
  "已加载磁盘中的最新版本。": "Loaded the latest disk version.",
  "已取消安装。更新文件保留，文档仍保持打开。":
    "Installation canceled. The update remains downloaded and documents remain open.",
  "已取消排版。": "Layout canceled.",
  "已另存草稿副本。": "Draft copy saved.",
  "已复制 CLI 工程信息。": "CLI project info copied.",
  "已复制 PowerShell 读取命令。": "PowerShell read command copied.",
  "已导入 {0}": "Imported {0}",
  已就绪: "Ready",
  "已拆分为 {0} 篇文稿。": "Split into {0} documents.",
  "已插入 ": "Inserted ",
  应用: "Apply",
  "应用于窗口、侧栏和编辑器。工程可单独设置文稿配色。":
    "Applies to windows, sidebars, and editors. Projects can override their document colors.",
  "应用内置表情字体校验失败。":
    "The built-in emoji font failed its integrity check.",
  应用更新: "App Updates",
  "应用状态损坏，无法读取最近工程。":
    "App state is damaged. Recent projects could not be loaded.",
  应用设置: "Settings",
  "应用设置保存在本机，不写入 .mdk 文件。":
    "App settings are stored locally outside .mdk files.",
  "应用设置已保存。": "Settings saved.",
  应用语言: "App Language",
  应用默认: "App Default",
  引用: "Quote",
  "引用包含空路径段：{0}": "The reference contains an empty path segment: {0}",
  引用式图片: "Reference Image",
  引用式链接: "Reference Link",
  "引用的字体不存在：": "Referenced font not found: ",
  "引用的百分号编码无效：{0}":
    "The reference has invalid percent encoding: {0}",
  "引用的解码路径段不安全：{0}":
    "The decoded reference path contains an unsafe segment: {0}",
  "引用目标路径无效：{0}": "Invalid reference target: {0}",
  "引用逃逸工程根目录：{0}": "The reference escapes the project root: {0}",
  引用颜色: "Quote Color",
  当前工程: "Current Project",
  "当前已是最新版本。": "You are on the latest version.",
  "当前文件不存在。": "The current file does not exist.",
  "当前文件无效。": "The current file is invalid.",
  "当前文件系统无法提供原子无覆盖发布，源工程保持不变：":
    "This filesystem cannot publish atomically without overwriting. The source project is intact: ",
  "当前文稿不可插入资源，请在可编辑的 Markdown 正文中重试。":
    "Resources can only be inserted into editable Markdown documents.",
  "当前文稿没有标题。": "This document has no headings.",
  "当前版本：": "Current version: ",
  "当前目录有待同步变更。先写入 contents.toml，再打开源码。":
    "There are pending contents changes. Write them to contents.toml first.",
  当前窗口: "This window",
  当前自定义尺寸: "Current Custom Size",
  "当前运行环境不支持在线检查，请在正式安装版中检查更新。":
    "This environment cannot check for updates online. Use an installed release build.",
  "录制{0}快捷键": "Record shortcut for {0}",
  "快捷键已保存。": "Keyboard shortcuts saved.",
  "快捷键格式无效。": "Invalid shortcut.",
  "恢复未提交的草稿？": "Recover the unsaved draft?",
  恢复草稿: "Recover Draft",
  "恢复草稿保存失败：": "Could not save the recovery draft: ",
  "恢复草稿参数无效。": "Invalid recovery draft parameters.",
  "恢复草稿超过 129 MiB 实现支持范围。":
    "The recovery draft exceeds the 129 MiB limit.",
  "恢复草稿超过实现支持范围。":
    "The recovery draft exceeds the supported limit.",
  恢复默认: "Restore Defaults",
  所有更改已保存: "All changes saved",
  "所选封面不可转换。": "The selected cover cannot be converted.",
  "打包已解包的 MDK 目录": "Pack an Unpacked MDK Folder",
  打包方式: "Packing Method",
  "打包目录不能含符号链接。":
    "A folder to be packed cannot contain symbolic links.",
  打印背景色: "Print Background",
  打开其他工程: "Open Another Project",
  打开工程: "Open Project",
  打开工程文件所在位置: "Show Project File Location",
  打开文件所在位置: "Show File Location",
  "执行预检或导出时会先保存当前配置。":
    "Preflight and export save the current configuration first.",
  "找不到标题锚点：": "Heading anchor not found: ",
  "找不到目录项：{0}": "Contents entry not found: {0}",
  "找不到链接文件：{0}": "Linked file not found: {0}",
  折叠: "Collapse",
  护眼: "Warm",
  "拖入文件授权已失效，请重新拖入。":
    "The dropped file authorization expired. Drop the files again.",
  "拖入文件无效，一次最多 16 个文件。":
    "Invalid drop. Drop at most 16 files at a time.",
  "拖到文稿中间设为子级，上下边缘调整顺序。":
    "Drop onto a document to nest it. Drop near the top or bottom edge to reorder.",
  "拖动调整大小，双击恢复均分": "Drag to resize. Double-click to reset.",
  "按当前编辑光标或预览位置高亮标题并滚动大纲。":
    "Highlight the current heading and scroll the outline to follow the cursor or preview.",
  按标题拆分: "Split by Heading",
  "按标题拆分当前文稿？": "Split this document by heading?",
  "按标题生成 PDF 书签": "Create PDF Bookmarks from Headings",
  "损坏的 extra 字段。": "Corrupt ZIP extra field.",
  排版与字体: "Typography & Fonts",
  提前展示交付预检报告: "Show Delivery Preflight Report",
  插入: "Insert",
  "插入 Markdown 语法": "Insert Markdown Syntax",
  "插入 Markdown 语法…": "Insert Markdown Syntax…",
  "插入后切换到源码编辑，以保留此语法的完整写法。":
    "After insertion, the editor switches to source mode to preserve the full syntax.",
  插入图片: "Insert Image",
  插入工具: "Insert Tools",
  插入并编辑源码: "Insert and Edit Source",
  插入本地资源: "Insert Local Resources",
  插入表格: "Insert Table",
  插入链接: "Insert Link",
  搜索工程目录: "Search Project Files",
  撤销: "Undo",
  撤销文件更改: "Revert File Changes",
  "操作 {0}": "Actions for {0}",
  "支持 .mdk / .md 文件": "Supports .mdk and .md files",
  "支持的图片、音视频及 PDF": "Supported Images, Audio, Video, and PDF",
  收起导航: "Collapse Navigation",
  收起或展开导航: "Toggle Navigation",
  放大: "Zoom In",
  "放弃当前文件的更改？": "Discard changes to this file?",
  放弃更改: "Discard Changes",
  放弃更改并关闭: "Discard Changes and Close",
  放弃更改并更新: "Discard Changes and Update",
  整体目录: "Project Files",
  文件: " File",
  "文件内容与受支持格式不符：":
    "File contents do not match a supported format:",
  "文件名不是有效 UTF-8。": "The filename is not valid UTF-8.",
  "文件名为空或包含非法字符。":
    "The filename is empty or contains invalid characters.",
  "文件对话框参数无效。": "Invalid file dialog parameters.",
  文件总数: "Files",
  "文件或目录不存在。": "File or folder not found.",
  "文件或目录已存在。": "A file or folder already exists.",
  "文件超过 64 MiB。": "The file exceeds 64 MiB.",
  "文件链接无效。": "Invalid file link.",
  "文件链接的路径或百分号编码无效。":
    "The file link has an invalid path or percent encoding.",
  文内标题: "Document Headings",
  文字: "Text",
  文本: "Text",
  文本工具: "Text Tools",
  "文稿 ID": "Document ID",
  "文稿 {0} 超出固定页面，请调整页高、字号或拆分文稿":
    "Document {0} exceeds the fixed page. Adjust the height or font size, or split the document",
  文稿与工程目录: "Documents and Project Files",
  文稿主题: "Document Theme",
  "文稿文件缺失：": "Document file missing: ",
  文稿目录: "Contents",
  文稿目录树: "Contents Tree",
  "文稿缺失或无法按 UTF-8 读取：": "Document missing or unreadable as UTF-8:",
  "文稿较大，实时大纲已暂停。":
    "Live outline is paused for this large document.",
  文稿颜色: "Document Colors",
  斜体: "Italic",
  新增目录引用: "Add Contents Reference",
  新建子文稿: "New Child Document",
  新建工程: "New Project",
  "新建工程 · 工程类型": "New Project · Project Type",
  新建文件夹: "New Folder",
  新建文本文件: "New Text File",
  新建文稿: "New Document",
  无: "None",
  "无匹配项，可直接输入字体名称": "No matches. You can enter a font name.",
  无序列表: "Bulleted List",
  "无效的分页、EPUB 布局或阅读方向。":
    "Invalid pagination, EPUB layout, or reading direction.",
  "无效的目录位置：{0}": "Invalid contents position: {0}",
  无标题: "Untitled",
  无法保存窗口尺寸: "Could not save window size",
  "无法保证未知扩展中的全部引用同步，交付副本保留源文件名。":
    "References from unknown extensions cannot be guaranteed to stay in sync. Original filenames are kept in the delivered copy.",
  "无法按 UTF-8 或 GB18030 读取此 Markdown，请转换为 UTF-8 文本后重新打开。":
    "This Markdown could not be decoded as UTF-8 or GB18030. Convert it to UTF-8 and reopen it.",
  "无法用默认应用打开文件：{0}":
    "Could not open the file in its default app: {0}",
  "无法确定 PDF 目录页码。": "Could not determine PDF contents page numbers.",
  "无法解码或超过四千万像素。":
    "Could not decode the image, or it exceeds 40 million pixels.",
  显示字数: "Show Word Count",
  显示文稿目录: "Show Document Contents",
  显示首个标题: "Show First Heading",
  "普通文件不能作为父目录：{0}":
    "A regular file cannot be a parent directory: {0}",
  暂不处理更新: "Dismiss Update Notice",
  暂无可选项: "No options",
  "暂无文件。": "No files.",
  "暂无文稿。点击 + 新建文稿。": "No documents. Click + to create one.",
  暂无最近工程: "No recent projects",
  "暂无校验结果。": "No validation results yet.",
  暂无记录: "No recent items",
  更新下载进度: "Update Download Progress",
  "更新已下载。点击安装并重启后，将沿用当前安装设置并自动重启。":
    "The update is downloaded. Install and restart to keep the current installation settings.",
  "更新已下载，等待手动安装。":
    "The update is downloaded and ready to install.",
  更新已准备好: "Update Ready",
  "更新操作失败：{0}": "Update failed: {0}",
  "更新操作无效。": "Invalid update action.",
  更新状态: "Update Status",
  更新目录: "Update Contents",
  "更新目录后打开源码？": "Update the contents before opening the source?",
  最大化: "Maximize",
  最小化: "Minimize",
  最近使用: "Recent",
  最近工程: "Recent Projects",
  有序列表: "Numbered List",
  有未保存的更改: "Unsaved changes",
  未保存: "Unsaved",
  "未发现已知引用；作为附件保留，不自动清理。":
    "No known references were found. The attachment is kept.",
  "未发现问题。": "No issues found.",
  "未命名.md": "Untitled.md",
  "未命名.mdk": "Untitled.mdk",
  未打开工程: "No Project Open",
  未校验: "Not Validated",
  "未知 mode": "Unknown mode ",
  "未知 mode ": "Unknown mode ",
  "未知 mode 不支持出版转换。":
    "Unknown modes do not support publication conversion.",
  "未知 mode 的内容只读，请显式切换到 00 后编辑。":
    "Unknown project modes are read-only. Switch to mode 00 to edit.",
  "未知 mode 的附加约束未验证，当前内容只读；请显式切换到 00 通用模式后编辑。":
    "Mode-specific constraints are unverified for unknown modes. The project is read-only. Switch to General mode (00) to edit.",
  "未知文件、字段和持久扩展按不透明数据保留；仅验证基础规则，不声称已验证扩展语义。":
    "Unknown files, fields, and persistent extensions are kept as opaque data. Only the base rules are validated.",
  "未知版本 settings 不可修改；可显式删除该可选文件。":
    "Unknown settings versions cannot be edited. The optional file can be deleted explicitly.",
  "未知版本 settings 不可降写。":
    "Settings from an unknown version cannot be downgraded.",
  "未知版本 settings 仅允许原样保留或显式删除，不能降写。":
    "Settings from an unknown version can be kept as-is or explicitly deleted. Downgrading them is unsupported.",
  未绑定: "Unassigned",
  "未编排文稿，保留文件但不加入阅读顺序。":
    "The document is not in the contents. Its file is kept outside the reading order.",
  未选择工程: "No Project Selected",
  未选择文件: "No File Selected",
  "本地 data descriptor 占位值不一致。":
    "The local data-descriptor placeholders are inconsistent.",
  "本地修改已保留。另存副本将把本地草稿应用到磁盘版本。":
    "Local changes were kept. Save a draft copy to apply your edits to the disk version separately.",
  "本地图片可导入工程；外部图片仅保留引用，不自动联网加载。":
    "Local images can be imported into the project. External images remain links and are loaded only on request.",
  "本地头与中央目录 CRC 或大小不一致。":
    "The local header CRC or size differs from the central directory.",
  "本地头与中央目录名称、标志或方法不一致。":
    "The local header name, flags, or method differs from the central directory.",
  "本地引用的文件不存在：": "Referenced local file not found: ",
  "本地文件头损坏或偏移错误。": "Corrupt local file header or invalid offset.",
  "本地条目范围重叠。": "Local entry ranges overlap.",
  本地缓冲区: "Local Buffer",
  "本次交付将剔除持久或未知 meta 数据，必须确认具体范围：":
    "Confirm the persistent or unknown metadata to exclude from this delivery: ",
  "本次交付的 meta 范围": "Metadata in This Delivery",
  "条目与中央目录重叠。": "An entry overlaps the central directory.",
  查看发布页: "View Release",
  查看更新: "View Update",
  查看详情: "View Details",
  标题: "Heading",
  "标题\n====": "Heading\n====",
  标题大纲: "Outline",
  标题大纲跟随窗格: "Sync Outline with Active Pane",
  "标题（可选）": "Title (Optional)",
  校验与导出: "Validate & Export",
  校验工程: "Validate Project",
  校验未通过: "Validation Failed",
  "检查容器、目录结构与资源引用是否完整。":
    "Check the package, contents structure, and resource references.",
  "检测到上次未提交的正文、控制文件或目录更改。":
    "Unsaved document, control file, or contents changes were found.",
  "检测到草稿，但磁盘工程已有其他修改。恢复后将保留冲突保护，不能直接覆盖磁盘。":
    "A draft was found, and the disk version has changed. Conflict protection stays enabled after recovery.",
  "正在下载 {0}%": "Downloading {0}%",
  "正在下载更新。": "Downloading the update.",
  "正在保存文稿与导出配置…": "Saving documents and export settings…",
  "正在准备安装并处理所有窗口的未保存内容…":
    "Preparing installation and handling unsaved changes in all windows…",
  正在准备更新: "Preparing Update",
  "正在分页排版…": "Laying out pages…",
  "正在加载差异…": "Loading diff…",
  "正在加载源码编辑器…": "Loading the source editor…",
  正在处理: "Working",
  "正在处理导出任务，请稍候…": "Processing export…",
  "正在处理工程，请稍后再试。": "The project is busy. Try again in a moment.",
  "正在处理工程，请稍后重新拖入。":
    "The project is busy. Drop the files again in a moment.",
  "正在处理所有窗口的未保存内容…": "Handling unsaved changes in all windows…",
  "正在排版并检查页面、字体和图片…":
    "Laying out and checking pages, fonts, and images…",
  "正在整理 PDF 书签和文档信息…": "Preparing PDF bookmarks and metadata…",
  "正在构建 EPUB 并校验文件…": "Building and validating the EPUB…",
  "正在校验修订并写入导出文件…":
    "Checking the revision and writing the export…",
  "正在检查 GitHub Releases…": "Checking GitHub Releases…",
  "正在生成 PDF 页面…": "Rendering PDF pages…",
  "正在计算 PDF 目录页码…": "Calculating PDF contents page numbers…",
  "正在读取导出设置…": "Loading export settings…",
  "正在读取工程并校验文稿、字体和资源…":
    "Reading the project and checking documents, fonts, and resources…",
  "正在读取更新状态…": "Loading update status…",
  正文: "Body Text",
  正文右键菜单: "Editor Context Menu",
  "正文含不能写入出版文档的控制字符。":
    "The document contains control characters that cannot be written to the publication.",
  "正文字号（px）": "Body Font Size (px)",
  正文格式: "Document Formatting",
  正文编辑器: "Document Editor",
  正文行高: "Body Line Height",
  正文颜色: "Body Text Color",
  "此功能仅适用于 MDK 工程，单 Markdown 模式不可用。":
    "This feature requires an MDK project and is unavailable in single Markdown mode.",
  "此工程固定的 PDF 渲染版本与当前应用不同。请使用相同版本，或明确保存配置采用当前引擎；不能保证跨版本生成相同 PDF。":
    "The PDF renderer pinned by this project differs from the current one. Use the matching app version or save the configuration to adopt the current renderer.",
  此文稿可使用源码编辑或分页预览:
    "Use source editing or paged preview for this document",
  "此文稿被多个目录项引用，请先解除重复引用再拆分。":
    "Multiple entries reference this document. Remove the duplicate references before splitting.",
  "此版本请从发布页下载对应安装包或便携版。":
    "Download the matching installer or portable build from the release page.",
  "此目录已含有解包工程。": "This folder already contains an unpacked project.",
  "此窗口不能打开本地文件链接。": "This window cannot open local file links.",
  "此资源不支持直接预览。": "This resource cannot be previewed directly.",
  "此链接的文件类型不支持直接打开。":
    "This linked file type cannot be opened directly.",
  "此页面为界面预览。请运行桌面应用以创建、打开和保存本地工程。":
    "This is a UI preview. Use the desktop app to create, open, and save local projects.",
  段落: "Paragraph",
  段落工具: "Paragraph Tools",
  段落样式: "Paragraph Style",
  段间距: "Paragraph Spacing",
  "段间距（em）": "Paragraph Spacing (em)",
  "每 24 小时检查一次 GitHub Releases。仅检查版本；下载与安装均需手动操作。更改后点击“保存偏好”生效。":
    "Checks GitHub Releases every 24 hours. Downloads and installation are manual. Save preferences to apply this setting.",
  每日自动检查更新: "Check for Updates Daily",
  每篇从右页开始: "Start Each Document on a Right-Hand Page",
  每篇另起一页: "Start Each Document on a New Page",
  "每隔指定秒数检查一次未保存内容。":
    "Check for unsaved changes at this interval.",
  每页目标字符数: "Target Characters per Page",
  "没有已编排文稿，不能导出空出版物。":
    "There are no documents in the reading order. An empty publication cannot be exported.",
  浅色: "Light",
  深色: "Dark",
  清除: "Clear",
  清除格式: "Clear Formatting",
  "渲染 note / warning / tip 容器": "Render note / warning / tip Containers",
  源码: "Source",
  源码与预览分栏: "Split Source and Preview",
  源码写法: "Source Syntax",
  源码实时预览: "Live Source Preview",
  源码编辑器: "Source Editor",
  "源码编辑器尚未就绪。": "The source editor is not ready.",
  "漫画 EPUB 必须使用固定版式，一篇文稿对应一个展示页。":
    "Comic EPUBs require fixed layout, with one display page per document.",
  漫画图片适应: "Comic Image Fit",
  漫画工程: "Comic Project",
  漫画模式: "Comic Mode",
  漫画阅读方向: "Comic Reading Direction",
  漫画页面: "Comic Pages",
  漫画页面排列: "Comic Page Spread",
  灰度输出: "Grayscale",
  "点击当前组合键开始录制。可加入 Shift 或 Alt，按 Esc 取消录制。":
    "Click a shortcut to record it. Add Shift or Alt if needed. Press Esc to cancel.",
  "父目录不存在。": "Parent folder not found.",
  版本号: "Version",
  版本说明: "Release Notes",
  版权说明: "Rights",
  "物理首项必须是 mimetype。": "mimetype must be the first physical entry.",
  生成无障碍标签: "Generate Accessibility Tags",
  "生成期间源工程已改变，未发布过期导出文件。":
    "The source project changed during export. The outdated result was not published.",
  "用于书籍/漫画排版和 PDF 导出；通用模式的编辑正文仍随窗口调整。":
    "Applies to books, comics, and PDF export. General projects use the window width while editing.",
  "留空导出全部，例如 1-3,5": "Leave blank for all pages, e.g. 1-3,5",
  "留空时生成固定 UUID": "Leave blank to generate a stable UUID",
  目录: "Contents",
  目录实时同步阈值: "Live Contents Sync Limit",
  "目录属性与名称不一致。": "The directory attribute does not match the name.",
  "目录已打包为 MDK 工程。": "Folder packed as an MDK project.",
  "目录指向的文稿缺失；允许保存未完成工程，交付前需恢复文件或删除条目。":
    "A document referenced by the contents is missing. You can save an unfinished project, but restore the file or remove the entry before delivery.",
  "目录更新格式无效。": "Invalid contents update format.",
  "目录最多允许 6 层。": "The contents can be at most six levels deep.",
  "目录有待同步变更 · 更新目录": "Pending Contents Changes · Update Contents",
  "目录有待同步变更，源码显示上次保存的版本。请先点击“更新目录”。":
    "Contents changes are pending. The source shows the last saved version. Select Update Contents first.",
  "目录条目不得包含数据。": "Directory entries cannot contain data.",
  目录标题深度: "Contents Heading Depth",
  "目录深度与章节编号用于书籍预览；启用按标题拆分后，可在源码工具栏手动拆分当前文稿。":
    "Contents depth and chapter numbering apply to book preview. Enable heading splits to split the current document from the source toolbar.",
  "目录源码与可视化目录存在冲突，不能相互覆盖。":
    "Source contents and visual contents changes conflict. Neither can overwrite the other.",
  目录视图: "Sidebar View",
  目录项: "Contents Entries",
  "目录项 id 或 position 重复。": "Duplicate contents entry id or position.",
  "目录项不存在。": "Contents entry not found.",
  "目录项不存在：": "Contents entry not found: ",
  "目录项不存在：{0}": "Contents entry not found: {0}",
  "目录项必须包含非空稳定 id。": "A contents entry needs a nonempty stable id.",
  "目录项必须指向 markdown/ 下的 .md 文件。":
    "A contents entry must reference an .md file under markdown/.",
  "目录项的 Markdown 文件缺失。":
    "The Markdown file for this contents entry is missing.",
  "目录项超过此数量时，调整顺序后手动更新目录。":
    "Above this number of entries, update the contents manually after reordering.",
  "目标文件已存在，未覆盖。请选择其他名称或显式启用覆盖偏好。":
    "The destination already exists and was not overwritten. Choose another name or enable overwrite explicitly.",
  "目标父路径不是目录。": "The destination parent is not a folder.",
  "目标路径已存在。": "The destination path already exists.",
  硬换行: "Hard Line Break",
  确定: "OK",
  确认剔除并交付: "Exclude and Deliver",
  "确认本次交付剔除 meta 数据？": "Exclude metadata from this delivery?",
  "磁盘 Markdown 已被其他进程修改，未覆盖文件。":
    "Another process modified the Markdown on disk. The file was not overwritten.",
  "磁盘工程已被其他进程修改；保存冲突，请重新打开或另存副本。":
    "Another process modified the project on disk. Reopen it or save a copy to resolve the conflict.",
  "磁盘工程已被其他进程修改；存在保存冲突，请重新打开或另存副本。":
    "The project changed on disk. Reopen it or save a copy to resolve the save conflict.",
  磁盘文件已变化: "File Changed on Disk",
  磁盘文件暂不可读取: "File Is Temporarily Unreadable",
  磁盘版本: "Disk Version",
  "禁止的导航协议。": "Navigation protocol is not allowed.",
  "禁止的引用协议：{0}": "Reference protocol is not allowed: {0}",
  "禁止绝对路径或网络相对引用：{0}":
    "Absolute or network-relative reference is not allowed: {0}",
  秒: "sec",
  移除链接: "Remove Link",
  空页脚时自动显示页码: "Show Page Numbers When the Footer Is Empty",
  "窗口操作无效。": "Invalid window action.",
  立即检查更新: "Check for Updates",
  章节分页: "Chapter Breaks",
  "筛选目录…": "Filter entries…",
  篇文稿: " document(s)",
  类型: "Type",
  粘贴: "Paste",
  粘贴纯文本: "Paste as Plain Text",
  "约 ": "Approx. ",
  "纸张宽度（mm）": "Paper Width (mm)",
  纸张背景: "Page Background",
  纸张预设: "Paper Preset",
  "纸张高度（mm）": "Paper Height (mm)",
  编辑: "Edit",
  "编辑 settings.toml": "Edit settings.toml",
  编辑与保存: "Editing & Saving",
  "编辑命令无效。": "Invalid editing command.",
  编辑器: "Editor",
  "编辑器尚未就绪。": "The editor is not ready.",
  编辑图片: "Edit Image",
  编辑工作区: "Editor workspace",
  编辑工具: "Editing Tools",
  编辑模式: "Editor Mode",
  编辑组: " Editor Group",
  编辑链接: "Edit Link",
  缩小: "Zoom Out",
  缩进式代码块: "Indented Code Block",
  "缺少完整的中央目录结束记录。":
    "Missing or incomplete end-of-central-directory record.",
  翻页: "Page Navigation",
  "背景色用于预览及启用背景的 PDF 导出，编辑纸张保持纯白。":
    "The background applies to preview and to PDF exports with backgrounds enabled. The editing page stays white.",
  自动保存: "Auto-save",
  "自动保存当前正文或源码，有效校验后写入工程。":
    "Automatically validate and save changes to the project.",
  自动链接: "Autolink",
  自定义工程模式: "Custom Project Mode",
  "至少需要两个同级的最浅层标题才能拆分。":
    "Splitting requires at least two headings at the shallowest level.",
  "草稿无效。": "Invalid draft.",
  "行 {0}，列 {1}": "Ln {0}, Col {1}",
  行内代码: "Inline Code",
  行内公式: "Inline Formula",
  行数: "Rows",
  行高: "Line Height",
  "表单保存会重排 TOML 注释和空白；需要保留源文件布局时，请使用源码编辑。字号和页宽仅要求合法正数，常用界面范围不决定格式合法性。":
    "Saving the form reformats TOML comments and whitespace. Use source editing to keep the original layout. Valid font sizes and page widths can be any positive number.",
  表格: "Table",
  表格列对齐: "Table Column Alignment",
  表格工具: "Table Tools",
  "表格行数须为 1–100，列数须为 1–20。":
    "A table can have 1–100 rows and 1–20 columns.",
  规范化导出路径: "Normalize Export Paths",
  视频: "Video",
  "解包名称大小写或 Unicode 归一化冲突：":
    "Unpack paths collide after case folding or Unicode normalization: ",
  解包工程目录: "Unpack Project Folder",
  "解包目标发生链接逃逸，已停止。":
    "Unpacking stopped because a link escaped the destination.",
  "解包目标已存在：": "Unpack destination already exists: ",
  "解包目标或祖先目录不能含符号链接/重解析点。":
    "The unpack destination and its ancestors cannot contain symbolic links or reparse points.",
  "解包目标超出选定目录。":
    "The unpack destination is outside the selected folder.",
  "记录超出 payload 边界。": "A record extends beyond the payload.",
  "许可证（GPL-3.0-only）": "License (GPL-3.0-only)",
  "设为标题 {0}": "Set Heading {0}",
  设为正文: "Set Body Text",
  "设置正文格式、保存和编辑组操作的组合键。":
    "Set shortcuts for formatting, saving, and working with editor groups.",
  "设置源码与设置表单存在冲突。": "Source settings and form changes conflict.",
  语法: "Syntax",
  语言: "Language",
  "语言偏好已保存，重启应用后生效。":
    "Language preference saved. Restart the app to apply it.",
  "语言设置将在重启应用后生效。":
    "The language setting takes effect after restarting the app.",
  "请从文件管理器拖入本地文件。": "Drag local files from the file manager.",
  "请保存导出配置以生成稳定的出版物标识。":
    "Save export settings to generate a stable publication identifier.",
  "请修复控制文件或重新读取配置。":
    "Fix the control files or reload the configuration.",
  "请先保存完整导出配置，以便设置和字体随工程分发。":
    "Save the complete export configuration first so its settings and font hash travel with the project.",
  "请先保存工程设置，再调整目录。":
    "Save the project settings before reorganizing the contents.",
  "请先保存或修复编辑缓冲区。": "Save or fix the editor changes first.",
  "请先保存或撤销 contents.toml 的源码更改。":
    "Save or discard the contents.toml source changes first.",
  "请先修复 settings.toml，再保存导出配置。":
    "Fix settings.toml before saving export settings.",
  "请先修复严格交付检查中的错误，再交付工程。":
    "Fix the strict delivery errors before delivering the project.",
  "请先修复校验错误。": "Fix the validation errors first.",
  "请先在书籍工程设置中启用“按标题拆分”。":
    "Enable Split by Heading in the book settings first.",
  "请先手动下载更新。": "Download the update first.",
  "请先检查并选择可用更新。": "Check for and select an available update first.",
  "请完成当前资源操作后重试。":
    "Wait for the current resource operation to finish and try again.",
  "请将受支持的文件拖入可编辑的 Markdown 正文。":
    "Drop supported files into editable Markdown content.",
  "请手动安装并重启，退出时不会自动安装。":
    "Install and restart when ready. Closing the app does not install the update.",
  "请按住 Ctrl，再按字母、数字、功能键或反斜杠。":
    "Hold Ctrl and press a letter, digit, function key, or backslash.",
  "请按组合键…": "Press a shortcut…",
  "请输入有效的 HTTP(S)、mailto、片段或工程内相对地址。":
    "Enter a valid HTTP(S), mailto, fragment, or project-relative address.",
  "请选择 .md 输出路径，并提供当前文稿的草稿。":
    "Choose an .md output path and provide the current document draft.",
  "请选择 Markdown 文稿。": "Choose a Markdown document.",
  "请选择 PDF / EPUB 输出文件并确认覆盖。":
    "Choose a PDF or EPUB output file and confirm overwriting.",
  "请选择…": "Select…",
  "请选择对应格式的新输出路径，不能覆盖源工程。":
    "Choose a new destination with the correct extension. The source project cannot be overwritten.",
  "请选择导出位置。": "Choose an export location.",
  "请选择普通 Markdown 文件，不支持链接文件。":
    "Choose a regular Markdown file. Symbolic links are unsupported.",
  "请选择解包后的 MDK 目录。缺少有效的 contents.toml 文件。":
    "Choose an unpacked MDK folder containing a valid contents.toml file.",
  "请通过文件对话框选择此路径。": "Choose this path using the file dialog.",
  "请通过桌面应用打开工程。": "Open the project in the desktop app.",
  调整左右编辑组宽度: "Resize the Editor Groups",
  调整文稿目录与标题大纲高度: "Resize the Contents and Outline Panes",
  "资源不可用：": "Resource unavailable: ",
  "资源不存在。": "Resource not found.",
  "资源不存在或是目录。": "The resource is missing or is a folder.",
  "资源插入位置无效。": "Invalid resource insertion position.",
  资源数量: "Resources",
  "资源无效或超过 64 MiB。": "The resource is invalid or exceeds 64 MiB.",
  "资源的扩展名与实际文件格式不一致：{0}":
    "The resource extension does not match its actual format: {0}",
  资源类型: "Resource Type",
  "资源类型与实际文件格式不一致。":
    "The resource type does not match its actual format.",
  "资源类型无效。": "Invalid resource type.",
  起始页码: "Starting Page Number",
  "超出实现支持范围：单文件 64 MiB / 总量 256 MiB。":
    "The file and archive limits are 64 MiB per file and 256 MiB in total.",
  "超出实现支持范围：实际解压总量超过 256 MiB。":
    "Decompressed files exceed the 256 MiB limit.",
  "超出实现支持范围：容器超过 256 MiB。": "The container exceeds 256 MiB.",
  "超出实现支持范围：最多 10,000 个 ZIP 项。": "The ZIP entry limit is 10,000.",
  "超出实现支持范围：解压处理时间超过 15 秒。":
    "Decompression exceeded the 15-second limit.",
  "超出实现支持范围：资源超过 64 MiB。": "The resource exceeds 64 MiB.",
  跟随系统: "Follow System",
  跨电脑复现信息: "Cross-Computer Reproducibility",
  路径: "Path",
  跳转: "Go",
  转义标点: "Escape Punctuation",
  软件主题: "App Theme",
  "输入两位十六进制数。00 通用，01 书籍，02 漫画，其他值按兼容模式打开。":
    "Enter two hexadecimal digits. 00 is General, 01 is Book, and 02 is Comic. Other values open in compatibility mode.",
  "输出文件已被外部修改，未覆盖。":
    "Another process modified the output. The file was not overwritten.",
  "输出路径不能是链接或特殊文件。":
    "The output path cannot be a link or special file.",
  "输出路径在确认后发生变化，请重新选择文件，未覆盖。":
    "The destination changed after confirmation. Choose it again. The file was not overwritten.",
  返回应用设置: "Back to Settings",
  返回脚注引用: "Return to footnote reference",
  还原: "Restore",
  连续排版: "Continuous",
  适应宽度: "Fit Width",
  "选择 Markdown 文稿查看标题。":
    "Choose a Markdown document to view its headings.",
  选择字体: "Choose Font",
  "选择已导入的图片…": "Choose an imported image…",
  选择文件: "Choose File",
  通用工程: "General Project",
  "标题大纲在左侧显示。书籍和漫画预览可以隐藏首个标题。":
    "The outline appears in the sidebar. Book and comic previews can hide the first heading.",
  配置快捷键: "Configure Shortcuts",
  重做: "Redo",
  重命名: "Rename",
  "重命名将破坏已知引用；无法无损同步引用，已保留原路径。请先在源码中调整依赖。":
    "Renaming would break known references. The original path was kept. Update the dependencies in source first.",
  重命名文件或目录: "Rename File or Folder",
  重命名文稿: "Rename Document",
  "重新保存会明确采用当前渲染版本与字体摘要；已有配置不匹配时不会自动替换。":
    "Saving again adopts the current renderer and font hash. Existing mismatched settings are kept until you save.",
  重新加载: "Reload",
  "重新加载将使用磁盘版本。需要保留本地修改时，可以先另存草稿副本。":
    "Reloading uses the disk version. Save a draft copy first if you need to keep your local changes.",
  重新加载磁盘版本: "Reload Disk Version",
  重新排版: "Resume Layout",
  重新读取配置: "Reload Configuration",
  链接: "Link",
  链接地址: "Link URL",
  链接或图片标题: "Link or Image Title",
  链接文字: "Link Text",
  链接颜色: "Link Color",
  键盘快捷键: "Keyboard Shortcuts",
  "长文稿仅对比前 20 万字符。":
    "Large documents are compared using the first 200,000 characters.",
  问题反馈: "Report an Issue",
  阅读方向: "Reading Direction",
  "非 ASCII 文件名必须明确采用 UTF-8 bit 11。":
    "Non-ASCII names must set the UTF-8 flag (bit 11).",
  音频: "Audio",
  页眉: "Header",
  "页眉或页脚所在边距至少应为页眉字号的两倍。":
    "The header or footer margin must be at least twice the furniture font size.",
  "页眉或页脚过长，请缩短文字或调整字号":
    "The header or footer is too long. Shorten it or adjust its font size",
  "页眉页脚仅支持单行文字和 {title}、{author}、{page}、{pages} 占位符。":
    "Headers and footers support single-line text and the {title}, {author}, {page}, and {pages} placeholders.",
  "页眉页脚字号（px）": "Header and Footer Font Size (px)",
  页眉页脚支持: "Headers and footers support ",
  页码: "Page Number",
  "页码范围格式须为 1-3,5。": "Use page range syntax such as 1-3,5.",
  "页码范围超过实际总页数 ": "The page range exceeds the actual page count of ",
  "页码范围须为递增且不重叠的正整数范围。":
    "Page ranges must be ascending, non-overlapping positive integers.",
  页脚: "Footer",
  "页面可用空间或字号/行距超出出版渲染范围；原设置未改写。":
    "The page area, font size, or line height is outside the supported export range. The original settings were kept.",
  页面布局: "Page Layout",
  页面排列: "Page Spread",
  "项待处理问题；允许保存，交付前须修复":
    " pending issue(s). Fix them before delivery.",
  预览: "Preview",
  "预览版心宽度 / px": "Preview Content Width / px",
  预览目录深度: "Preview Contents Depth",
  预览章节编号: "Preview Chapter Numbering",
  预览背景: "Preview Background",
  默认交付格式: "Default Delivery Format",
  "默认字体资源名称已被其他文件占用：":
    "The default font resource name is already in use: ",
  默认对齐: "Default Alignment",
  "（仅 book / comic）": " (book and comic only)",
  "（其他主机持锁或所有者无法确认）":
    " (the lock belongs to another host or its owner is unknown)",
  "（外部或不安全媒体未加载）": "(external or unsafe media not loaded)",
  "（所有者记录无法解析）": " (invalid owner record)",
  "（持锁进程仍在运行）": " (the owner is still running)",
  "（无法确认持锁进程已退出）": " (could not confirm that the owner exited)",
  "（资源不可用）": "(resource unavailable)",
  "（资源缺失或不可预览）": " (missing or unsupported media)",
  "（锁已变化）": " (lock changed)",
  "（锁的 PID 无效）": " (invalid lock PID)",
  "（锁的所有者无法确认）": " (lock owner could not be identified)",
  "（锁类型无效）": " (invalid lock type)",
  "，共 {0} 页": ", {0} page(s)",
  "，未导出。": ". Nothing was exported.",
  "：": ": ",
  "：仅校验 default 基础规则，附加约束未验证；内容只读，原用途与未知数据保留。":
    ": Only the base rules are checked. Extra constraints are unverified. The contents are read-only, and the original mode and unknown data are kept.",
  "：只读显示基础内容，其附加约束未验证。可显式切换到 00 后编辑。":
    ": Basic content is read-only and mode-specific constraints are unverified. Switch to mode 00 to edit.",
  "；选定页码范围时保留完整文档中的页码，总页数表示全文页数。漫画按实际目录项分单页 / 双页，内容超出固定页面时拒绝导出。":
    ". Selected ranges retain original page numbers and the full document's page count. Comic spreads follow the contents entries. Fixed pages must fit their content.",
} as const;
