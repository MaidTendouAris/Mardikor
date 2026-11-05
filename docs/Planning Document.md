# Mardikor Planning Document

## 1. 当前优先级

当前执行 Electron + TypeScript 7 + React 迁移和现代化界面重构。`.mdk` v1 核心规范保持不变；实现以 `MDK Format Specification v1.md` 为准，避免围绕旧的 `book.toml` / `theme.toml` 结构开发。迁移记录与验证方式见 `MIGRATION.md`。格式行为以 2026-11-03 修订规范为准；book/comic 共用 Markdown 基础模型，普通保存与严格交付分开，默认保留持久及未知 meta。

## 2. 产品定位

Mardikor 是面向创作者的桌面创作工程编辑器。它的核心不是只服务“书籍”，而是提供一个可编辑、可恢复、可校验、可导出的通用创作工程容器。

早期重点仍可优先服务长文档和电子书创作，但 `.mdk` 文件格式本身必须为漫画、脚本、课程、参考资料、互动文本等后续用途预留空间。

## 3. MDK v1 格式基线

### 3.1 整体结构

```text
byte 0-1      mode 文件头，两位 ASCII 十六进制数
byte 2...     ZIP payload
```

`mode` 位于 `.mdk` 文件级头部，不进入 ZIP。`mimetype` 仍然是 ZIP payload 内部的第一项。

### 3.2 mode 映射

| mode      | 用途     | 说明                                                         |
| --------- | -------- | ------------------------------------------------------------ |
| `00`      | default  | 通用工程或未指定用途工程。                                   |
| `01`      | book     | 书籍工程，覆盖小说、非虚构、长文档、教材等线性阅读内容。     |
| `02`      | comic    | 漫画工程，覆盖页面、分镜、图片序列、对白脚本等图像叙事内容。 |
| `03`-`FF` | reserved | 预留给未来用途。                                             |

原 `mode = 01` 的 `novel` 映射废弃，统一更名为 `book`。

### 3.3 目录结构

内部文件夹名不因 `mode` 不同而变化。

```text
project.mdk
├── [file header] mode = "00"
└── [zip payload]
    ├── mimetype
    ├── contents.toml
    ├── settings.toml
    ├── markdown/
    │   ├── 001.md
    │   └── ...
    ├── resources/
    │   ├── image/
    │   ├── video/
    │   ├── audio/
    │   ├── font/
    │   └── other/
    └── meta/
        ├── annotations.json
        └── editor-state.json
```

`settings.toml` 是正常工程推荐包含的设置文件，但不属于最小合法 `.mdk` 的必需文件。`meta/` 可完全省略。

### 3.4 必需文件

旧设计中的 `book.toml` 和 `theme.toml` 废弃。

最小合法 `.mdk`：

```text
mode 文件头: "00"

zip payload:
├── mimetype
└── contents.toml
```

最小 `contents.toml`：

```toml
schema_version = 1
```

### 3.5 contents.toml 职责

`contents.toml` 只控制目录。

它不控制：

- 样式
- 排版
- 预览偏好
- 导出偏好
- 编辑器偏好
- mode 专属设置
- 应用设置
- 资源索引表

这些内容由 `settings.toml`、软件本体内置默认设置、应用级配置或用户偏好提供。

### 3.6 contents.toml entries

```toml
schema_version = 1

[[entries]]
id = "01JZ8F8V7K9Y3M5P0Q2R6T1A4B"
path = "markdown/001.md"
position = "1"

[[entries]]
id = "01JZ8F92N6C4X8Q1V7W3D5E0K2"
path = "markdown/chapter-two.md"
position = "2"

[[entries]]
id = "01JZ8F9G8M2B6Y4T1N0C7P5Q3X"
path = "markdown/chapter-two-note.md"
position = "2.1"
```

| 字段       | 类型   | 必需 | 说明                                                                     |
| ---------- | ------ | ---- | ------------------------------------------------------------------------ |
| `id`       | string | 是   | 稳定 ID，由编辑器生成和维护，对用户隐藏。                                |
| `path`     | string | 是   | 目录项指向的 Markdown 文件路径，必须位于 `markdown/` 下并以 `.md` 结尾。 |
| `position` | string | 是   | outline-path 目录位置，如 `1`、`2.1`、`2.1.3`。                          |

`position` 最多 6 层，对应 Markdown `h1` 到 `h6` 的层级概念。父子关系由 `position` 直接表达，不依赖相邻条目推断。

### 3.7 settings.toml 职责

`settings.toml` 用于控制样式、排版、预览、导出偏好和 mode 专属偏好。正常 `.mdk` 工程推荐包含该文件；最小合法 `.mdk` 可以不包含。

