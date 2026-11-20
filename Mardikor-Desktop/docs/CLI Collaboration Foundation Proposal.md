# Mardikor CLI 功能扩展与协同编辑前置草案

2026-11-19 · 草案 1 · 面向桌面端、CLI 及后续同步客户端的开发者。本文提出新接口，现有版本的可用命令以[命令行指南](CLI.md)为准。

目标是让作者在桌面上完成的每一次**工程内容修改**，都能由 CLI 独立表达、检查和提交。例如，“改一行正文并调整该章的目录标题”是一笔可传递的编辑。客户端可以离线准备它，接收端可以指出它基于哪个版本、是否已经执行、改了哪些对象。先交付这些本地能力，再接入多人传输。

## 1. 现有 CLI 能承担什么

| 已有基础 | 已核实的行为 | 需要补齐 |
| --- | --- | --- |
| 工程和正文 | `new/list/read/write/edit`，`read-file/write-file` 可操作包内文本；`list --json` 提供工程、正文和节点 ID。 | 未编排正文的独立管理、局部文本修改、按同一快照读取多个对象。 |
| 目录和资源 | `add/group/rename/remove/move`、单文件 `import`。移除目录节点会提升其子节点，并保留正文。 | 单独编排已有正文、修改节点标题、分离文件改名和显示名、多资源操作及引用查询。 |
| 批量写入 | 现有 `apply` 一次保存 `newEntries/writes/positions`；新建和定位可用点分目录序号，`writes` 接受整篇 Markdown。 | 有顺序的跨类型事务、稳定定位、调用方提供 ID、提交回执与去重。 |
| 并发与通知 | `revision` 是磁盘文件字节的 SHA-256。桌面和 CLI 共用写锁，提交检查 `--if-revision`。`watch --json` 发出本机路径和最新修订，可能跳过中间状态。 | 可续读的提交记录、冲突详情、断线补齐、异机副本的一致性检查。 |
| 校验与交付 | `validate/pack/unpack/deliver`、访问保护与 MDKE 命令已存在。桌面已有工程设置、资源管理、出版预设和 PDF／EPUB 出版入口。 | 机器可查询的能力、细分预检、无界面出版及与桌面一致的错误定位。 |

基线来自[CLI 入口](../cli/mardikor.ts)、[CLI 回归用例](../tests/cli.test.ts)、[工程服务](../electron/mdk.ts)、[文件监视器](../electron/project-watch.ts)和[桌面命令接口](../shared/desktop.ts)。下列方案保留现有短命令、参数顺序、`apply` 的旧 JSON、`--quiet` 输出、编码选项和退出码。

## 2. 可在本机先交付的命令

新命令统一写作 `mardikor <对象> <动作> <工程> [参数]`。下表中同组动作共用对象名。例如 `node title` 的完整形式为 `mardikor node title book.mdk node-1 "前言" --if-revision <修订号>`。普通本地写入沿用现有修订检查。每个命令在帮助和能力清单中列出输入类型、必需参数、前置条件、输出及是否产生同步操作。

