/* 最小 CDP 客户端：连到 Qoder 渲染页，evaluate 一段 JS 并回传结果。
 * 用法：node cdp.mjs [port] [表达式文件]   不给表达式文件就从 stdin 读（避免引号地狱）。
 * 端口不写时跟着启动器走：环境变量 > port.txt > 9222 ——
 * 写死调试端口会在启动器自动换端口那天直接连不上。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
function resolvePort() {
  const c = [process.argv[2], process.env.QODER_CDP_PORT];
  try { c.push(fs.readFileSync(path.join(HERE, "port.txt"), "utf8").trim()); } catch {}
  c.push("9222");
  for (const x of c) {
    const n = parseInt(x, 10);
    if (Number.isInteger(n) && n > 1024 && n < 65536) return n;
  }
  return 9222;
}
const port = resolvePort();
const exprFile = process.argv[3];

let list;
try {
  list = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) })
  ).json();
} catch (e) {
  console.error("连不上 CDP 端口 " + port + "：" + e.message);
  console.error("Qoder 需要用桌面快捷方式（带调试端口）启动，或先跑 node runtime/launcher.mjs --inject");
  process.exit(1);
}
const page = list.find((t) => t.type === "page" && (t.url || "").includes("renderer/index.html"));
if (!page) {
  console.error("no renderer page found on port " + port);
  process.exit(2);
}

const expr = exprFile
  ? (await import("node:fs")).readFileSync(exprFile, "utf8")
  : await new Promise((r) => {
      let b = "";
      process.stdin.on("data", (d) => (b += d));
      process.stdin.on("end", () => r(b));
    });

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, resolve);
    /* 页面卡死/被关掉时不能永远挂着，调试工具也要能自己退出 */
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        reject(new Error("CDP timeout: " + method));
      }
    }, 8000);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

await new Promise((r, j) => {
  const t = setTimeout(() => j(new Error("websocket open timeout")), 5000);
  ws.addEventListener("open", () => { clearTimeout(t); r(); }, { once: true });
  ws.addEventListener("error", (e) => { clearTimeout(t); j(e); }, { once: true });
});
let res;
try {
  res = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
ws.close();
if (res.result?.exceptionDetails) {
  console.error(JSON.stringify(res.result.exceptionDetails, null, 2));
  process.exit(1);
}
const v = res.result?.result?.value;
console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
