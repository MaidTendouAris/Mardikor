# 固定出版字体

`NotoSansCJKsc-Regular.otf` 来自 Noto 官方固定版本 Sans2.004：

- https://github.com/notofonts/noto-cjk/tree/Sans2.004
- https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf
- SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`
- `OFL.txt` 原文：https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE

保存内置字体的导出配置时，字体和许可证分别复制到工程内 `resources/font/Mardikor-NotoSansCJKsc-Regular.otf` 和 `resources/other/Mardikor-Noto-OFL.txt`。不读取宿主机器字体目录。

`renderer.json` 由 `scripts/build-electron.mjs` 自动生成，记录出版渲染源码及依赖锁定文件的 SHA-256；无时间戳。修改渲染规则或依赖后摘要改变，旧工程须明确采用新版本才能重新导出 PDF。安装包必须同时包含这份清单、字体和许可证。