```toml
schema_version = 1

[appearance]
theme = "default"
font_family = "system"
font_size = 16
line_height = 1.7
paragraph_spacing = 0.8

[layout]
page_width = 720
margin_top = 32
margin_bottom = 32
margin_left = 32
margin_right = 32

[colors]
text = "#1f2933"
background = "#ffffff"
link = "#2563eb"
quote = "#64748b"

[preview]
show_title = true
show_toc = true
render_containers = true

[export]
default_target = "mdk"
validate_before_export = true
include_meta = true
include_editor_state = false
preserve_source_names = true

[export.mdk]
package_mode = "portable"
overwrite_existing = false
normalize_paths = true

[mode.book]
toc_depth = 3
split_by_heading = false
chapter_numbering = true

[mode.comic]
reading_direction = "ltr"
page_fit = "contain"
spread_mode = "single"
```

缺失 `settings.toml` 或缺失字段时，读取器应套用软件本体默认设置。

## 4. 技术选型

| 类别           | 选型                             | 说明                                                                             |
| -------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| 桌面框架       | Electron                         | 主进程处理文件和窗口，sandbox preload 提供受限 IPC。                             |
| 前端框架       | React + TypeScript 7             | 负责 UI、编辑器交互和状态管理。                                                  |
| 构建工具       | Vite + esbuild                   | 分别构建渲染器和主进程 / preload。                                               |
| 状态管理       | React hooks                      | 管理工程、脏标记、目录、源码与偏好。                                             |
| 页面导航       | React 工作区导航                 | 创建、编辑、交付、设置；切换页面保留编辑状态。                                   |
| UI 组件        | 原生语义组件 + CSS               | 蓝色强调色、纯白文稿纸张、浅灰工作区。                                           |
| 图标           | lucide-react                     | 工具栏和操作按钮图标。                                                           |
| 编辑器内核     | Monaco Editor                    | 复用 VS Code 编辑组件的编辑、查找替换、折叠、撤销、多光标及语言服务。            |
| 文稿与文件树   | React Arborist                   | 显式层级、虚拟化、键盘导航、子树拖动；文稿目录与整体目录分别反映逻辑和物理结构。 |
| 辅助可视化编辑 | Tiptap / ProseMirror             | 基础 Markdown 可视化编辑；扩展语法使用 Monaco 保留原文。                         |
| Markdown 往返  | Tiptap Markdown 扩展             | 编辑器内容与 Markdown 文本互转。                                                 |
| 预览渲染       | markdown-it                      | Markdown 预览渲染。                                                              |
| 源码编辑       | Monaco + 共享 MDK 校验           | 编辑 `.md`、`.toml`、`.json` 等 UTF-8 文本，控制文件校验并与目录/设置双向同步。  |
| 后端语言       | TypeScript 7 / Node.js           | `.mdk` 容器读写、校验、导出、资源处理。                                          |
| 容器格式       | 2 字节 mode 文件头 + ZIP payload | 快速识别用途，同时保持 ZIP 工程包能力。                                          |
| 配置格式       | TOML                             | `contents.toml` 控制目录；`settings.toml` 控制设置。                             |
| 本地数据       | 主进程 JSON 状态文件             | 最近工程与应用偏好原子写入，不要求本地编译扩展。                                 |

## 5. 路线图

| 阶段 | 目标             | 里程碑                                                                        |
| ---- | ---------------- | ----------------------------------------------------------------------------- |
| E0   | 项目地基         | Electron + React + TypeScript 7 + 基础页面、IPC、构建脚本。                   |
| E1   | `.mdk` 容器验证  | 按新 v1 规范实现 `mode + ZIP + contents.toml + settings.toml` 读写与校验。    |
| E2   | 单内容编辑器     | 打开/编辑/保存单个 Markdown entry，验证 Tiptap 往返，并提供源码模式。         |
| E3   | 多内容目录与资源 | entries 树、资源导入、孤儿资源检测。                                          |
| E4   | 设置与预览       | `settings.toml` 编辑、默认设置补齐、mode 专属默认策略、预览渲染。             |
| E5   | `.mdk` 交付导出  | 只导出 `.mdk`，完成打包、校验、另存为和便携交付。其他格式转换留到项目稳定后。 |
| E6   | 打磨与发布       | 错误恢复、自动保存、最近工程、deep-link、跨平台免安装构建。                   |

## 6. E1 重新定义

由于 `.mdk` 规范已从 `book.toml/theme.toml` 改为 `contents.toml/settings.toml`，E1 的任务需要重排。

