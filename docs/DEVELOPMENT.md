# 开发指引

需要 Node.js 22.12+、npm 和桌面环境。

```sh
npm ci
npm run dev
```

`dev` 同时运行 Vite 与 Electron，前端热更新，主进程 / preload 修改后自动重启桌面窗口。首次运行可能需要联网下载 Electron 运行时。

```sh
npm run build          # TypeScript 7 检查 + 渲染器、主进程构建
npm start              # 启动构建后的桌面应用
npm run dev:web        # 仅预览界面，不提供本地工程读写
npm run package        # 当前平台的解包应用目录
npm run dist           # 当前平台的便携交付包
```

## 检查

```sh
npm run typecheck
npm run lint
npm test
npm run test:roundtrip
npm run build
npm run test:desktop
npm run test:revision
npm run test:editor
npm run test:groups
npm run test:native-drag
npm run test:markdown-tools
npm run test:markdown-file
npm run test:windows
npm run test:open-preview
npm run test:controls
npm run test:publication
```

桌面测试使用独立应用数据目录，通过真实 preload / IPC 验证 Monaco、实际拖动层级、目录与 TOML 双向更新、整体目录 JSON 编辑、资源、预览、设置及导出；原生文件对话框在测试主进程中替换为固定测试路径。`test:editor` 验证标题定位、独立工具栏、窗口自适应、本地 File 拖放插入及白名单整批拒绝；`test:groups` 验证双栏独立选择、共享编辑/撤销、双向滚动、分隔条、多文件原子保存及重启恢复。截图保存在 `.test-artifacts/desktop/`、`.test-artifacts/editor-desktop/` 和 `.test-artifacts/groups-desktop/`。

`test:native-drag` 使用本地 File 的完整 `dragenter → dragover → drop` 序列，覆盖跨过目录树、切换目录视图、取消拖入、非法批次拒绝、目录拖动、双栏插图和切换工程后继续编辑/拖入。此用例修复前能复现 `Cannot have two HTML5 backends at the same time`。原生文件事件在 preload 初始化时统一接管，目录树显式复用应用级拖拽管理器。

`test:roundtrip` 直接测试生产编辑器扩展，覆盖 CommonMark 和 GFM 的语义往返、链接/图片标题与转义、表格和嵌套代码围栏；`test:markdown-tools` 通过实际 Electron 窗口验证功能区、右键菜单、原生剪贴板、链接校验、图片导入、表格操作及源码模板。截图位于 `.test-artifacts/markdown-tools-desktop/`。

`test:markdown-file` 验证 `.md` 启动打开、专属功能置灰、保存、可视化与标题大纲、原生拖图、双栏预览、切换 MDK、新建单文件工程、草稿恢复、自动保存和外部修改冲突。可用 `MARDIKOR_TEST_EXECUTABLE` 对打包程序运行同一回归。

`test:windows` 验证多文件启动、连续双击的独立窗口、窗口内保存/关闭、同文件冲突、草稿和资源授权隔离。

`test:open-preview` 验证外部打开默认预览，三种视图偏好在应用已运行和重启后均生效，同时检查打开文件未被改写。顶栏采用淡蓝底色，与白色工作区和纸张区分。

`test:controls` 通过真实界面检查自绘下拉的键盘选择、Escape、保存、字体建议及自由输入，并检查导航展开/收起的中间宽度、快速反向切换和减少动画模式。编辑器弹窗与功能区使用 `test:markdown-tools` 回归，双栏文件选择和只读项沿用对应桌面回归。

## Windows 安装

应用与文件图标以 SVG 为源，运行 `npm run icons` 可重新生成 16–1024 像素 PNG、Windows ICO 和 macOS ICNS。设计预览、尺寸和文件关联接入说明见 [图标说明](ICONS.md)。

`npm run dist` 在 Windows 同时生成 `Mardikor-Setup-0.1.0-x64.exe` 安装包和 `Mardikor-Portable-0.1.0-x64.exe` 便携版。安装向导提供目录选择及文件关联页面：`.mdk` 自动注册关联；`.md` 由复选框选择，首次默认不勾选，升级保留选择。取消关联或卸载时，仅清理本应用的 `.md` 注册；当前默认仍为本应用时恢复之前的注册值。Windows 已有的受保护默认应用选择由系统管理。

文件关联在安装时写入；便携版只运行应用，不改动系统关联。安装脚本位于 `build-scripts/installer.nsh`。

## 目录

- `electron/`：窗口、文件对话框、IPC、应用状态、MDK 容器服务。
- `shared/`：共享类型、IPC 契约、默认设置、目录算法。
- `src/`：React 界面与编辑器。
- `tests/`：MDK 格式、兼容性与保存行为的回归测试。
- `scripts/`、`build-scripts/`：开发、构建、端到端检查和平台打包。

格式依据：[MDK v1 规范](./MDK%20Format%20Specification%20v1.md)。迁移细节：[MIGRATION.md](./MIGRATION.md)。

## 多窗口约定

外部启动参数、Windows `second-instance` 和 macOS `open-file` 中的每个 `.md` / `.mdk` 都创建独立窗口；应用内“打开工程”保留在当前窗口切换的行为。每个窗口拥有独立的会话、文件授权、资源导入令牌、导出覆盖授权、磁盘版本及关闭保存状态。应用偏好和最近文件由主进程统一持久化。

恢复草稿按窗口认领。同一路径在多个窗口编辑时不会共用草稿；重启后可认领未被活动窗口占用的遗留草稿。重复打开同一文件后，一个窗口保存不会更新其他窗口的版本基准，过期保存会被拒绝。
