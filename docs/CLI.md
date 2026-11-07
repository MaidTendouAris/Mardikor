# Mardikor 命令行指南

`mardikor` 直接读取和编辑 `.mdk` 工程，适用于 Linux 服务器、终端脚本和 AI 写作工作流。

## 安装

- **Windows 安装版**把安装目录中的 `bin` 加到 PATH。仅为当前用户安装时注册用户 PATH，为所有用户安装时注册系统 PATH。安装完成后重新打开终端，运行 `mardikor --version`。也可以直接运行安装目录下的 `bin\mardikor.exe`。
- **Linux** 需要 Node.js 22.12 或更新版本。将示例中的版本号换成实际归档的版本号。

```sh
npm install -g ./mardikor-cli-0.2.0.tgz
mardikor --version
```

从源码构建时，在仓库根目录运行 `npm ci` 和 `npm run dist:cli`。归档输出到 `build-output/cli`。也可以直接运行 `node build-output/cli/package/bin/mardikor.cjs`。

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

`list --json` 返回工程模式、修订号和按位置排列的文稿。使用 `entries[].id` 定位文稿，顺序和文件名更改后仍可使用原 ID。`read --json` 返回与该次读取对应的 `revision` 和 `markdown`。

`write`、`write-file` 和 `apply` 默认从标准输入读取 UTF‑8，也接受 `--from <文件>`。在 Windows PowerShell 中，`--from` 便于传入原样的 UTF‑8 文件。

在 Linux 终端可以打开指定文稿进行编辑。

```sh
EDITOR=vim mardikor edit "小说.mdk" "<文稿ID>"
```

`edit` 使用 `$VISUAL`、`$EDITOR` 或 Linux 的 `vi`。`--editor` 接受会等待编辑结束的可执行文件路径。Windows 可用 `--editor` 或 `VISUAL`／`EDITOR` 指定这个路径。编辑器退出后才提交，提交冲突时错误信息包含草稿路径。

## 命令参考

| 命令                                                | 用途                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `new <工程> [--mode default\|book\|comic]`          | 创建工程和首篇文稿，遇到同名工程时拒绝覆盖                   |
| `list <工程>`                                       | 查看文稿 ID、层级位置和工程修订号                            |
| `read <工程> <ID>`                                  | 读取文稿原文                                                 |
| `write <工程> <ID>`                                 | 替换文稿正文                                                 |
| `edit <工程> <ID> [--editor <程序>]`                | 用终端或外部编辑器修改指定文稿                               |
| `add <工程> <文件名> [--after <ID>]`                | 新建文稿，可插在指定文稿后                                   |
| `rename <工程> <ID> <文件名>`                       | 重命名文稿                                                   |
| `remove <工程> <ID>`                                | 移除目录项，无其他目录项引用时同时删除正文                   |
| `move <工程> <ID> <before\|after\|inside> <目标ID>` | 移动文稿及其子级                                             |
| `read-file <工程> <内部路径>`                       | 读取工程内的 Markdown、TOML 或其他 UTF‑8 文本                |
| `write-file <工程> <内部路径>`                      | 写入或创建工程内的 UTF‑8 文本                                |
| `apply <工程>`                                      | 在一次保存中提交正文和目录位置变更                           |
| `import <工程> <类型> <本地文件>`                   | 导入 image、video、audio、font 或 other 资源，返回工程内路径 |
| `validate <工程>`                                   | 检查容器、控制文件和资源引用                                 |

改写现有工程的命令需要 `--if-revision <修订号>`。交互式 `edit` 会自动记录打开文稿时的修订号。写入成功后返回新的 `revision`。

## AI 和脚本批量编辑

1. 用 `list --json` 取得文稿 ID 和修订号。
2. 用 `read --json` 读取目标正文，并记录此次读取的修订号。
3. 用 `write` 提交单篇，或用 `apply` 提交多篇正文和目录位置。传入变更所基于的修订号。
4. 用 `validate --json` 检查工程。发生冲突时重新读取内容，再决定如何合并。

`apply` 支持 `writes` 和 `positions` 两个数组，可以只提供其中一个。位置使用 MDK 目录编号字符串。多个目录项指向同一个正文文件时，每次提交只写一次该文件。

```json
{
  "writes": [{ "id": "<文稿ID>", "markdown": "# 第一章\n\n修改后的正文。\n" }],
  "positions": [{ "id": "<文稿ID>", "position": "2.1" }]
}
```

```sh
mardikor apply "小说.mdk" --if-revision "<修订号>" --from changes.json --json
mardikor validate "小说.mdk" --json
```

`--json` 的成功结果写到标准输出，命令错误以 `code`、`message` 写到标准错误。`validate --json` 即使报告含错误也会在标准输出返回完整报告。

| 退出码 | 含义                   |
| ------ | ---------------------- |
| `0`    | 操作成功               |
| `1`    | 工程校验或操作失败     |
| `2`    | 命令参数无效           |
| `3`    | 修订冲突或工程正被写入 |

桌面端和 CLI 共用写入锁。进程异常退出后可能遗留与工程相邻的 `<文件名>.mardikor-lock`。先检查文件内记录的进程及其他正在进行的写入，确认已无写入后再删除锁文件。
