# Mardikor 命令行指南

本指南适用于 [MDK v2](<MDK Format Specification v2.md>)。

`mardikor` 直接读取和编辑 `.mdk` 工程，适用于 Linux 服务器、终端脚本和 AI 写作工作流。

## 安装

- **Windows 安装版**把安装目录中的 `bin` 加到 PATH。仅为当前用户安装时注册用户 PATH，为所有用户安装时注册系统 PATH。安装完成后重新打开终端，运行 `mardikor --version`。也可以直接运行安装目录下的 `bin\mardikor.exe`。
- **Linux** 需要 Node.js 22.12 或更新版本。将示例中的版本号换成实际归档的版本号。

```sh
npm install -g ./mardikor-cli-0.2.4.tgz
mardikor --version
```

从源码构建时，在 `Mardikor-Desktop/` 中运行 `npm ci` 和 `npm run dist:cli`。归档输出到该目录下的 `build-output/cli`。也可以直接运行 `node build-output/cli/package/bin/mardikor.cjs`。

Windows 单 EXE 便携版仅提供图形界面。

## 创建、读取和编辑

```sh
mardikor new "小说.mdk" --mode book
mardikor list "小说.mdk" --json
mardikor read "小说.mdk" "<文稿ID>"
mardikor read "小说.mdk" "<文稿ID>" --json
mardikor write "小说.mdk" "<文稿ID>" --if-revision "<修订号>" --from "第一章.md"
mardikor validate "小说.mdk"
```

`list --json` 返回工程 ID、修订号、`documents` 正文登记、`nodes` 目录节点和便于浏览的 `entries`。读写正文使用正文 ID 或文档节点 ID。目录移动和移除使用节点 ID。同一正文可由多个节点引用，顺序和文件名更改后 ID 保持稳定。`read --json` 返回对应的 `revision` 和 `markdown`。

`write`、`write-file` 和 `apply` 默认从标准输入读取，也接受 `--from <文件>`。`write` 自动识别 UTF‑8 和 GB18030，`write-file` 默认使用 UTF‑8。两者可用 `--encoding utf-8|gb18030|auto` 显式指定，新提交的文本以无 BOM 的 UTF‑8 写入。`apply` 的 JSON 使用 UTF‑8。

## 输入与容器限额

单次输入和单个工程内文件最多 **64 MiB**。MDK 容器及其解压后文件总量各自最多 **256 MiB**。通过标准输入分批传输仍计为同一次输入。较长文稿可拆成多个目录项，逐篇写入。

在 Linux 终端可以打开指定文稿进行编辑。

```sh
EDITOR=vim mardikor edit "小说.mdk" "<文稿ID>"
```

`edit` 使用 `$VISUAL`、`$EDITOR` 或 Linux 的 `vi`。环境变量和 `--editor` 都只填写会等待编辑结束的可执行文件路径。附加参数用 `--editor-arg` 逐项传入，例如 `--editor code --editor-arg=--wait`。提交冲突时错误信息包含草稿路径。

## 命令参考

