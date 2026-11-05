# 应用更新与发布

更新源为 [MaidTendouAris/Mardikor 的 GitHub Releases](https://github.com/MaidTendouAris/Mardikor/releases)。仅使用稳定版本，禁止降级及预发布版本。

## 用户操作

“应用设置 → 每日自动检查更新”默认开启。主进程统一检查，滚动 24 小时内最多自动请求一次；时间戳保存在本机，多个窗口和重启共享记录。应用持续运行时也会检查是否到期。断网或 GitHub 服务异常不会影响文档编辑，失败的自动检查同样计入当天次数。

关闭后仍可点击“立即检查更新”。发现新版本时，应用显示提示；安装版点击“下载更新”后才下载，完成后点击“安装并重启”才安装。关闭应用不会自动安装。安装前逐个处理所有窗口的未保存内容，取消或保存失败就终止安装。

便携版显示版本提示和发布页入口，通过发布页获取对应版本。开发模式不执行定时检查，桌面回归也不向生产更新源发起自动请求。

## 发布流程

更新 `package.json` 和锁定文件中的版本号，在 `docs/releases/v<版本>.md` 编写发布说明，提交源码后推送同名 `v<版本>` 标签。GitHub Actions 的 [release.yml](../.github/workflows/release.yml) 会执行测试、构建、打包产物与图标核对、打包程序回归，以及更新清单 SHA-512 检查，再创建草稿、上传完整资源并公开发布。已有版本不会被覆盖。

发布包含安装包、便携版、安装包 `.blockmap`、`latest.yml` 和 `CHECKSUMS.sha256`。`latest.yml` 中的版本、文件名、SHA-512 和大小必须与安装包一致。标准 GitHub Actions `GITHUB_TOKEN` 仅在发布作业获得仓库内容写权限，无需在仓库保存个人访问令牌。

本地构建使用 `npm run dist`，默认不上传。`node scripts/release-checksums.mjs` 验证清单并生成校验文件。应用使用 `electron-updater`，明确关闭 `autoDownload` 和 `autoInstallOnAppQuit`，不调用自动下载通知接口。
