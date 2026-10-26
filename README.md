# Qoder-Status-TypeBar

给 **Qoder 桌面端**（不是 CLI）的聊天输入框底栏加一条实时用量读数，紧贴内置
「上下文占用」控件的左侧：

```
速度 412 tok/s · 缓存 99.71% · 首字 3.23s   [▓▓▓░░░] 11%
                                     ↑ 本插件注入        ↑ Qoder 自带
```

- **速度**：纯生成速度（输出 token ÷ 真正吐字的时间窗），整数
- **缓存**：命中率，两位小数
- **首字**：从你发消息到模型吐出第一个字，两位小数
- **上下文占用**：直接用 Qoder 自带控件的百分比（不重复造一个）

悬停里还有模型名、端到端速度对照、本轮请求数、本轮输出 token、距上次请求多久。

## 为什么是注入而不是插件

Qoder 的插件体系（`@qoder/plugin-api`）只能贡献 skills / commands / hooks / MCP / agents，
插件宿主 `out/main/pluginHost.js` 里 `executeJavaScript` / `BrowserWindow` / `ipcMain`
出现次数都是 **0**——没有任何注入渲染页的通道，桌面端也没有 CLI 那种 `statusLine`
配置项（整个 `app.asar` 里搜不到 `statusLine`）。

**也不改 `app.asar`**（ZCode 那种做法）：Qoder 的 Electron fuse 里
`EnableEmbeddedAsarIntegrityValidation = 1`（实测读出 fuse wire），改了 asar 客户端会
直接启动失败，校验用的哈希还焊在 exe 的 PE 资源里。

**所以用 CDP（Chrome DevTools Protocol）运行时注入**：
`--remote-debugging-port` 打开调试端口 → 注入器用 WebSocket 连上渲染页 →
`Runtime.evaluate` 把 `overlay.js` 塞进去 → 每 1.5 秒推一次指标。
客户端文件一个字节都不动，客户端升级也不会失效。

## 一键安装（推荐）