| 命令                                                | 用途                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `new <工程> [--mode default\|book\|comic]`          | 创建工程和首篇文稿，遇到同名工程时拒绝覆盖                   |
| `list <工程>`                                       | 查看文稿 ID、层级位置和工程修订号                            |
| `read <工程> <ID>`                                  | 读取文稿原文                                                 |
| `write <工程> <ID>`                                 | 替换文稿正文                                                 |
| `edit <工程> <ID> [--editor <程序>]`                | 用终端或外部编辑器修改指定文稿                               |
| `add <工程> <文件名> [--after <ID>] [--title <显示名>]` | 新建文稿，可设置独立的目录显示名称                           |
| `rename <工程> <正文ID或节点ID> <文件名>`            | 重命名正文文件并更新已知引用。组节点 ID 用于重命名分组       |
| `group <工程> <名称> [--parent <节点ID>]`          | 添加独立分组，可指定父节点                                  |
| `remove <工程> <ID>`                                | 移除目录节点，子级提升一层，保留正文登记和文件               |
| `move <工程> <ID> <before\|after\|inside> <目标ID>` | 移动文稿及其子级                                             |
| `read-file <工程> <内部路径>`                       | 读取工程内的 Markdown、TOML 或其他 UTF‑8 文本                |
| `write-file <工程> <内部路径>`                      | 写入或创建工程内的 UTF‑8 文本                                |
| `apply <工程> [--quiet]`                            | 在一次保存中新增目录项、写入正文和调整目录位置               |
| `import <工程> <类型> <本地文件>`                   | 导入 image、video、audio、font 或 other 资源，返回工程内路径 |
| `validate <工程>`                                   | 检查容器、控制文件和资源引用                                 |
| `pack <输出工程> <解包目录>`                         | 读取目录中的 v2 控制文件并封装为标准 ZIP 工程              |
| `unpack <工程> <输出目录>`                          | 解包至新目录                                                |
| `deliver <工程> <输出工程>`                          | 校验基础内容并生成独立交付副本                              |
| `watch <工程> --json`                               | 输出当前修订号，之后每次变化输出一行 JSON                    |
| `unlock <工程>`                                     | 检查本机退出进程遗留的写入锁                                 |

改写现有工程的命令需要 `--if-revision <修订号>`。交互式 `edit` 会自动记录打开文稿时的修订号。写入成功后返回新的 `revision`。`deliver` 默认排除 `state/`，可用 `--include-state` 携带。剔除附加文件时，逐一传入 `--exclude <内部路径>`，并用 `--if-revision` 指定已核对的源工程修订号。

## AI 和脚本批量编辑

1. 用 `list --json` 取得文稿 ID 和修订号。
2. 用 `read --json` 读取目标正文，并记录此次读取的修订号。
3. 用 `write` 提交单篇，或用 `apply` 提交多篇正文和目录位置。传入变更所基于的修订号。
4. 用 `validate --json` 检查工程。发生冲突时重新读取内容，再决定如何合并。

`apply` 接受 `newEntries`、`writes` 和 `positions`，可组合提交。用 `newEntries` 一次建立多层目录项，避免逐条 `add` 重写容器。新文稿的 `path` 使用 `markdown/` 下的相对路径，`position` 使用 MDK 目录编号。可提供 `id`、`title` 和 `markdown`，省略 ID 时自动生成。提供 ID 且省略正文时，也可在同一批次通过 `writes` 写入。多个目录项指向同一个正文文件时，每次提交只写一次该文件。

```json
{
  "newEntries": [
    { "path": "markdown/scene-01.md", "position": "3.1", "title": "32:00:00", "markdown": "# 32:00:00\n" }
  ],
  "writes": [{ "id": "<文稿ID>", "markdown": "# 第一章\n\n修改后的正文。\n" }],
  "positions": [{ "id": "<文稿ID>", "position": "2.1" }]
}
```

```sh
mardikor apply "小说.mdk" --if-revision "<修订号>" --from changes.json --quiet
mardikor validate "小说.mdk" --json
```

`--quiet` 仅返回 `{"revision":"…"}`。节点标题与正文路径分别保存，`list --json` 可读取可选的 `display_name`。点分位置是界面序号，操作子级前需先有相应的父节点。

`--json` 的成功结果写到标准输出，命令错误以 `code`、`message` 写到标准错误。`validate --json` 即使报告含错误也会在标准输出返回完整报告。写入类命令默认返回 JSON，以便取得新修订号。`list --json` 的 `mode` 为 `default`、`book` 或 `comic`。运行 `mardikor <命令> --help` 查看单个命令用法。

| 退出码 | 含义                   |
| ------ | ---------------------- |
| `0`    | 操作成功               |
| `1`    | 工程校验或操作失败     |
| `2`    | 命令参数无效           |
| `3`    | 修订冲突或工程正被写入 |

桌面端和 CLI 共用写入锁。进程异常退出后可运行 `mardikor unlock "小说.mdk"`。该命令也识别旧版本只记录 PID 的文件锁。锁记录有效且本机 PID 已退出时才会删除。所有者无法确认时，请先核实所有写入均已结束，再手动清理工程旁的 `<文件名>.mardikor-lock`。
