# 固定出版字体

`NotoSansCJKsc-Regular.otf` 来自 Noto 官方固定版本 Sans2.004：

- https://github.com/notofonts/noto-cjk/tree/Sans2.004
- https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf
- SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`
- `OFL.txt` 原文：https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE

MDK v2 的通用出版字体对应应用内置的 Noto Sans CJK SC、Noto Serif CJK SC 和 Noto Sans Mono CJK SC。应用读取固定版本字体时会校验 SHA-256。预设也可使用工程资源中的 OTF 或 TTF。源文件中的通用字族只承诺其类型，其他实现可以选择不同的具体字体。

- [Noto Serif CJK SC Regular，Serif2.003](https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf)，SHA-256 `2a2eae2628df83556c54018c41e20fa532c1b862c5256ae8b3f23feb918d12ca`。
- [Noto Sans Mono CJK SC Regular，Sans2.004](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Mono/NotoSansMonoCJKsc-Regular.otf)，SHA-256 `ec04cc376b34887cedbdf84074e2e226ed2761eeabdcB9173fc1dd7bfd153ef7`。

三种内置 Noto CJK 字体附带 [SIL OFL](../assets/export/OFL.txt)。使用内置字体的 EPUB 会随子集携带许可证。

`renderer.json` 由 `scripts/build-electron.mjs` 自动生成，记录出版渲染源码及依赖锁定文件的 SHA-256。安装包包含清单、字体和许可证。
