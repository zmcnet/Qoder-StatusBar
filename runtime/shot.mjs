/* 调试小工具：截一张 Qoder 渲染页的图。
 * 用法：node shot.mjs [port] [out.png]   端口不写时跟着 port.txt 走。 */
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
const out = process.argv[3] || "shot.png";

let list;
try {
  list = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) })
  ).json();
} catch (e) {
  console.error("连不上 CDP 端口 " + port + "：" + e.message);
  process.exit(1);
}
const page = list.find((t) => t.type === "page" && (t.url || "").includes("renderer/index.html"));
if (!page) {
  console.error("端口 " + port + " 上没有渲染页");
  process.exit(2);
}

/* 页面卡死时 CDP 不会回话，没有这个定时器脚本就永远挂着 */
const watchdog = setTimeout(() => {
  console.error("截图超时（15s）");
  process.exit(3);
}, 15000);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id;
    pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await new Promise((r, j) => {
  const t = setTimeout(() => j(new Error("websocket open timeout")), 5000);
  ws.addEventListener("open", () => { clearTimeout(t); r(); }, { once: true });
  ws.addEventListener("error", (e) => { clearTimeout(t); j(e); }, { once: true });
});
await send("Page.enable", {});
const res = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: false,
  captureBeyondViewport: false,
});
ws.close();
clearTimeout(watchdog);
if (!res.result) {
  console.error(JSON.stringify(res));
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(res.result.data, "base64"));
console.log("saved", out);