| 命令组及拟增动作 | 行为与边界 | 阶段 |
| --- | --- | --- |
| `capabilities --json`、`schema <操作名>`、`project info` | 无工程也可读取本机协议版本、操作目录、请求／回执 schema、输入限额；指定工程可查询模式、只读原因、已支持及缺失扩展、可用出版器。 | A |
| `project from-markdown/fork`、`extension list/inspect` | 复用桌面已有 Markdown 转 MDK 的递归收录、链接改写和转换报告；派生独立工程生成新工程 ID。列出必需／可选能力、未知持久资料及对应读写限制。转换输入与产物位置在本机选择。 | B |
| `doc list/read/create/register/title/rename/unregister/delete` | 按正文 ID 读写，涵盖有节点、无节点及未登记草稿。创建可独立于编排；登记接受已有包内路径。改标题与改路径分开。取消登记保留文件，删除正文会删除文件；两者都列出节点、活动引用和扩展依赖，调用方须在同一事务处理受影响对象。 | A |
| `doc replace/splice/split/merge`、`query search/outline/refs` | 整篇替换、范围修改、显式拆篇与合篇；文本检索返回正文 ID、摘要及命中范围，区分字面和大小写；大纲返回标题锚点，引用查询列出入链、出链和位置。拆合须指定保留／新建的 ID、布局及引用处理，歧义进入预检。 | A，拆合在 B |
| `node list/add/group/title/move/remove` | 节点 ID 定位，支持给同一正文添加多个节点。创建或移动给出父节点或根，以及同级锚点；修改节点标题只影响这一次展示。`remove` 默认提升子级；批量移除子树须显式指定范围，正文另行处理。 | A |
| `project mode`、`metadata get/set/unset`、`settings get/set/unset` | 作品语言、作者、标识、封面与工程模式均可维护。按字段及类型更新，`unset` 恢复缺省；保留其他未知字段，沿用核心的局部修复规则。应用偏好属于本机。 | A |
| `file list/stat/read/extract/mkdir/create/move/remove`、`asset list/import/replace/move/remove`、`blob put/stat/get` | 遍历包内文件，查看类型、字节数和摘要，提取选中项。通用文件命令遇到已登记正文、受管理控制文件、资源或扩展资料时，沿用相应对象的规则。资源导入接受文件／目录或已暂存内容；替换、重命名和移动维护已知引用；删除显示依赖。批量拖图生成的资源和正文引用一次提交。 | A，二进制跨端传递在 B |
| `preset list/get/create/set/default/remove`、`publish plan/run`、`delivery plan` | 结构化编辑 PDF／EPUB 预设，按 ID 预检；运行出版绑定工程修订、预设和预检结果，失败只返回诊断。CLI 可在环境具备出版引擎和字体时输出成品。输出文件路径及覆盖授权仅属于执行机。 | B |
| `check <工程> --scope <范围>` | 查询容器、核心结构、基础内容、展示或指定出版预设的诊断。输出状态、严重度、代码、包内路径、字段或正文范围；一次未完成编辑可保存，交付和出版分别按依赖预检。 | A |
| `translation list/create/status/read/edit/confirm/align/detach` | 以原文／译稿正文 ID、语言及稳定行 ID 操作。创建同时更新文件、登记和索引；支持草稿、多行译文、沿用、省译、待复核和退役行重连。仅在实现对应格式扩展时公布该能力。 | C，依赖[逐行翻译提案](<MDK Multilingual Translation Proposal.md>) |
| `snapshot inspect/diff`、`changes init/head/list/follow/snapshot/restore/replay`、`tx plan/submit/status/rebase/revert` | 比较两个快照的文稿、目录、资源与控制文件；读取提交历史、断线恢复、事务预检、去重、重提和有条件撤销。详见第 3 至 7 节。 | B，重放与撤销在 C |

查询统一支持 `--json`；大列表提供 `--limit` 和不透明 `--cursor`。分页令牌绑定查询及所读版本，版本不匹配时提示重新读取。`doc read` 支持请求正文中的字节范围；`query read-many` 从一次打开的快照读取一组正文、节点或字段，返回同一修订，供桌面双栏和脚本使用。二进制提取走文件或显式原始字节输出，结构化诊断走标准错误。

## 3. 一次编辑如何成为可发送的命令

桌面、CLI 和将来的接收服务共用一套**有版本的操作对象**。本地 CLI 负责把参数、标准输入与本地文件转换为操作，接收端直接解析 UTF-8 JSON。协议只接受操作目录中的名称和字段；操作中的路径均为包内路径。打开外部编辑器、调用终端程序、解锁、更换口令和选择宿主输出目录，都在本机入口执行。未来的传输层在调用操作执行器前完成身份与工程权限核验。

