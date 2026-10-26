---
name: qoder-statusbar
description: 给 Qoder 桌面端（不是 CLI）的聊天输入框底栏加一条实时用量读数：生成速度、缓存命中率、首字延迟，上下文占用直接用内置控件的百分比。当用户提到"桌面端底栏/状态条/用量条"、"speed/cache/首字/ttft 显示"、"想看 Qoder 每轮多快、缓存命中多少"、"安装或修复这个状态条"时使用。也可用于查询当前会话的用量面板。
---

# Qoder 桌面端输入框底栏用量条

在 Qoder 桌面端聊天输入框的底栏（内置「上下文占用」控件左边）实时显示：

```
速度 412 tok/s · 缓存 99.71% · 首字 3.23s   [▓▓▓░░░] 11%
                                     ↑ 本插件注入        ↑ Qoder 自带
```

**为什么必须注入而不是做插件**：Qoder 的插件体系（`@qoder/plugin-api`）只能贡献
skills / commands / hooks / MCP / agents，插件宿主 `out/main/pluginHost.js` 里
`executeJavaScript` / `BrowserWindow` / `ipcMain` 出现次数都是 0——没有注入渲染页的通道；
桌面端也没有 CLI 那种 `statusLine` 配置项。改 `app.asar` 也不行：Electron fuse
`EnableEmbeddedAsarIntegrityValidation=1`，改了客户端直接启动失败。

所以走 **CDP 运行时注入**：`--remote-debugging-port` 打开调试端口 → 注入器用 WebSocket
连上渲染页 → `Runtime.evaluate` 把 `overlay.js` 塞进去 → 每 1.5 秒推一次指标。
不碰客户端任何文件，客户端升级也不会失效。

## 何时用

- 用户想在桌面端看到每轮的生成速度 / 缓存命中 / 首字延迟。
- 用户要排查"模型是不是变慢了""缓存是不是没命中"。
- 用户要安装、修复、升级这个状态条。

## 安装（Windows）

1. 把 `runtime/` 整个目录复制到一个稳定位置（推荐 `%USERPROFILE%\.qoder\qoder-statusbar`）：
   ```powershell
   Copy-Item -Recurse <插件目录>\runtime "$env:USERPROFILE\.qoder\qoder-statusbar"
   ```
2. **完全退出 Qoder**（窗口关掉不算，托盘图标也要退）。
3. 运行 `start-qoder-statusbar.cmd`：它会带 `--remote-debugging-port=9222` 启动 Qoder，
   再拉起后台注入器。不想看到 cmd 窗口就用 `launch-hidden.vbs`（桌面快捷方式指它）。
4. 结束注入器：`stop-qoder-statusbar.cmd`（不影响 Qoder 本身）。

注入器启动后会自建桌面快捷方式（`Qoder.lnk`），原快捷方式备份为 `Qoder（原始启动）.lnk`。

## 用法要点

- 桌面端**必须用带端口的启动方式**，否则注入器连不上（日志里每 30 秒记一次）。
- **只能有一个注入器**。多个会互相灌 overlay，页面上的数字来回跳。
  启动器会先杀掉旧的再起新的；注入时也比版本大小，只允许更新的版本覆盖旧版本。
- 改 `overlay.js` 后**不必重启 Qoder**：文件顶部的 `VERSION` 变了，注入器 1.5 秒内热重载。
  改 `injector.mjs` / `metrics.mjs` 才需要重开注入器。
- 显示规则：永远三项（速度 / 缓存 / 首字），不增不减；新会话里内置上下文控件不显示，
  我们也不显示。

## 数据口径（与 Zcode-Status-TypeBar 逐条对齐）

| 指标 | 公式 | ZCode 对应字段 |
|---|---|---|
| 速度 | `Σ输出 ÷ Σ(首字时刻 → 完成时刻)`，本轮加权 | `tps_gen` |
| 速度兜底 | 末次请求的纯生成速度 → 末次请求的端到端 | `tps_last` → `tps` |
| 首字 | 本轮首个「开始吐字」时刻 − 本轮开始时刻（轮级） | `ttft_ms` |
| 缓存 | 末次请求的 `cache_read ÷ input` | `cache_read ÷ input` |
| 端到端 | `Σ输出 ÷ Σ(请求发出 → 完成)`（悬停里） | `tps_e2e` |

数据全部来自本地日志，不联网、不调模型：

- `~/.qoder/logs/sessions/<项目>/<会话>/segments/*.jsonl` —— 请求发起/完成时刻、
  输入/输出/缓存 token、轮次边界（`turn.started`）
- `~/.qoder/logs/runs/<同名目录>/qodercli.log` —— `phase=headers_received` = 服务端开始吐字 = 首字时刻

两个源靠 **request_id ↔ qoderRequestId** 精确关联。一个会话可能跨多个 runtime 进程
（桌面端每重启一次 agent 就换一个 segment 文件），必须全部读进来合并，否则早期轮次
在「上一轮」回退链里会断。

## 查询面板

```bash
node <插件目录>/runtime/panel.mjs          # 最近活跃的会话
node <插件目录>/runtime/panel.mjs <会话id>  # 指定会话
```

输出示例：

```
会话 5ced838b-4e94-40eb-bc4f-8402ac09a08c
模型 magpie/minimax/MiniMax-M3.1-Flash · 速度 239 tok/s · 缓存 99.84% · 首字 2.57s
端到端 104 tok/s · 本轮 12 次请求 · 输出 6468 tok · 3秒前
```

## 排障

| 现象 | 原因与处理 |
|---|---|
| 底栏什么都没有 | 注入器没连上：确认 Qoder 是用带端口的方式启动的；看 `logs/injector.log` |
| 数字来回跳 | 有多个注入器在跑：停掉旧的，或重新执行启动脚本（它会先杀旧的） |
| 改了样式没变化 | 注入器是旧版：重开注入器；或确认 `overlay.js` 的 `VERSION` 递增了 |
| 一直显示占位符 `–` | 这个会话还没有任何完成的请求 |
| 底栏不显示 | 新会话里内置上下文控件本来就不显示，等这一轮跑出第一个请求就会出现 |
| 启动报 `bad option: --remote-debugging-port` | 环境变量 `ELECTRON_RUN_AS_NODE=1` 没清掉，启动脚本已处理 |
