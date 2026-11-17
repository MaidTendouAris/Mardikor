# MDK v2 settings.toml 最大支持目录

定稿日期：2026-11-16 · 对应 MDK v2 定稿版

本文是 [MDK v2 规范](<MDK Format Specification v2.md>) 的规范性设置组成部分，与主规范同修订，标准能力版本为 `mdk.settings-full@1`。它定义首版 v2 可表达的完整设置范围，不要求每个阅读器一次实现全部功能。所有设置表均可省略；空文件合法。主动登记字体集时，其对象内必需字段仍须提供。完整字段示例见 [settings.full.toml](examples/v2/settings.full.toml)。

## 1. 职责、支持级别与作用域

settings 保存作者愿意随作品分发的样式和阅读建议。所有模式共用同一份字段目录；切换 mode 不使已有字段变为非法，不改变 Markdown 解析或目录结构。

- **基础支持**：主规范第 10.1 节的基础字段。基础预览器必须实现；高级 font 引用除外。
- **完整支持**：本文全部已定义字段，能力标识为 `mdk.settings-full@1`。声明时须同时说明角色；预览器执行 S/R/V，出版器执行目标适用的 S 及主规范明确映射的 R，验证器只验证数据而不代替渲染支持。仅会保存字段不能据此宣称可完整预览／出版。
- **部分支持**：可以实现任意较小集合，但必须按字段报告未支持或临时回退，不得宣称完整支持。未知数据仍须保留。

使用超出基础集合的设置时，应在 `mdk.toml` 的 `features.optional` 中声明 `mdk.settings-full@1`。若作品必须完整应用这些设置才能按作者意图使用，可以放入 `features.required`；它会触发主规范的必需能力限制。不得同时列入两者。出版预设也可以通过自身 `requires` 要求此能力。

能力声明描述支持要求，不是字段开关；已知字段不会因漏声明变成无效或被忽略，但实现须提示漏声明。optional 允许报告后以基础效果阅读，不授权出版器把未实现的作者设置标为已完整应用。以下缺省值是完整模型的缺省值，基础实现只承担主规范列出的基础集合。

本文作用域标记：

| 标记 | 生效范围 |
| --- | --- |
| S | 正文样式，可用于预览、PDF、EPUB；目标确实使用的字段必须能执行或报告限制。 |
| R | 阅读编排、导航或视图附加信息；出版只采用主规范明确映射的部分。 |
| V | 屏幕预览；不用于决定纸张、输出分页或出版物颜色。 |

范围受控，不允许任意 CSS、选择器、HTML、JavaScript、外部样式表或脚本表达式。表和字符串只能按其声明的语义解释。

## 2. 公共类型、单位与继承

### 2.1 类型

| 简称 | 定义 |
| --- | --- |
| `bool` | TOML boolean，不接受字符串或数字代替。 |
| `positive` | 有限数值，大于 0。 |
| `nonnegative` | 有限数值，大于等于 0。 |
| `finite` | 有限数值；只用于明确允许负数的字距。 |
| `positive-int` | 1–2,147,483,647 的 TOML 整数。 |
| `color` | `#RRGGBB`，十六进制大小写均可，推荐小写。 |
| `paint` | `color` 或字符串 `none`；none 表示不绘制该局部背景，不表示隐藏内容。 |
| `font-ref` | `generic`、`resources/` 下的字面字体路径，或 `@字体集ID`。 |
| `family` | `serif`、`sans-serif`、`monospace`；不接受未经封装的本机字体族名。 |
| `align` | `start`、`end`、`center`、`justify`。 |

枚举区分大小写。核心数字字段拒绝 NaN、无穷和类型强制转换。表中未明确允许空字符串时，字符串不得为空；`format` 等字段另有规则。未知扩展字段由对应扩展规定。

