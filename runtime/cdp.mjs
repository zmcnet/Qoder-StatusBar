/* 最小 CDP 客户端：连到 Qoder 渲染页，evaluate 一段 JS 并回传结果。
 * 用法：node cdp.mjs <port> '<表达式>'   表达式从 stdin 读更方便（避免引号地狱）。 */
const port = process.argv[2] || "9333";
const exprFile = process.argv[3];

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("renderer/index.html"));
if (!page) {
  console.error("no renderer page found");
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
  return new Promise((resolve) => {
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const res = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});
ws.close();
if (res.result?.exceptionDetails) {
  console.error(JSON.stringify(res.result.exceptionDetails, null, 2));
  process.exit(1);
}
const v = res.result?.result?.value;
console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
