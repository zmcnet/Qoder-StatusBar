# Changelog

本项目的所有重要变更都记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-26

首个公开版本。

### 新增

- **桌面端底栏读数**：在 Qoder 桌面端聊天输入框底栏（内置「上下文占用」控件左侧）实时显示
  `速度 X tok/s · 缓存 X.XX% · 首字 X.XXs`。上下文占用直接用内置控件的百分比，不重复造一个。
- **CDP 运行时注入**：用 `--remote-debugging-port` + `Runtime.evaluate` 把读数注入渲染页。
  客户端文件一个字节都不动，升级也不会失效。
  - 不走插件体系：Qoder 插件宿主里 `executeJavaScript` / `BrowserWindow` 出现次数都是 0；
  - 不改 `app.asar`：Electron fuse `EnableEmbeddedAsarIntegrityValidation=1`，改了客户端起不来。
- **口径与 Zcode-Status-TypeBar 逐条对齐**：
  - 速度 = `Σ输出 ÷ Σ(首字→完成)`（纯生成口径），取不到退到末次请求的纯生成速度 → 末次请求端到端；
  - 首字 = 本轮首个「开始吐字」时刻 − 本轮开始（轮级），只看响应头不等请求结束；
  - 缓存 = 末次请求的 `cache_read ÷ input`（分母只用 input，用 `(input+cache_read)` 会算成 49%）；
  - 端到端 = `Σ输出 ÷ Σ(请求发出→完成)`（悬停里做对照）。
- **常驻**：内置上下文控件在生成中会被整个卸载（`usage.state==="recalculating"` 时组件返回 null），
  挂载点做成回退链（内置控件 → 上下文条 → 输入框容器）；新一轮没数据时逐项从更早的轮次回退。
- **显示规则固定三项**：不多不少，取不到的那项显示 `–`；不加「生成中」秒表，不加「上一轮」标注。
  新会话里内置上下文控件不显示，我们也不显示。
- **`/qoder-status` 面板命令** 与 `qoder-statusbar` 技能（安装 / 运维 / 排障）。
- **热重载**：改 `overlay.js` 后注入器 1.5 秒内自动重灌新代码，不必重启 Qoder。
- **单实例保障**：启动器先杀掉旧注入器再起新的；注入时比版本大小，只允许更新的版本覆盖旧版本。
  （多个注入器互相灌代码会让页面上的数字来回跳。）
- **隐藏窗口启动**：`launch-hidden.vbs` + 桌面快捷方式，不弹 cmd 窗口；输出重定向到
  `logs/launcher.log`，出错弹提示框指到日志。
- **一键安装器**：[Qoder-Status-TypeBar-AutoInstaller](https://cnb.cool/kybll/Qoder-Status-TypeBar-AutoInstaller)
  提供 [`Install-Qoder-Status-TypeBar.exe`](https://cnb.cool/kybll/Qoder-Status-TypeBar-AutoInstaller/-/releases/download/v1.0.0/Install-Qoder-Status-TypeBar.exe)：
  自动定位 Qoder、下载校验、备份并替换快捷方式、
  无 Node 的机器用 `Qoder.exe` 硬链接出 Node v24 运行时。
- 零依赖：只用 Node 内置模块，无需 `npm install`。