**先区分三个标识。** `projectId` 是 MDK 中的作品工程身份；`fileRevision` 是此机器上当前工程文件的字节摘要，供磁盘写锁和旧 CLI 使用；`streamId + seq` 指定同一权威提交序列中的逻辑版本。复制工程会保留 `projectId`，重新打包或加密又可能改变 `fileRevision`。接收端通过 `streamId` 确认所加入的编辑会话。每个会话先由一个提交端排序；同一篇文章的实时逐键合并可在后续协议中增加。

**命令演练。** 假设工程已有正文 `doc-road`，全部字节是 UTF-8 的 `# 山路\r\n`，无 BOM；`node-road` 是其中一次目录展示。作者希望将标题改为「山间小路」，同时将该处目录标题改为「山间小路（上）」。以下命令和输入描述拟议接口。示例的工程 ID、会话 ID 和序号应替换为实际读取值。

```sh
mardikor changes init book.mdk --json
mardikor changes head book.mdk --json
mardikor doc read book.mdk doc-road --json
mardikor tx plan book.mdk --from rename-road.json --json
mardikor tx submit book.mdk --from rename-road.json --json
mardikor tx status book.mdk --stream stream-book --id edit-018 --json
mardikor changes list book.mdk --stream stream-book --after 17 --json
```

```json
{
  "protocol": 1,
  "projectId": "book-example",
  "streamId": "stream-book",
  "txId": "edit-018",
  "baseSeq": 17,
  "ops": [
    {
      "op": "text.splice",
      "documentId": "doc-road",
      "expectedHash": "ae95b9c08be6c89727b3cf2ed078efd55373d7521409b3e272329ab215203d64",
      "startByte": 2,
      "endByte": 8,
      "oldText": "山路",
      "text": "山间小路"
    },
    {"op": "node.title.set", "nodeId": "node-road", "title": "山间小路（上）"}
  ]
}
```

两个操作共享一次修订检查，按数组顺序改同一工作副本。第二步找不到节点时，第一步也不发布。`plan` 返回触及对象、引用变更、可定位的诊断和当前头，不分配提交序号。`submit` 在提交时重新校验。成功回执至少含 `protocol/projectId/streamId/txId/seq/parentSeq/fileRevision/changed`；示例的 `parentSeq` 为 17，`seq` 为 18，`changed` 同时列出正文和节点。CLI 仍可将参数错误、校验错误和并发冲突分到已有退出码。

下面给出两位作者从 17 开始工作的回执示例。第一段仅摘取成功回执中用于更新界面的字段；第二段是另一位作者随后用旧基线提交时收到的错误。若第一位作者因超时重发原请求，仍取得序号 18 的成功回执。

```json
{
  "txId": "edit-018", "parentSeq": 17, "seq": 18,
  "changed": [
    {"type": "document", "id": "doc-road"},
    {"type": "node", "id": "node-road"}
  ]
}
```

```json
{
  "code": "E_TX_BASE", "message": "提交基线已过期，请先读取新增提交。",
  "txId": "edit-by-second-author", "baseSeq": 17, "headSeq": 18, "retryable": false
}
```

### 操作设计

