# Changelog

本项目的所有重要变更都记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.2] - 2026-10-26

### 修复

- **渲染页刷新后注入永久失效**：WebSocket 断开（页面刷新/关闭）后，旧实现只在
  target id 消失时才清理连接；target id 不变时会一直复用死连接。现在监听 `close`
  并回收连接，下一次 tick 自动重连；连接打开也加了 5 秒超时，不再留下永远 pending 的 socket。
- **切会话时旧读数残留**：URL 里没有 `/chat/<sid>`（新会话/非聊天页）时，之前只在
  `payload.sid` 存在且不匹配时清空；现在 `curSid` 为空同样按「无数据」处理，显示占位符或隐藏。
- **生成中控件隐藏导致底栏消失**：挂载点回退链增加可见性判断（控件 → 上下文条 → 输入框），
  隐藏的容器不再被当作挂载点；所有挂载点都不可见时隐藏而不是把节点塞进隐藏容器。
- **子代理轮 / 重复 `turn.started` 污染读数**：同一个 `turn_id` 会被重复记录（runtime 重启、
  子代理复用父轮 id、多窗口打开同一会话）。现在按 `turn_id` 去重并保留最早的起点，
  保证首字按用户真正发起本轮的时刻计算；只以 `is_subagent` 身份出现过的轮不再冒充当前轮。
- **零输出轮显示「速度 0」**：请求被中止或 provider 不回报 token 时，速度不再算成 0，
  而是回退到上一轮的真实读数（缓存/首字同理）。
- **`--stop` 可能误杀无关进程**：PID 文件过期后 PID 可能被系统复用；结束前先用
  `Get-CimInstance` 校验命令行确实包含 `injector.mjs`，不是就只清理 PID 文件。
- **`--inject` 在 CDP 未开启时仍假报启动成功**：现在会明确报错并提示先退出 Qoder 重新启动。
- 注入器主循环加防重入（CDP 卡顿时不会堆积并发 tick），`/json/list` 与读取日志加超时/短读重试。

### 测试

- 新增 `runtime/test/overlay-browser-test.mjs`：用本机 Edge/Chrome headless 加载 mock 页面，
  覆盖占位符、三项格式、跨会话隔离、新会话隐藏、生成中常驻、回退到上下文条/输入框等 10 个断言。
- `runtime/test/test-runner.mjs` 新增「重复轮次 / 子代理轮 / 零输出轮」回归用例。

## [1.0.1] - 2026-10-26

### 修复

- **压缩上下文后缓存显示 0%**：`turn.started` 里除了用户轮次，还有客户端后台产生的
  `<uuid>-fork-compact`（上下文压缩）、`skill-evolution-*`（技能演化）、`memory-fork-*`
  （记忆整理）等内部轮次。之前把它们当成「当前轮」，压缩请求本身 `cache_read=0`，
  于是底栏显示 `缓存 0.00%`，速度也变成压缩任务的数值。现在过滤内部轮次，只统计
  用户发起的真实对话轮；压缩期间继续显示上一轮的真实读数。

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