| 任务                                                                                                                               | 端                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 实现 `.mdk` 文件头 `mode` 读写，两位 ASCII 十六进制。                                                                              | TypeScript / 主进程 |
| 实现 ZIP payload 读写，`mimetype` 必须首项 STORE 不压缩。                                                                          | TypeScript / 主进程 |
| 实现 `contents.toml` 序列化与反序列化。                                                                                            | TypeScript / 主进程 |
| 实现 `settings.toml` 序列化与反序列化。                                                                                            | TypeScript / 主进程 |
| 实现最小合法 `.mdk` 创建：`mode + mimetype + contents.toml`。                                                                      | TypeScript / 主进程 |
| 实现正常工程创建：额外包含 `settings.toml`。                                                                                       | TypeScript / 主进程 |
| 实现 `mode` 映射：`00 default`、`01 book`、`02 comic`。                                                                            | TypeScript / 前端   |
| 实现固定内部目录：`markdown/`、`resources/image/`、`resources/video/`、`resources/audio/`、`resources/font/`、`resources/other/`。 | TypeScript / 主进程 |
| 实现 `position` outline-path 校验，最多 6 层。                                                                                     | TypeScript / 主进程 |
| 实现缺失 `settings.toml` 和 `meta/` 时正常打开。                                                                                   | TypeScript / 主进程 |
| 准备 fixture：最小合法、正常 book、正常 comic、缺 `contents.toml`、非法 `position`、非法路径。                                     | 测试                |

验收：

1. 能创建并读取只包含 `mode + mimetype + contents.toml` 的最小合法 `.mdk`。
2. 能创建并读取包含 `settings.toml` 的正常 `.mdk`。
3. 能读取 book 示例和 comic 示例，并正确识别 mode。
4. 缺失 `theme.toml` 不再报错。
5. 缺失 `book.toml` 不再报错。
6. 缺失 `settings.toml` 不报错，并套用默认设置。
7. 缺失 `meta/` 不报错。
8. 缺失 `contents.toml` 必须报错。
9. `contents.toml` 不写入样式、排版或导出偏好。

## 7. 数据模型调整

前后端共享模型应从 `BookProject` 调整为更通用的 `MdkProject`。

| 字段       | 类型          | 说明                                             |
| ---------- | ------------- | ------------------------------------------------ |
| `path`     | `string`      | 当前 `.mdk` 文件路径。                           |
| `mode`     | `string`      | 文件头用途标识，如 `00` / `01` / `02`。          |
| `contents` | `MdkContents` | `contents.toml` 解析结果。                       |
| `settings` | `MdkSettings` | `settings.toml` 解析结果，缺失时由默认设置补齐。 |
| `entries`  | `MdkEntry[]`  | 通用目录项。                                     |
| `dirty`    | `boolean`     | 是否存在未保存变更。                             |

资源不再需要由 `contents.toml` 维护索引表。资源状态可由目录扫描、Markdown 引用分析和导出前校验得到。

## 8. IPC 边界调整

| 命令                    | 入参                                   | 返回                   | 阶段  |
| ----------------------- | -------------------------------------- | ---------------------- | ----- |
| `create_project`        | `path, mode`                           | `MdkProject`           | E1    |
| `open_project`          | `path`                                 | `MdkProject`           | E1    |
| `set_project_mode`      | `project_path, mode`                   | `SaveResult`           | E1    |
| `save_project_contents` | `path, contents`                       | `SaveResult`           | E1/E3 |
| `save_project_settings` | `path, settings`                       | `SaveResult`           | E1/E4 |
| `read_entry`            | `project_path, entry_id`               | `EntryContent`         | E2    |
| `save_entry`            | `project_path, entry_id, content`      | `SaveResult`           | E2    |
| `read_text_file`        | `project_path, internal_path`          | `TextFileContent`      | E2    |
| `save_text_file`        | `project_path, internal_path, content` | `SaveResult`           | E2    |
| `add_entry`             | `project_path, entry`                  | `MdkEntry`             | E3    |
| `delete_entry`          | `project_path, entry_id`               | `SaveResult`           | E3    |
| `reorder_entries`       | `project_path, entries`                | `SaveResult`           | E3    |
| `import_resource`       | `project_path, source_path, kind`      | `ResourceImportResult` | E3    |
| `validate_project`      | `project_path`                         | `ValidationReport`     | E1/E3 |
| `export_mdk`            | `project_path, output_path`            | `ExportResult`         | E5    |

## 9. 风险与约束

1. `.mdk` v1 规范必须先冻结，否则 E1 到 E5 会不断返工。
2. `contents.toml` 只控制目录，不应膨胀成配置、样式、资源数据库或导出偏好的集合。
3. `settings.toml` 可以缺失，但正常工程应创建并维护它。
4. `mode` 是用途标识，不是 schema 版本；兼容策略应分别处理。
5. `meta/` 可选，读取器不得依赖它完成基础打开。
6. 旧版 `book.toml/theme.toml` 可做迁移支持，但不应继续作为新文件的合法最小结构。
7. E5 阶段只做 `.mdk` 交付，不做 EPUB、PDF、网页包或其他格式转换。
8. 源码模式必须能编辑纯文本文件，但保存关键 TOML 文件前必须执行语法和结构校验。