| 操作类型和主要字段 | 提交时的规则 |
| --- | --- |
| `text.replace(documentId, expectedHash, text)`、`text.splice(documentId, expectedHash, startByte, endByte, oldText, text)` | `expectedHash` 是该步之前正文全部原始字节的 SHA-256。范围为零起点、左闭右开；偏移以跳过单个开头 BOM 后的 UTF-8 字节计。边界须落在完整字符之间且不切开 CRLF。比较 `oldText` 的精确字节，零宽区间表示插入，空替换表示删除。保留 BOM、未修改字节和行尾；替换文本中的换行按输入保存。 |
| `doc.create/register/title.set/path.set/unregister/delete`；`node.add/group/title.set/move/remove` | 请求明确区分 `documentId` 和 `nodeId`。新增对象由调用方选定稳定 ID 和目标包内路径；同批后续步骤可立即引用。节点定位使用 `parentId`（根为 `null`）及 `beforeId`、`afterId`、`atEnd` 三选一，锚点属于目标父节点。循环、占用的 ID／路径和缺失锚点返回错误。 |
| `project.mode.set`、`metadata.set/unset`、`settings.set/unset`、`preset.create/set/default/remove` | 字段路径用字符串数组表示，如 `["body","font_size"]`；字段更新由对应 schema 核对类型和作用域。数组可整体替换；具备 ID 的对象按 ID 寻址。清空、删除字段和赋缺省值在接口中可区分。 |
| `asset.put/move/remove`、`file.mkdir` | `asset.put` 给出目标包内路径、资源类别、`blobHash` 和 `size`，替换已有资源另给旧摘要；移动给出旧路径和明确的新路径。目录批量导入先展开为确定的清单，碰名在预检中解决，再提交完整清单。 |
| `translation.create/edit/confirm/align/detach` | 引用组内正文和行 ID。编辑、确认携带原文行基准及目标行段基准，防止对已更改原文误确认。创建明确译稿 ID、语言和已解析的目标路径；新增行 ID 由请求提供或由提交端一次分配并随回执和事件保存。具体语义沿用翻译草案。 |

所有产生新身份、路径、保序重排或已知链接修正的操作，在回执明细中给出最终结果。命令帮助为每个操作提供成功和冲突例。`schema` 公开可用的原子操作；拆合篇章、批量导入等组合动作可展开为同一事务中的多项操作。本机可编辑的原始 TOML 仍可通过 `write-file` 保存；加入会话的桌面如提供整份控制文件编辑，使用带旧文件摘要的 `control.replace`，重新执行核心校验、翻译关联和引用检查。对未支持的必需扩展沿用 MDK 的只读规则。

## 4. 重试、冲突和撤销

1. **同一请求可安全重发。** 在当前工程与会话权限检查后，按 `(streamId, txId)` 查持久回执，再检查 `baseSeq`。同 ID、同内容返回首次成功的回执，即使其后又有提交；同 ID、不同内容返回 `E_TX_ID_REUSED`。请求指纹为完整请求做 JCS 后的 UTF-8 字节 SHA-256，覆盖基线、操作顺序及资源摘要。拒绝重复 JSON 键；协议整数限安全整数。对象键顺序和 JSON 排版不影响重试。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)
2. **提交按工程串行。** 只接受 `baseSeq` 等于权威头的新事务。取得桌面／CLI 共用写锁后复核已绑定的磁盘摘要，逐步检查操作前置条件，再一次验证并发布整体结果。对新 ID 的有效空改动也记录一次回执与序号，`changed` 为空，文件可以保持原摘要。失败的事务不消耗序号、不发布事件；`ops` 为空属于参数错误。
3. **过期时区分何处冲突。** 返回 `baseSeq/headSeq/opIndex`（能定位时）、对象 ID、包内路径及预期／实际摘要。客户端用 `changes list`、`snapshot diff` 或 `doc read` 获取差异，保留本地草稿。`tx rebase` 仅产生新请求和预检报告，使用新 `txId`。首版可自动准备“甲改 A 篇、乙改 B 篇”且所有读取依赖仍相同的情况。同篇交叠、同一插入点、删除后编辑、目录锚点改变或未知扩展涉及的写入，都交回作者处理；仅更新基线数字不足以通过检查。
4. **两种撤销。** 尚未提交的输入沿用编辑器本地撤销。已提交事务可用 `tx revert --id <原事务> --if-head <当前序号>` 生成补偿事务草案。按保存的前像恢复所涉对象，并检查其后是否有人修改受影响的正文、节点、引用和扩展数据。发生交叠时返回冲突；确认提交后新增一条历史记录。可逆范围或前像已过保留期时返回明确原因。
5. **客户端提交粒度。** 一次粘贴、替换、段落格式化、拖图、目录拖动或翻译确认各可组成一笔事务。连续键入可按编辑器已有撤销分组或保存边界合并；输入法在确认组合文本后才生成操作。源码和可视化视图都从同一正文缓冲区取得基线。切换视图、滚动位置、光标、搜索及本机阅读偏好沿用本机状态。

