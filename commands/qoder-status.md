---
description: Qoder 桌面端用量面板：速度 / 缓存 / 首字
---

用 Bash 执行本插件的 `runtime/panel.mjs` 脚本，把输出的面板原样展示给用户。

命令（把 `<插件目录>` 换成本插件所在目录，若已安装运行时则用 `%USERPROFILE%/.qoder/qoder-statusbar`）：

```bash
node "<插件目录>/runtime/panel.mjs"
```

脚本不存在时，提示用户按 `qoder-statusbar` skill 的安装步骤安装运行时。

面板口径：速度=Σ输出÷Σ(首字→完成)（纯生成速度）、首字=本轮首个吐字时刻−本轮开始、缓存=末次请求 cache_read÷input。
