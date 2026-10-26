import fs from "node:fs";
const port = process.argv[2] || "9333";
const out = process.argv[3] || "shot.png";
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("renderer/index.html"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await send("Page.enable", {});
const res = await send("Page.captureScreenshot", { format: "png", fromSurface: false, captureBeyondViewport: false });
ws.close();
if (!res.result) { console.error(JSON.stringify(res)); process.exit(1); }
fs.writeFileSync(out, Buffer.from(res.result.data, "base64"));
console.log("saved", out);
