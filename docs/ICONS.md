# Mardikor 图标

以下资源路径均相对于仓库根目录，生成文件位于 `assets/icons/`。

SVG 是唯一绘图源。全部图标采用 64 × 64 坐标网格、纯色几何图形和透明外背景，不依赖字体、外部图片或滤镜。

| 用途               | SVG 源文件                     | 识别元素                   |
| ------------------ | ------------------------------ | -------------------------- |
| 应用               | `assets/icon.svg`              | 蓝色圆角方形、白色 M       |
| MDK default / `00` | `assets/icons/mdk-default.svg` | 蓝色折角纸张、M            |
| MDK book / `01`    | `assets/icons/mdk-book.svg`    | 青绿色折角纸张、展开书页   |
| MDK comic / `02`   | `assets/icons/mdk-comic.svg`   | 紫色折角纸张、三个分镜     |
| 普通 Markdown      | `assets/icons/markdown.svg`    | 灰色折角纸张、M 与向下箭头 |

三种 MDK 使用相同的纸张轮廓，通过颜色和内部符号区分用途，体现 book / comic 是 default 的用途子集。文件类型不依赖颜色单独识别。

## 生成

安装项目依赖后，在仓库根目录运行：

```sh
npm run icons
```

脚本复用已有 Electron，在隐藏且隔离的 Chromium 窗口里从 SVG 直接渲染每一个尺寸，不用大 PNG 逐级缩小，也不另写一份绘图代码。无需额外安装 Python、Pillow 或绘图库；旧的 `scripts/render-icon.py` 仅转调新脚本。Linux 无桌面的构建机可在虚拟显示器中运行该命令。

- `png/<名称>/<尺寸>.png`：16、20、24、32、40、48、64、96、128、256、512、1024 像素，RGBA。
- `<名称>.ico`：16–256 像素的 10 个 PNG 帧，供现代 Windows 使用。
- `<名称>.icns`：16、32、64、128、256、512、1024 像素及 Retina 表示，供 macOS 使用。
- `assets/icon.png`、`assets/icon.ico`、`assets/icon.icns`：应用打包和窗口使用的副本，由同一脚本更新。
- `preview.html`、`preview.png`：五种图标、实际小尺寸和深色背景预览。

以上生成文件随项目保留，普通构建不启动图标渲染器；修改 SVG 后请重新运行生成命令。

## 接入范围

- 应用标题栏、网页 favicon、新建工程类型、最近工程，以及 Markdown 文稿目录使用 SVG。
- Windows 应用 / 安装包使用 `assets/icon.ico`，macOS 使用 `assets/icon.icns`，Linux 使用 `assets/icon.png`。
- `.mdk` 的扩展名关联使用 `mdk-default` 文件图标；Windows 中用户勾选 `.md` 关联后使用 `markdown.ico`，原有可选关联逻辑保留。
- 同一 `.mdk` 扩展名的静态关联不会读取文件内的 `00` / `01` / `02` 前缀，因此系统文件管理器统一显示 default。应用内按已读出的模式显示对应图标。若要让 Windows 资源管理器也按模式显示，需要另外实现读取前缀的 Shell 图标处理程序；本次只提供素材和现有静态关联接入。
- 为三种模式生成图标不改变扩展名、MDK 格式或 Markdown 内容规则。便携版仍不注册系统文件关联。