## 5. 可续读的变更与副本

**启用。** `changes init` 为现有 MDK 在包外建立本地提交记录，捕获序号 0 的一致快照，返回 `projectId/streamId/seq/fileRevision`。同一已绑定工作副本重复初始化可返回现有头。单机用户可直接使用第 2 节的普通命令。启用记录后，新 CLI 和桌面写入在发布时走同一事务入口。旧工具或外部程序造成无法归因的磁盘变化时，`head/submit/follow` 报告 `E_HISTORY_DIVERGED`，保留待提交编辑；显式重新建基线时使用新 `streamId`。历史丢失或独立副本开启自己的会话时同样生成新 ID。

通过 `restore` 加入的副本以跟随角色打开。它可以保存本地草稿、对快照执行 `tx plan`、生成待发请求，只有该流的提交端可接受 `tx submit` 并分配序号。在跟随端直接执行会修改已确认工程的普通命令，应转成待发编辑并明确返回待发状态，或报告角色限制。离线独立创作可派生新会话。

**读取。** `changes list --stream S --after N --limit K` 依序返回 `seq > N` 的已提交事件及下一游标。`changes follow --stream S --after N` 先补历史再输出每行一条 UTF-8 JSON，与实时部分按同一日志序号衔接。事件含 `projectId/streamId/seq/parentSeq/txId`、已接受的操作、已分配身份和受影响的包内条目清单。每个新增／修改条目携带最终字节的摘要、长度和类型，删除条目携带旧摘要；相关资源由内容仓获取。接收端持久化一整笔后才推进游标。短暂断连可重复收到事件。原 `watch` 继续用于磁盘变化提醒。

**初次加入、断档和重放。** `changes snapshot <工程> --out <新目录>` 在一个已提交头上生成工程快照及描述文件，记录流、序号、快照文件摘要、持久条目清单摘要。`changes restore <新工程> --from <快照目录>` 校验后建立跟随副本，使用快照携带的流和序号。`changes replay <副本> --from <事件文件>` 顺序消费该流提交端已接受的事件。校验父序号、旧条目摘要、依赖对象、包内路径、大小、格式约束和最终清单后，一次替换该副本的工程并记录游标。已处理的同序号同事件返回既有结果；不同事件占用同序号、跳号或其他流的事件都拒绝应用。副本的本地草稿单独保留。

重放使用事件中提交端已确定的条目结果，能还原分配的 ID、TOML 字节和链接重写。持久条目清单采用按包内路径 UTF-8 字节升序排列的 `{path,kind,size,sha256}` 数组，对其 JCS 编码取 SHA-256。`kind` 为 `file` 或 `directory`，显式目录按包内名称保留末尾斜杠，长度为零、摘要取空字节串的 SHA-256。包括未知持久文件和扩展，排除 `state/` 及其子项。事件包含提交前后清单摘要，`changes head` 返回当前 `manifestHash`。ZIP 封装时间、加密随机数及本机 `state/` 可以不同，副本各自保留本机磁盘摘要。快照默认采用相同持久范围，源快照中属于作者的未完成译稿等持久资料也在范围内。

游标早于保留历史时返回 `E_CURSOR_EXPIRED`，提示最近可用快照，先恢复到新位置再续读；仍有本地改动的副本须先保留草稿。快照截取、分页与日志压缩并发时，也应能从其声明的头无缝续读，或得到显式过期结果。同一活动会话内独立保留精简去重回执，即使正文历史已压缩，旧请求也不会再次执行。