到 [Releases](https://cnb.cool/kybll/Qoder-StatusBar/-/releases) 下载
`Install-Qoder-Status-TypeBar.exe`，双击运行：

1. 自动找到 Qoder 安装目录（也支持 `--qoder-dir "D:\Apps\Qoder"` 手动指定）
2. 从 release 下载插件包并校验 SHA256
3. 装到 `%USERPROFILE%\.qoder\qoder-statusbar`
4. **备份**并替换桌面 / 开始菜单里的 Qoder 快捷方式（备份名
   `Qoder (original launcher).lnk`），以后双击它就会带调试端口启动并自动拉起注入器
5. 机器上没有 Node 也能用：安装器会用 `Qoder.exe` 的硬链接做一个 Node v24 运行时
6. 卸载：`Install-Qoder-Status-TypeBar.exe --uninstall`

> 安装前请**完全退出 Qoder**（托盘图标也要退出）。安装器会等你退出后继续。

## 手动安装（Windows）

1. 复制 `runtime/` 到稳定位置（推荐 `%USERPROFILE%\.qoder\qoder-statusbar`）：
   ```powershell
   Copy-Item -Recurse <仓库>\runtime "$env:USERPROFILE\.qoder\qoder-statusbar"
   ```
2. **完全退出 Qoder**（窗口关掉不算，托盘图标也要退）。
3. 运行 `runtime\start-qoder-statusbar.cmd`：
   - 以 `--remote-debugging-port=9222` 启动 Qoder，再拉起后台注入器；
   - 不想看到 cmd 窗口就用 `runtime\launch-hidden.vbs`（桌面快捷方式指它，
     输出重定向到 `logs/launcher.log`，出错弹提示框指到日志）。
4. 结束注入器：`runtime\stop-qoder-statusbar.cmd`（不影响 Qoder 本身）。

> 这台机器上 `ELECTRON_RUN_AS_NODE=1` 是全局环境变量，带着它启动 `Qoder.exe` 会被当成
> node 跑（报 `bad option: --remote-debugging-port`）。启动脚本已经把它从子进程环境里删掉。

## 显示规则

底栏那一行**永远就是三项**，格式固定，不多不少：

| 状态 | 显示 |
|---|---|
| 有上下文控件（内置那栏显示 `11%`） | 显示 |
| 没有上下文控件、也没数据（**新会话**） | **不显示**——上下文都不显示，我们也不显示 |
| 没有上下文控件、但有数据（老会话生成中，控件临时卸载） | 显示，搬到上下文条上靠右贴住 |

- 本轮某一项取不到值，就从更早的轮次里逐项回退（缺哪补哪，不整条退回）
- 实在一个值都没有，那一项显示 `–`，整行结构不变
- 不加任何额外项：没有「生成中」秒表，没有「上一轮」标注

## 口径（与 Zcode-Status-TypeBar 逐条对齐）

| 指标 | 公式 | ZCode 对应字段 |
|---|---|---|
| 速度 | `Σ输出 ÷ Σ(首字时刻 → 完成时刻)`，本轮加权 | `tps_gen` |
| 速度兜底 | 末次请求的纯生成速度 → 末次请求的端到端 | `tps_last` → `tps` |
| 首字 | 本轮首个「开始吐字」时刻 − 本轮开始时刻（轮级） | `ttft_ms` |
| 缓存 | 末次请求的 `cache_read ÷ input` | `cache_read ÷ input` |
| 端到端 | `Σ输出 ÷ Σ(请求发出 → 完成)`（悬停里） | `tps_e2e` |

几个容易算错的点：

- **速度用「纯生成」口径**，不是端到端。端到端会把首字等待和工具往返摊进分母，
  实测能低 2~13 倍，看着像模型很慢。
- **缓存分母只用 `input`**：`input_tokens` 里已经含缓存部分，所以 `cache_read ÷ input`
  才是命中率（实测 99%+）；用 `cache_read ÷ (input+cache_read)` 会算成 49%，那是错的。
- **分子已含思考链**。ZCode 的分子是 `输出 + 思考 token`，我们只有客户端记的
  `output_tokens`——实测它已经含思考：一次 3903 token 的响应对应 15397 字符的
  thinking 内容（可见文本只有 32 字符），3.95 字符/token 是正常分词水平，两者等价。

## 数据从哪来

全部是本地日志，**不联网、不调模型**：

| 文件 | 取什么 |
|---|---|
| `~/.qoder/logs/sessions/<项目>/<会话>/segments/*.jsonl` | 请求发起/完成时刻、输入/输出/缓存 token、轮次边界（`turn.started`） |
| `~/.qoder/logs/runs/<同名目录>/qodercli.log` | `phase=headers_received` = 服务端开始吐字 = 首字时刻 |

两个源靠 **request_id ↔ qoderRequestId** 精确关联（实测 70/70 全对上）。
会话 id 从渲染页 URL 的 hash 里取（`#/chat/<sessionId>`），多窗口/多会话各自显示各自的。

> **一个会话可能有多个 segment 文件**：桌面端每重启一次 agent runtime 就换一个
> `segments/<run_id>-p<pid>.jsonl`（本会话实测有 4 个）。全部读进来合并，否则 runtime
> 重启前的轮次在「上一轮」回退链里是断的。每个文件各自增量读，只读新增部分。

## 目录结构

| 文件 | 作用 |
|---|---|
| `.qoder-plugin/plugin.json` | Qoder 插件清单 |
| `skills/qoder-statusbar/SKILL.md` | 安装 / 运维 / 排障技能 |
| `commands/qoder-status.md` | `/qoder-status` 用量面板命令 |
| `runtime/overlay.js` | 渲染端：把读数插到内置上下文控件左边 |
| `runtime/injector.mjs` | CDP 客户端：注入 overlay、按会话算指标、定时推送 |
| `runtime/metrics.mjs` | 日志解析与指标计算（增量读日志，只读文件尾） |
| `runtime/launcher.mjs` | 启动逻辑：查端口 / 判重复实例 / 起进程 / 拉注入器 |
| `runtime/start-qoder-statusbar.cmd` | 一键启动（GBK 编码，含 node 兜底路径） |
| `runtime/launch-hidden.vbs` | 隐藏窗口启动（桌面快捷方式指它） |
| `runtime/stop-qoder-statusbar.cmd` | 结束注入器 |
| `runtime/panel.mjs` | 打印某个会话的用量面板 |
| `runtime/cdp.mjs` / `runtime/shot.mjs` | 调试小工具（求值任意表达式 / 截图） |
| `runtime/test/mock-composer.html` | 底栏 DOM 的离线仿真页 |

零依赖：只用 Node 内置模块，无需 `npm install`。

## 排障

| 现象 | 原因与处理 |
|---|---|
| 底栏什么都没有 | 注入器没连上：确认 Qoder 是用带端口的方式启动的；看 `logs/injector.log` |
| 数字来回跳 | 有多个注入器在跑：重新执行启动脚本（它会先杀旧的） |
| 改了样式没变化 | 注入器是旧版：重开注入器；或确认 `overlay.js` 的 `VERSION` 递增了 |
| 一直显示占位符 `–` | 这个会话还没有任何完成的请求 |
| 底栏不显示 | 新会话里内置上下文控件本来就不显示，跑出第一个请求就会出现 |

## License

MIT
