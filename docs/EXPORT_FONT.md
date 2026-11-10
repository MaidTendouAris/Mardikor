# 固定出版字体

`NotoSansCJKsc-Regular.otf` 来自 Noto 官方固定版本 Sans2.004：

- https://github.com/notofonts/noto-cjk/tree/Sans2.004
- https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf
- SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`
- `OFL.txt` 原文：https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE

内置字体随应用分发。保存导出配置时在工程中记录字体 SHA-256，导出时从匹配版本的应用读取并校验。旧工程已嵌入的字体和用户自定义字体仍可选用。

`renderer.json` 由 `scripts/build-electron.mjs` 自动生成，记录出版渲染源码及依赖锁定文件的 SHA-256；无时间戳。修改渲染规则或依赖后摘要改变，旧工程须明确采用新版本才能重新导出 PDF。安装包必须同时包含这份清单、字体和许可证。