**两目录联调。** 先在权威端截取序号 17 的快照，将其交给另一个目录，随后提交第 3 节的请求。下例中 `checkpoint` 和 `delta.ndjson` 是这次交接的本地文件。`--format ndjson --out` 显式写 UTF-8 事件流；`replay` 可逐笔消费，返回最后一个已提交的序号。缺 blob 时返回清单，分别用提交端的 `blob get` 和副本的 `blob put` 搬运验证过的内容，再重放同一批。

```sh
mardikor changes snapshot book.mdk --out checkpoint
mardikor changes restore peer.mdk --from checkpoint
mardikor tx submit book.mdk --from rename-road.json --json
mardikor changes list book.mdk --stream stream-book --after 17 --format ndjson --out delta.ndjson
mardikor changes replay peer.mdk --from delta.ndjson --json
mardikor changes head peer.mdk --json
```

## 6. 原子性、限额与错误

- **工程与回执一起恢复。** 包外日志和 MDK 是两个存储对象。取得共用写锁并复核基线后，提交端可持久化意图记录、精确的新容器字节、前后文件摘要及回执，发布 MDK，提交日志并释放锁，最后应答。启动或接管遗留事务时先完成恢复：磁盘是旧摘要则安全完成已准备的发布，磁盘是新摘要则补齐日志，第三种摘要触发分歧处理。回执、事件和头通过同一次日志事务生效；意图已持久化而应答未知时，客户端用原 ID 查状态并重试。设计须覆盖同字节空改动、磁盘满及“已替换文件、尚未返回回执”三个窗口。
- **资源先到，引用后提交。** `blob put --from <本地文件>` 返回 SHA-256 和字节数；同内容可复用。事务只引用已验证且允许该工程使用的资源。缺少对象时返回所缺摘要，补齐后可重送原请求；失败事务不留下半篇正文或半套资源。回收暂存对象时保留待提交意图、保留期内事件与快照所引用的数据。重放取得任何条目内容后都要验证字节数和摘要。
- **受保护工程。** 口令、绝对宿主路径和本机授权只在本机适配层处理。事件和快照需要与内容相同的访问范围。保护工程的日志、前像、暂存对象和恢复文件须具备相应的静态保护；升级已有会话的访问保护须处理已有历史的明文副本。能力未就绪时，应在创建日志、导出快照或暂存内容前报告限制，现有受保护 MDK 的本地功能仍按 CLI 指南执行。MDKE 继续作为分发封装。
- **输入及输出。** 保留当前 64 MiB 单次输入／单条目、256 MiB 普通工程及条目总量约束；既有保护封装另有外层限额。新接口另公布单事务操作数、查询页长、单事件及暂存总量上限。超限整笔失败。查询、回执和事件使用结构化标准输出；错误使用标准错误，进度信息不得混入 JSON。支持 `--from <文件>` 和标准输入；一个标准输入至多承担一个数据来源。

| 情况 | 拟议代码／退出码 | 客户端动作 |
| --- | --- | --- |
| 格式错误、未知操作或协议版本 | `E_USAGE`／`E_PROTOCOL_UNSUPPORTED`，2 | 查询 schema 或能力版本后修正。 |
| 当前端缺少所需能力，或缺少 blob、依赖、引用非法 | `E_CAPABILITY`／`E_BLOB_MISSING`／`E_DEPENDENCY`，1 | 读取结构化诊断，补资源或修正事务。 |
| 锁忙或物理文件修订冲突 | 现有 `E_MDK_LOCKED`／`E_MDK_REVISION`，3 | 锁忙可退避重试。修订变化先读取当前状态。 |
| ID 与已提交请求不同、逻辑基线过期或前置条件不符 | `E_TX_ID_REUSED`／`E_TX_BASE`／`E_PRECONDITION`，3 | 分别检查 ID 使用、重提基线、解决对象冲突。 |
| 游标过期、缺事件、工作副本分歧 | `E_CURSOR_EXPIRED`／`E_EVENT_GAP`／`E_HISTORY_DIVERGED`，3 | 取快照、补历史或核对磁盘工程。 |