`px` 指 CSS px；`em` 相对于**该元素最终字号**；`scale` 是相对于最终 `body.font_size` 的倍数。`inline`、`block`、`start`、`end` 采用正文书写模式和文本方向的逻辑轴，不固定等于左右上下。预览画布外框仍按物理屏幕宽高计算。[CSS Writing Modes](https://www.w3.org/TR/2019/REC-css-writing-modes-3-20191210/#logical-directions)

百分比字段的数值单位明确为百分数，例如 100 表示 100%。不接受 `16px`、`2em`、`calc(...)` 等带单位或表达式的字符串。0 只有在表格明确说明时才表示“无上限”或“使用固有比例”。

### 2.2 解析与继承顺序

1. 读取工程显式值，保留字段是否省略以及全部校验错误；按本文缺省值和主规范 mode 缺省值解释缺省字段。预览的非法值回退是另一个临时结果，不能作为出版的输入。
2. 出版时先应用所选预设对 S 作用域表的显式覆盖，再解析依赖与继承。出版预设中的 body 更新后，继承它的标题、代码等须重新解析，不能沿用预览时缓存的缺省值。
3. 缺省标为“继承 body”的字段取最终 body 对应值；标题分级字段依次取该级显式值、headings 公共显式值、该级缺省值。`size_scale` 只有分级值和分级缺省值。
4. 数组出现时整体替换，不按位置合并；省略表示继承／默认，空数组表示明确不配置额外成员。
5. 模式缺省值只作用于主规范明列的字段，以及本文 `preview.layout`。本机偏好或无障碍覆盖只用于阅读，不写回，不参加出版。

“继承”“无上限”出现在缺省值说明里时，不一定是可写入的字符串；只能使用该字段类型允许的 TOML 值。一般继承通过省略字段表达。

空表不清空工程设置，也不重置为格式缺省值。若工程显式指定 headings.h1.text_color，预设只覆盖 headings.text_color，h1 仍保持其分级值；预设须覆盖同一个 h1 字段才能替换它。所有 size_scale 均直接乘最终 body.font_size，不按容器嵌套连乘，例如表格内行内代码的字号仍为 body.font_size × inline_code.size_scale。

相邻普通流式块的块向间隔先按各自最终字号换算为 px，再取前块 spacing_after 与后块 spacing_before 的较大值，不相加；正文段落的后间隔来自 `body.paragraph_spacing`。未定义独立间隔字段的代码块、引用、列表和表格，前间隔为 0，后间隔为 body.paragraph_spacing × body.font_size；不得再叠加浏览器默认 margin。容器内部 padding 与外部间隔分别计算，不与子内容间隔折叠。紧列表中的直接段落不产生段落间隔；松列表仍保留，列表项之间的间隔至少为 lists.item_spacing。`images.caption_gap` 只连接图与图注，不参与相邻块规则。

### 2.3 出版处理

主规范 publication 预设允许覆盖 S 作用域的样式字段。`font_sets` 始终取工程级定义；预设只引用，不重新定义同名字体集。混合表中也只允许覆盖 S 字段，例如 presets.reading 只能包含 image_fit。已知 R/V 字段写入这条覆盖通道属于预设配置错误；它们不能借此改变出版阅读序列或纸张。

屏幕中的滚动容器不会成为出版内容的裁切窗口。代码或表格在出版时若不能完整排版，应报错、调整所选预设或明确选择有损转换；不得截图、截字或缩到不可辨识而宣称完整输出。预览中的 `hover`、访问信息及控件不参与印刷布局。

## 3. 字体资源：font_sets

可选的 `[[font_sets]]` 数组登记一组实际字体文件。空数组合法，ID 使用主规范 ID 语法且在该数组内唯一；没有引用时不强制加载字体。

| 字段 | 类型 | 必需／缺省 | 作用域 |
| --- | --- | --- | --- |
| `font_sets[].id` | ID string | 必需 | S |
| `font_sets[].regular` | resources 字体路径 | 必需，常规字形 | S |
| `font_sets[].bold` | resources 字体路径 | 可选，粗体字形 | S |
| `font_sets[].italic` | resources 字体路径 | 可选，斜体字形 | S |
| `font_sets[].bold_italic` | resources 字体路径 | 可选，粗斜体字形 | S |

`@body-cjk` 引用 ID 为 body-cjk 的字体集。字体集只能指向文件，不能递归引用其他字体集。相同字体文件可用于多个集，不要求复制资源。字体类型通过实际内容识别；不支持的格式保留原文件并报告。

直接的字体文件路径按只有 regular 成员的匿名字体集处理，适用相同的匹配和合成规则；不能根据相邻文件名自动发现其他字形。

四个字形按登记角色分别作为常规 400、粗体 700 及对应斜体参与匹配，不从文件名推断。先匹配请求的常规／斜体风格；只有该风格无任何字形时才回到另一风格。同一风格具有两个字重时，请求值不大于 500 选 400，大于 500 选 700；只有一个字重时选它。这与这两个静态字重的 [CSS 字体匹配次序](https://www.w3.org/TR/2018/REC-css-fonts-3-20180920/#font-style-matching) 一致，避免把 501 等请求按绝对差值误配到 400。正常的静态字重匹配不要求字体精确包含请求的每一个数值。

所选文件具有 wght 轴时，应用请求字重并将其限制在文件声明的轴范围内；其他轴保持文件缺省值。实现不能处理该轴时报告能力限制，不能声称已执行。未登记相应字形且字体本身不能提供所请求的粗体／斜体时，按 body.font_synthesis 决定是否允许合成；不允许时保留可用字形并报告表现差异，不删除 Markdown 的强调语义。自定义轴映射、Unicode 分区及任意 OpenType 特性留给扩展。

字体选择顺序是元素 font、body.font_fallbacks 的顺序、元素最终 font_family，按需要逐步解决缺字；不得拆散必须一起塑形的字符簇。font 为 generic 时表示明确使用元素的通用字体族，跳过包内后备列表；需要后备列表时须先指定一个包内主字体。主字体缺字并成功采用声明的后备链是正常行为，不把“使用多种字体”本身视为失败。

字体源缺失／损坏与正常缺字必须区分：出版中实际需要读取的来源不可用时不能悄悄跳过并宣称完整应用。该次出版只检查所选字形和实际走到的后备来源；字体集未使用的其他字形不参与该次出版阻断。主规范的基础工程交付另须携带全部合法登记的字体路径；所有已知路径即使未使用，也参与重命名维护。

## 4. 正文：body

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `body.font_family` | family | `sans-serif` | S |
| `body.font` | font-ref | `generic` | S |
| `body.font_fallbacks` | 字体路径或 `@ID` 的数组，不含 generic | `[]` | S |
| `body.font_size` | positive，px | 16 | S |
| `body.font_weight` | integer，1–1000 | 400 | S |
| `body.font_style` | `normal`、`italic` | `normal` | S |
| `body.line_height` | positive，字号倍数 | 1.7 | S |
| `body.paragraph_spacing` | nonnegative，em | 0.8，普通段落后间隔 | S |
| `body.letter_spacing` | finite，em | 0 | S |
| `body.word_spacing` | finite，em | 0 | S |
| `body.kerning` | `auto`、`normal`、`none` | `auto` | S |
| `body.ligatures` | `normal`、`none` | `normal`，只控制可选连字 | S |
| `body.font_synthesis` | `none`、`weight`、`style`、`weight-style` | `weight-style` | S |
| `body.text_color` | color | `#1f2933` | S |
| `body.background_color` | color | `#ffffff` | S |
| `body.link_color` | color | `#2563eb` | S |
| `body.text_direction` | `auto`、`ltr`、`rtl` | `auto` | S |
| `body.writing_mode` | `horizontal-tb`、`vertical-rl`、`vertical-lr` | `horizontal-tb` | S |
| `body.text_orientation` | `mixed`、`upright` | `mixed`；横排时不生效但保留 | S |
| `body.text_align` | align | `start` | S |

text_direction 控制正文双向文本的基准方向。auto 对各段落按首个强方向字符判定，无强方向字符时回退 ltr；不得倒序排列字符。reading.direction 只控制展示单元的排布，两者独立。竖排仍保留源字符、段落顺序、图像与代码内容；目标不支持竖排时必须报告，不能悄悄横排后称为完整应用。

竖排且 text_orientation=upright 时，采用所引用 CSS Writing Modes 的直立排字语义，实际 inline 方向为 ltr；text_direction 的声明值保留，恢复 mixed 或横排时继续按它解释。这里的 ltr 在竖排行内轴对应从上到下，不改变 reading.direction 的左右配对，也不改写源字符顺序。[直立排字与方向](https://www.w3.org/TR/2019/REC-css-writing-modes-3-20191210/#valdef-text-orientation-upright)

正文基础字体样式不取消 Markdown 的强调：em 请求斜体，strong 请求至少 700 的字重（基础字重更高则保留），删除线保留其语义和装饰。嵌套相同强调不重复增加字重，也不翻转成常规体；字体合成仍受 font_synthesis 限制。

改变字距、禁用可选连字和文本对齐只影响呈现，不改写字符。不得禁用文字正确塑形所必需的连结处理。generic 字体、自动字距及不同排版器可能产生不同字形和分页，本文不承诺像素一致。

## 5. 段落：paragraph

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `paragraph.first_line_indent` | nonnegative，em | 0 | S |
| `paragraph.indent_first` | bool | false，是否缩进文稿首个普通段落 | S |
| `paragraph.indent_after_heading` | bool | false，是否缩进紧随标题的普通段落 | S |
| `paragraph.spacing_before` | nonnegative，em | 0 | S |
| `paragraph.soft_break` | `space`、`line-break` | `space` | S |
| `paragraph.hyphens` | `none`、`manual`、`auto` | `manual` | S |
| `paragraph.word_break` | `normal`、`break-all`、`keep-all` | `normal` | S |
| `paragraph.overflow_wrap` | `normal`、`anywhere` | `anywhere` | S |
| `paragraph.widows` | positive-int | 2 | S，分页时 |
| `paragraph.orphans` | positive-int | 2 | S，分页时 |

首行缩进只作用于普通段落，不作用于列表项、引用内段落、代码、表格单元格或图注。first_line_indent 为 0 时两个 indent 开关无效果但仍合法。首段和紧随标题的判断在各文稿内独立进行，视图附加的文稿标题不当作源码标题。

同时属于首个普通段落且紧随源码标题时，两个 indent 开关都为 true 才应用缩进；其他段落只受自己符合的条件约束。“紧随”按同一层级中紧邻的前一个 Markdown 块判定，空白行不是块。word_break、overflow_wrap、hyphens 作用于普通流式文字，不改代码的空白和换行规则；代码由 inline_code/code 节处理。

soft_break 只控制 CommonMark 软换行的视觉处理，硬换行始终保留。hyphens=auto 依赖作品语言及可用断词词典；缺少它们时报告并临时按 manual 预览，不能在出版中无提示替代。生成的断词符不得写回源码或原文复制内容。[CSS Text 的断词定义](https://www.w3.org/TR/2026/CRD-css-text-3-20260814/#hyphenation)

widows/orphans 是跨页时尽量保留的段末／段首行数；无法同时满足页面容纳和这些约束时允许放宽并报告，不能丢行、创建无限空白页或缩小正文逃避限制。连续预览中不生效。

## 6. 标题：headings 与 headings.h1–h6

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `headings.font` | font-ref | 继承 body.font | S |
| `headings.font_family` | family | 继承 body.font_family | S |
| `headings.text_color` | color | 继承 body.text_color | S |
| `headings.font_weight` | integer，1–1000 | 700 | S |
| `headings.line_height` | positive，字号倍数 | 1.3 | S |
| `headings.letter_spacing` | finite，em | 0 | S |
| `headings.text_align` | align | `start` | S |
| `headings.spacing_before` | nonnegative，em | 1.5 | S |
| `headings.spacing_after` | nonnegative，em | 0.6 | S |
| `headings.keep_with_next` | bool | true，分页时尽量不与下一块分离 | S |
| `headings.break_before` | `auto`、`page` | `auto` | S，分页时 |
| `headings.h1.size_scale` | positive，scale | 2 | S |
| `headings.h2.size_scale` | positive，scale | 1.6 | S |
| `headings.h3.size_scale` | positive，scale | 1.35 | S |
| `headings.h4.size_scale` | positive，scale | 1.15 | S |
| `headings.h5.size_scale` | positive，scale | 1 | S |
| `headings.h6.size_scale` | positive，scale | 1 | S |

每个 h1–h6 子表还可以覆盖上述 headings 公共字段，类型和语义相同。size_scale 只允许出现在 h1–h6 子表，放在 headings 根表属于不适用字段错误。字号、颜色、分页均不改变标题等级、锚点或目录结构。

page 表示该标题开始前请求新页，已经在空白页起点则不再插页；fixed 单节点页面不能容纳所请求的额外分页时，该次出版失败。keep_with_next 与章节分页、widows/orphans 都只是排版约束，不允许改正文。强制分页先于避免分页；无法满足的软约束按段落规则报告。

## 7. 链接：links

链接基础颜色唯一取自 body.link_color，不设置另一个 links.color 别名。

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `links.underline` | bool | true | S |
| `links.underline_style` | `solid`、`dotted`、`dashed`、`wavy` | `solid` | S |
| `links.underline_offset` | nonnegative，em | 0.1 | S |
| `links.visited_color` | color | 继承 body.link_color | V |
| `links.external_mark` | `none`、`arrow` | `none`；arrow 显示附加的 ↗ | R |
| `links.break_long_urls` | bool | true | S |

external_mark 只标示 HTTP(S) 导航，不修改目标或复制文本；出版可省略该阅读提示。visited 状态在本机维护，不写入工程，不触发网络访问。break_long_urls 只为显示文本本身为 URI 的自动链接或普通文本链接提供必要的任意字符换行机会，不作用于“点击这里”等标签，不启用裸网址自动链接化。false 仅取消这条额外规则，正文 overflow_wrap 仍按自身配置生效。换行不在 URL 字符中插入真实空格。

## 8. 行内代码：inline_code

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `inline_code.font` | font-ref | `generic` | S |
| `inline_code.font_family` | family | `monospace` | S |
| `inline_code.size_scale` | positive，scale | 0.9 | S |
| `inline_code.text_color` | color | 继承 body.text_color | S |
| `inline_code.background_color` | paint | `#eef2f7` | S |
| `inline_code.border_color` | color | `#d8e0eb` | S |
| `inline_code.border_width` | nonnegative，px | 0 | S |
| `inline_code.radius` | nonnegative，px | 3 | S |
| `inline_code.padding_inline` | nonnegative，em | 0.25 | S |
| `inline_code.padding_block` | nonnegative，em | 0.1 | S |

不改变 CommonMark 对代码跨度的空白解释，不自动断词或替换标点。行内代码在排版区域中无法容纳时应保留内容并处理溢出，不隐式缩略。

## 9. 代码块：code 与 code.palette

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `code.font` | font-ref | `generic` | S |
| `code.font_family` | family | `monospace` | S |
| `code.size_scale` | positive，scale | 0.9 | S |
| `code.line_height` | positive，字号倍数 | 1.5 | S |
| `code.text_color` | color | 继承 body.text_color | S |
| `code.background_color` | paint | `#f5f7fb` | S |
| `code.border_color` | color | `#d8e0eb` | S |
| `code.border_width` | nonnegative，px | 1 | S |
| `code.radius` | nonnegative，px | 4 | S |
| `code.padding` | nonnegative，px | 12 | S |
| `code.wrap` | bool | false | S |
| `code.tab_size` | positive-int | 4，显示宽度，不把制表符写成空格 | S |
| `code.line_numbers` | bool | false | S |
| `code.line_number_start` | positive-int | 1，每个代码块重新开始 | S |
| `code.line_number_color` | color | `#64748b` | S |
| `code.show_language` | bool | false，使用围栏信息字符串的首个非空白词作标签 | S |
| `code.syntax_highlight` | bool | true | S |

| 字段 | 类型 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `code.palette.comment` | color | `#64748b` | S |
| `code.palette.keyword` | color | `#7c3aed` | S |
| `code.palette.string` | color | `#047857` | S |
| `code.palette.number` | color | `#b45309` | S |
| `code.palette.function` | color | `#1d4ed8` | S |
| `code.palette.type` | color | `#0f766e` | S |
| `code.palette.operator` | color | `#334155` | S |
| `code.palette.punctuation` | color | `#475569` | S |

高亮只是装饰，不保证不同词法分析器的 token 边界相同。未知语言、无法分类的片段用 code.text_color，不自动安装插件或下载语法定义。syntax_highlight=false 时忽略 palette 但保留配置。

行号与语言标签不加入源码、搜索文本或“复制代码”的内容。wrap=false 时屏幕允许沿 inline 轴滚动；出版必须检查整行是否能容纳，不能把滚动窗口截成图片。wrap=true 允许为容纳长行而视觉折行，续行不产生新行号、不插入源码换行。行号基于 Markdown 解析后的代码块内容；真空行按一行计数，块末尾单个换行终止符不额外制造一个空白编号行。tab_size 是以空格前进宽度为单位的制表位间隔；语言标签只是文本，不能插入 HTML。

## 10. 引用块：quote

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `quote.font_style` | `normal`、`italic` | `normal` | S |
| `quote.text_color` | color | 继承 body.text_color | S |
| `quote.background_color` | paint | `none` | S |
| `quote.border_color` | color | `#cbd5e1` | S |
| `quote.border_width` | nonnegative，px | 3，inline-start 侧竖线／逻辑边线 | S |
| `quote.padding_inline` | nonnegative，em | 1 | S |
| `quote.padding_block` | nonnegative，em | 0.25 | S |
| `quote.nesting_indent` | nonnegative，em | 1，嵌套一级的附加逻辑缩进 | S |

不改变引用层级。边框为 0 仍保留语义；不能因窄屏把嵌套内容省略。引用中的普通文字使用 quote.text_color；内含标题、链接、代码及列表标记等继续使用各自最终样式，包括各自表中明确声明的 body 继承值，不被 quote 再次覆盖。

## 11. 列表与任务：lists、tasks

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `lists.indent` | nonnegative，em | 1.5，每个嵌套层级 | S |
| `lists.item_spacing` | nonnegative，em | 0.25 | S |
| `lists.unordered_marker` | `disc`、`circle`、`square` | `disc` | S |
| `lists.ordered_marker` | `source`、`decimal`、`lower-alpha`、`upper-alpha`、`lower-roman`、`upper-roman` | `source` | S |
| `lists.marker_color` | color | 继承 body.text_color | S |
| `tasks.checkbox_size` | positive，em | 1 | S |
| `tasks.checkbox_gap` | nonnegative，em | 0.5 | S |
| `tasks.marker_color` | color | 继承 body.link_color | S |
| `tasks.completed_style` | `normal`、`line-through` | `normal` | S |
| `tasks.completed_color` | color | 继承 body.text_color | S |

source 使用 Markdown 解析得到的有序列表起始值和点号／右括号分隔形式；其他样式只格式化解析后的序号，不能重置 start、倒排内容或修改源码。字母／罗马数字的表示范围和超范围回退按固定版本的 [CSS 预定义计数样式](https://www.w3.org/TR/2021/CR-css-counter-styles-3-20210727/#predefined-counters)。

紧列表与松列表的区别继续由 Markdown 语法决定。任务框的 checked 状态来自源码；settings 不能替换状态，也不能决定读者是否有编辑权限。completed 样式不把任务内容从阅读、搜索或出版中去掉。

completed 样式只作用于当前已勾选任务项的首个段落标签，不沿父子列表继承到其他任务，也不改变后续块的样式；标签中的链接、代码颜色仍按各自组件规则处理。未勾选的子任务不能因父任务完成而呈现为已完成。

## 12. 表格：tables

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `tables.size_scale` | positive，scale | 1 | S |
| `tables.line_height` | positive，字号倍数 | 1.5 | S |
| `tables.cell_padding_inline` | nonnegative，em | 0.75 | S |
| `tables.cell_padding_block` | nonnegative，em | 0.5 | S |
| `tables.border_color` | color | `#d8e0eb` | S |
| `tables.border_width` | nonnegative，px | 1 | S |
| `tables.header_background_color` | paint | `#f1f5f9` | S |
| `tables.header_text_color` | color | 继承 body.text_color | S |
| `tables.header_font_weight` | integer，1–1000 | 700 | S |
| `tables.stripe_background_color` | paint | `none` | S |
| `tables.default_align` | `start`、`end`、`center` | `start` | S |
| `tables.width` | `auto`、`full` | `auto` | S |
| `tables.overflow` | `scroll`、`wrap` | `scroll` | V |

列在 Markdown 中显式指定的对齐优先于 default_align。条纹以表体第一行为 1，从第 2 行开始给偶数行绘制背景；不把表头计入。相邻单元格共享边框，不叠加为两倍宽度。

width=auto 使用内容所需的内在宽度，full 至少填满可用 inline 尺寸；两者都不能隐含删列。overflow=scroll 允许表格超过可用 inline 尺寸并滚动；wrap 约束表格尽量容纳在可用 inline 尺寸内，为普通单元格文字增加必要换行机会。显式源码换行始终保留，代码跨度仍按行内代码规则；无法容纳时报告溢出并保留可访问内容，不裁切。表头的对齐服从列定义，颜色及字重服从 header 字段。

出版不采用 V 作用域的 scroll 行为，而在页面内尝试自动列宽与文本换行；无法完整排版时失败。不支持列宽指定、合并单元格或表格内新的内容语法；这些不能通过外观设置伪装成普通 GFM 表格。

## 13. 图片与图注：images

图像适应方式唯一取自 reading.image_fit；images 不另设 fit 别名。图片保留 Markdown 替代文本，任何设置都不得把它清空。

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `images.max_width` | positive，百分数，不超过 100 | 100，所在内容区域物理宽度的比例 | S |
| `images.max_height` | nonnegative，px | 0，表示无额外物理高度上限 | S |
| `images.upscale` | bool | false，位图按固有像素一像素对应一 CSS px 限制放大；矢量图不受像素放大限制 | S |
| `images.align` | `start`、`end`、`center` | `center` | S |
| `images.frame_ratio` | nonnegative | 0 使用固有宽高比；正值是物理宽／高 | S |
| `images.spacing_before` | nonnegative，em | 0.5 | S |
| `images.spacing_after` | nonnegative，em | 0.5 | S |
| `images.border_color` | color | `#d8e0eb` | S |
| `images.border_width` | nonnegative，px | 0 | S |
| `images.radius` | nonnegative，px | 0 | S |
| `images.caption_source` | `none`、`title`、`alt` | `none` | S |
| `images.caption_size_scale` | positive，scale | 0.875 | S |
| `images.caption_color` | color | 继承 body.text_color | S |
| `images.caption_align` | `start`、`end`、`center` | `center` | S |
| `images.caption_gap` | nonnegative，em | 0.5，相对于图注字号 | S |

max_width/max_height 约束含边框的物理外宽／外高；先扣除两侧 border_width，再为图像建立内框。frame_ratio 是内框的物理宽／高；0 使用图片固有比例。width 始终使用固有比例显示完整图片，忽略 frame_ratio；这一组合合法，须在设置说明中标明。尺寸约束无法留下正面积时报告布局失败，不能将图片缩成不可访问的零面积对象。

先按所用比例求满足宽高上限的最大内框，再计算 contain 的等比缩放（两个轴缩放比例取较小值）或 cover 的等比缩放（取较大值）；width 按固有比例适配可用宽度。contain 的留白和 cover 的裁切都以框中心为基准。位图在 upscale=false 且计算缩放超过 1 时，将整个内框等比缩小到图像缩放恰为 1，保持框比例；不能一边承诺 cover 填满框、一边禁止放大却留下任意空白。位图固有尺寸以解码并应用图片方向后的尺寸为准。

矢量图用其固有尺寸或比例参与布局，允许无损缩放；仅有比例时用可用区域确定框大小。既无固有比例也无法由解码器确定有效比例时报告无法完整布局，而不凭空裁切。圆角只裁切图像框，不裁切图注和其他 Markdown 内容。

align、spacing_before/after 和图注只作用于独占段落的图片；嵌在文字、链接或表格单元格内的图片保持行内布局，仍应用尺寸、边框和图像框设置，不自动拆段。caption_source=title 取 Markdown 图片 title，alt 取其解析后的纯文本替代内容；缺失或空文本不生成图注，不交叉回退。图注不写入源码，也不把原有文本删除为“重复内容”。

## 14. 分隔线：thematic_break

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `thematic_break.color` | color | `#cbd5e1` | S |
| `thematic_break.style` | `solid`、`dashed`、`dotted` | `solid` | S |
| `thematic_break.thickness` | positive，px | 1 | S |
| `thematic_break.width` | positive，百分数，不超过 100 | 100，居中显示 | S |
| `thematic_break.spacing_before` | nonnegative，em | 1.5 | S |
| `thematic_break.spacing_after` | nonnegative，em | 1.5 | S |

只作用于 Markdown 已解析出的 thematic break，不把连续连字符的其他用途改成分隔线。

## 15. 预览画布：preview

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `preview.layout` | `continuous`、`document` | comic 为 document，其他为 continuous | V |
| `preview.max_width` | positive，px | 720，单个文稿显示框最大外宽 | V |
| `preview.viewport_height` | positive，px | 960，document 视图建议外高 | V |
| `preview.padding_block` | nonnegative，px | 24 | V |
| `preview.padding_inline` | nonnegative，px | 32 | V |
| `preview.canvas_color` | color | `#f3f6fb` | V |
| `preview.document_gap` | nonnegative，px | 24，连续视图中展示组之间 | V |
| `preview.spread_gap` | nonnegative，px | 24，同一组两个文稿框之间 | V |
| `preview.border_color` | color | `#d8e0eb` | V |
| `preview.border_width` | nonnegative，px | 0 | V |
| `preview.radius` | nonnegative，px | 0 | V |

continuous 连续显示全部展示组；document 显示当前组并提供访问其他组的方式，组内长文稿须能完整滚动，不能截断为“一张图片页”。具体按钮、翻页动画和滚动位置不进文件。

max_width/viewport_height 是屏幕建议值，不是纸张尺寸。框内正文背景取 body.background_color，框外取 canvas_color。连续视图中高度由内容决定；document 视图的建议高度不限制正文长度。

在建议尺寸下必须留有正的内容区：按当前 writing_mode 将逻辑 padding 映射到物理轴后，左右 padding 加两侧 border 必须小于 max_width；仅在 document 视图中，上下 padding 加两侧 border 还必须小于 viewport_height。continuous 不使用建议高度作几何约束，仍检查该字段类型。任一适用关系不满足时，临时回退 writing_mode 以外的整个 preview 几何组（max_width、viewport_height、两种 padding、border_width）到缺省值，并报告；不自动改文件。

小屏幕允许减少可见框宽并折叠双栏为单栏；这属于响应式预览，不改 reading.spread 或目录顺序。若连 padding 都无法容纳，可临时缩减到可用尺寸并提示。不得为了满足作者建议尺寸隐藏内容。

## 16. 阅读编排：reading

| 字段 | 类型 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `reading.direction` | `ltr`、`rtl` | `ltr` | R |
| `reading.spread` | `single`、`double` | `single` | R |
| `reading.image_fit` | `contain`、`cover`、`width` | `contain` | S |
| `reading.show_toc` | bool | book 为 true，其他为 false | R |
| `reading.chapter_numbering` | bool | book 为 true，其他为 false | R |
| `reading.first_single` | bool | false | R |
| `reading.show_project_title` | bool | false | R |
| `reading.show_creators` | bool | false | R |
| `reading.show_description` | bool | false | R |
| `reading.show_cover` | bool | false | R |

`direction`、`spread`、`first_single` 与模式无关；`default` 同样可双页、RTL。`first_single` 仅在 `double` 下生效：第一个正文节点以单页展示框的宽度单独显示，并在双页展示区域中水平居中；不拉伸成双页宽度。从第二个正文节点开始配对；配对后剩余的末项放在双页组的首项位置（`ltr` 为左、`rtl` 为右）。`single` 时保留但不执行 `first_single`。具体顺序与主规范第 7 节一致。

书名、创作者、简介、封面取自 mdk.toml.metadata，缺省信息不自动编造；它们是阅读序列前的附加区域，不占正文节点，不参与双页配对。它们的显示开关不决定出版物是否包含封面或目录。损坏的已声明封面照常报告，不用隐藏开关绕过依赖检查。

`reading.direction`、`reading.spread`、`reading.first_single` 可以映射到 EPUB `fixed` 的明确字段；其余 R 开关不直接控制出版的封面、目录页或页眉。`reading.image_fit` 按图片规则参与正文预览与输出。

## 17. 文稿显示名、导航目录和编号

正文节点显示名严格按主规范第 6.2 节的集中回退链解析；这里不再设置另一个 title 文本字段。分组节点使用自己的 title。

| 字段 | 类型／单位 | 缺省值 | 作用域 |
| --- | --- | --- | --- |
| `document_title.show` | bool | false | R |
| `document_title.size_scale` | positive，scale | 1.5 | R |
| `document_title.font_weight` | integer，1–1000 | 700 | R |
| `document_title.text_align` | align | `start` | R |
| `document_title.text_color` | color | 继承 body.text_color | R |
| `document_title.spacing_before` | nonnegative，em | 0 | R |
| `document_title.spacing_after` | nonnegative，em | 1 | R |
| `toc.source` | `outline`、`headings`、`both` | `outline` | R |
| `toc.include_groups` | bool | true | R |
| `toc.max_node_depth` | integer，0–2,147,483,647 | 0，表示不主动截断层级 | R |
| `toc.heading_min_level` | integer，1–6 | 1 | R |
| `toc.heading_max_level` | integer，1–6 | 3 | R |
| `numbering.format` | 单行纯文本模板 | `{path} ` | R |

document_title 只增加附加标签，不把它作为源码标题、标题锚点或正文的一部分。即使与正文首个标题相同，也不得隐藏那个源码标题。出版正文默认只使用源标题；出版导航仍按目录对象的名称表达。

toc.source=outline 展示目录节点；headings 按阅读序列展示各次文稿出现中的标题，以文稿显示名作为分组标签；both 在对应正文节点下附加标题导航。重复展示文稿中的标题必须指向该次出现，不丢失节点语境。标题层级跳级只影响导航缩进，不制造新的源码标题。

max_node_depth 过滤节点深度，根深度为 1；headings 模式也只纳入该深度内的正文节点。include_groups 仅对 outline/both 的分组节点标签生效；false 只隐藏标签并提升可见子级，不改变原始深度、阅读顺序和编号。标题最小等级不得大于最大等级；冲突时整对临时回退 1/3。隐藏目录或目录项不隐藏对应正文。

numbering.format 仅允许 `{path}`（按原始目录生成的点分显示编号）和 `{index}`（该节点在原始同级排序中的 1 起序号）。可写 `第{path}章 `，必须至少包含一个占位符；允许重复使用这两个占位符，其余字符不得含 `{`、`}`、Unicode Cc 控制字符或 U+2028/U+2029。未配对花括号也非法，不设转义或表达式语法。仅在 chapter_numbering=true 时，为目录节点标签、headings 导航中的文稿分组标签和已显示的 document_title 加前缀；不编号正文标题，不改变锚点或源码有序列表。

## 18. 不纳入 settings 的项目

| 内容 | 归属 |
| --- | --- |
| mode、标题、作者、语言、封面路径、能力声明 | mdk.toml |
| 正文 ID、目录节点、顺序、层级、目录显示名 | contents.toml |
| 纸张尺寸、出版边距、封面页、目录页、页眉页脚、输出格式和文件路径 | 出版配置或本次操作；路径与覆盖授权不随工程携带 |
| 编辑器主题、暗色／护眼显示、个人字号覆盖、缩放、滚动、窗口位置、键位、工具栏、自动保存 | 本机偏好或可重建状态 |
| 勾选任务、折叠正文、脚注／公式／容器语法是否启用 | 源码、视图状态或单独的语法能力；不由外观字段改变 |
| 自动联网、加载远程字体、自动播放、执行 HTML／脚本 | 不允许通过工程设置授权 |
| 任意 CSS、选择器、插件路径、运行命令、任意可变字体轴 | 独立受控扩展，不能冒充本目录中的普通字段 |

批注、脚注、数学、提示容器的样式随相应扩展定义，写在它们的命名空间中；本文不提前设置会隐含启用这些语法的根表。图片查看的缩放按钮、复制按钮、目录当前位置等由阅读器决定。

## 19. 回退、校验与检查用例

沿用主规范：非法 TOML 整份暂停解释；字段类型错误只临时回退对应字段；表类型错误回退该表；未知字段保留。以下关联规则优先于单字段回退：

- 重复字体集 ID 只使该重复 ID 的引用不明确；保留数据，不挑第一个。其他唯一且合法的字体集继续可用。缺失／非法 ID 的条目不能被 @ 引用。font_sets 不是表数组时暂停整个登记表，但直接字体路径不因此失效。
- 字体集或 font-ref 错误在预览时回退该元素 generic 字体并报告；出版检查最终生效的源，不能借预览回退伪装指定字体已应用。
- preview 几何冲突和 toc 等级冲突按各节的组规则回退。
- 某功能关闭时仍检查已知字段的类型和语法，合法但不适用的值保留。缺失的资源只在被相关检查范围引用时判断依赖，不因关闭一个开关删除文件。
- 不支持某项高级能力与字段非法必须分别报告。部分支持的预览器可暂用默认表现；出版器不能静默忽略参与输出的已配置设置后宣称完整应用。

应至少检查：正文覆盖后的标题继承、数组替换、字体集重复／缺失、竖排与 RTL 双页互不混淆、首篇单独与奇数末项、目录标签隐藏但编号稳定、六级标题独立样式且锚点不变、代码换行与复制原文、GFM 表格显式对齐优先、图注不拆行内图片、cover 只裁图不裁文字、预览画布不影响纸张，以及修改样式后未编辑 Markdown 字节不变。

以下边界须得到确定结果：

| 输入／操作 | 预期 |
| --- | --- |
| body 字号 20，tables.size_scale=1.5，inline_code.size_scale=0.9 | 表内行内代码为 18px，不是 27px。 |
| 工程 h1 颜色为红，预设只把 headings 公共颜色改为蓝 | h1 保留红色，未单独设置的其他级采用蓝色。 |
| 常规与粗体分别登记 400/700，请求字重 501 | 选择 700，不按绝对差值选 400。 |
| 字体集 A 的 ID 重复，但 B 唯一且合法 | A 的 @ 引用报错；B 仍可解析，不任意选择 A 的首项。 |
| 200×100 位图、方框、cover、upscale=false，可用宽度 400px | 无边框时内框缩为 100×100，原图不放大并居中裁切。 |
| 普通首段紧随标题，indent_first=false、indent_after_heading=true | 不缩进，不能由开关处理顺序决定。 |
| 完成的父任务包含未完成子任务 | 父标签可划线，子任务保持自己的状态和样式。 |
| continuous 视图建议高度小于上下 padding 之和 | 类型合法时不触发高度几何错误；切为 document 后才检查。 |
| 竖排 upright，正文方向声明 rtl，阅读方向 rtl | 字符使用直立排字的实际行内方向；正文方向声明保留，双页仍右侧先读。 |
| 编号模板含孤立 `{` 或未知 `{name}` | 字段非法；预览临时回退并报告，不执行插值。 |

根 `extensions` 表沿用主规范命名空间规则，缺省为空；不需要新增顶层 schema_version。本文作为标准能力直接扩展主规范预留的 settings 字段目录；第三方新增设置仍放在自身 extensions 命名空间中。

局部编辑按主规范第 10.3 节处理：修改项及其受影响的关联约束必须合法，不引入新错误；未触及且不受影响的既有错误按原值保留并继续报告。整份重新生成或替换仍须校验全部已知字段。临时回退值不自动写回，也不作为出版已经确认的设置。

## 20. 范围说明

完整模板列出独立字段；六级标题的公共覆盖项按统一规则可重复使用，不为每种组合发明新字段。模板里的显式颜色和字体值会固定这些值，不等于省略字段时的动态继承。字体资源段以注释提供，避免模板凭空依赖不存在的资源。

这是数据模型和行为设计，不表示现有 Mardikor 已支持这些字段。标准字段的准确类型与范围以本文表格和约束为准；应用可以提供较窄的控件范围，但不得把控件上限当成格式合法性上限。