新增命令的错误至少含 `code/message/retryable`，适用时带 `txId/opIndex/objectId/expected/actual`。可向未来协作者显示的正文或二进制内容由授权读取命令获取。现有 `validate --json` 即使退出码为 1 仍输出校验报告，供旧脚本继续使用。

## 7. 交付顺序与验收

**A · 单机 CLI 补齐。** 先提供能力发现、统一的操作 schema、文稿局部写入、正文与节点分别管理、资源与引用查询、元数据和设置编辑。结合已有工程服务，桌面及 CLI 对同一输入产生相同的正文、目录和引用结果。本阶段即可独立发布。

**B · 本地模拟两位作者。** 在两个 CLI 进程和一个桌面窗口间验证命令生成、事务预检、提交去重、历史和快照。实现资源暂存及组合操作；让现有 CLI 别名和桌面保存接入同一提交边界。出版和交付 CLI 可独立排期。通过 B 后，开发者可在本机验证一轮“产生操作 → 发送 JSON → 权威端执行 → 读取已接受事件”的流程。

**C · 独立副本验收。** 让另一目录中的副本从快照追赶、断线补齐和重放。接入已定稿的翻译操作，验证补偿撤销和受保护历史。网络传输、账号、权限策略和同篇实时合并留给协同服务设计。未支持的能力通过 `capabilities` 按角色如实报告。

| 开发验收场景 | 预期可观察结果 |
| --- | --- |
| 旧脚本运行 `list/read/write/apply --quiet/validate/watch`；老工程有未知扩展 | 输出契约及退出码兼容；未知持久数据保留，受限操作有诊断。 |
| 两客户端读到同一头，各改不同正文；两客户端同时改同一段 | 第一笔成功；不同文稿可预检并重提。同段冲突可定位，本地草稿可取回。 |
| 创建正文、编排两处、导入封面，其中最后一步失败 | 正文、节点、资源、回执与序号均无部分提交。重试成功后只增加一笔。 |
| 回执丢失，其他人又提交；原请求重发以及同 ID 改内容重发 | 原请求取回第一次的序号和结果；改内容被拒绝，当前头不倒退。 |
| 中文、emoji、组合字符、BOM、CRLF 及行尾双空格做范围修改 | 合法字节范围精确替换；切开 UTF-8 或 CRLF、旧文本／摘要错误时整笔失败。 |
| 同一正文出现两次，移除其中一个节点；有其他正文链接到该文件 | 只移除所选节点，另一处和链接可用。显式删文件会列出相关依赖。 |
| 主机 A 暂存图片，主机 B 无原路径；批量拖图并插入引用 | 仅凭已授权的 blob 和事务完成，缺失或摘要错误时不改变正文。 |
| 成功提交后崩溃、发布前崩溃、只写日志意图即掉电、磁盘已被外部改写 | 重启按前后摘要恢复，一次提交只有一次效果及回执；无法归因时停止推进历史。 |
| 断线、乱序、重复事件、游标过期、独立副本错误复用了工程 ID | 重复接收无副作用，缺口可补，过期可用快照追赶，跨会话被拒绝；最终持久清单一致。 |
| 已确认译文依赖的原文被改动；重复提交新建译稿 | 旧确认返回前置条件冲突；同一事务重送只产生一份译稿，原文、译稿与索引保持同一修订。 |
| 原书导出与预设修改并发；保护工程启用日志后故障恢复 | 过期预检不发布成品；受保护工作资料不会经日志、临时目录或错误输出泄露。 |

阶段验收应分别记录命令帮助、示例请求与回执、故障注入结果及两份工程的持久清单对比。本文提供的是开发验收标准，运行结果由对应实现提交补充。
