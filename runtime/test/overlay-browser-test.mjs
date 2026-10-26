/* overlay 浏览器行为测试：node runtime/test/overlay-browser-test.mjs
 * 用本机 Edge/Chrome 的 headless 模式加载 mock-composer.html，验证：
 *   - 三项格式 / 占位符
 *   - 切会话时不串数据
 *   - 新会话隐藏、生成中常驻、可回退到上下文条 / 输入框
 * 找不到浏览器时跳过（退出码 0），不阻塞普通开发机。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const browsers = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const browser = browsers.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});
if (!browser) {
  console.log("skip  未找到 Edge/Chrome，跳过 overlay 浏览器测试");
  process.exit(0);
}

const PORT = 9500 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-overlay-test-"));
const mock = "file:///" + path.join(HERE, "mock-composer.html").split(path.sep).join("/");
const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pageUrl = mock + "#/chat/" + sid;

const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    pageUrl,
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getPage() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const p = list.find((t) => t.type === "page" && t.url.includes("mock-composer"));
      if (p) return p;
    } catch {}
    await sleep(200);
  }
  throw new Error("浏览器没有加载 mock 页面");
}

let ws;
let failed = 0;
function ok(cond, msg) {
  console.log((cond ? "  ok   " : "  FAIL ") + msg);
  if (!cond) failed++;
}
try {
  const info = await getPage();
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  function send(method, params) {
    const id = ++seq;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rej(new Error("timeout " + method));
        }
      }, 5000);
    });
  }
  async function js(expression) {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  }

  await js(fs.readFileSync(path.join(ROOT, "runtime", "overlay.js"), "utf8"));

  /* A. 初始：控件在、无 payload → 占位符 */
  let r = await js(
    `(function(){var e=document.getElementById('qoder-statusbar-module');return {text:e&&e.textContent, display:e&&e.style.display, inStrip:!!(e&&e.closest('[data-conversation-context-strip="true"]'))};})()`
  );
  ok(r.text === "速度 – tok/s · 缓存 –% · 首字 –s", "A 占位符: " + r.text);
  ok(r.display === "", "A 显示");
  ok(r.inStrip, "A 挂在上下文条");

  /* B. 匹配 sid → 三个值 */
  await js(`window.__qoderStatusUpdate({sid:"${sid}",speed:412.4,cache:99.71,ttft:3.23})`);
  r = await js(
    `(function(){var e=document.getElementById('qoder-statusbar-module');return {text:e.textContent,display:e.style.display};})()`
  );
  ok(r.text === "速度 412 tok/s · 缓存 99.71% · 首字 3.23s", "B 三值格式: " + r.text);

  /* C. sid 不匹配 → 占位符，绝不串会话 */
  await js(
    `window.__qoderStatusUpdate({sid:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",speed:1,cache:2,ttft:3})`
  );
  r = await js(`document.getElementById('qoder-statusbar-module').textContent`);
  ok(r === "速度 – tok/s · 缓存 –% · 首字 –s", "C 串会话不串数: " + r);

  /* D. 控件隐藏 + 无数据（新会话）→ 隐藏 */
  await js(
    `document.querySelector('[data-chat-context-usage-progress="true"]').style.display='none'; window.__qoderStatusUpdate({sid:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",speed:1,cache:2,ttft:3})`
  );
  r = await js(`document.getElementById('qoder-statusbar-module').style.display`);
  ok(r === "none", "D 新会话隐藏: " + r);

  /* E. 控件隐藏 + 有数据（生成中）→ 回退到上下文条常驻 */
  await js(`window.__qoderStatusUpdate({sid:"${sid}",speed:412.4,cache:99.71,ttft:3.23})`);
  r = await js(
    `(function(){var e=document.getElementById('qoder-statusbar-module');return {text:e.textContent,display:e.style.display,inStrip:!!e.closest('[data-conversation-context-strip="true"]')};})()`
  );
  ok(r.display === "" && r.inStrip && r.text.indexOf("412 tok/s") >= 0, "E 生成中常驻: " + JSON.stringify(r));

  /* F. hash 清空（新会话/非聊天页）+ 旧 payload → 隐藏 */
  await js(
    `location.hash=''; window.__qoderStatusUpdate({sid:"${sid}",speed:412.4,cache:99.71,ttft:3.23})`
  );
  r = await js(`document.getElementById('qoder-statusbar-module').style.display`);
  ok(r === "none", "F 非聊天页隐藏: " + r);

  /* G. 控件/上下文条都移除，只剩输入框 → 有数据时挂到输入框 */
  await js(
    `document.querySelector('[data-conversation-context-strip="true"]').remove(); location.hash='#/chat/${sid}'; window.__qoderStatusUpdate({sid:"${sid}",speed:412.4,cache:99.71,ttft:3.23})`
  );
  r = await js(
    `(function(){var e=document.getElementById('qoder-statusbar-module');return {display:e.style.display,parent:e.parentElement&&e.parentElement.getAttribute('data-conversation-composer')};})()`
  );
  ok(r.display === "" && r.parent === "true", "G 回退到输入框: " + JSON.stringify(r));

  /* H. 连输入框都没有 → 隐藏 */
  await js(`document.querySelector('[data-conversation-composer="true"]').remove()`);
  await js(`window.__qoderStatusUpdate({sid:"${sid}",speed:412.4,cache:99.71,ttft:3.23})`);
  r = await js(
    `(function(){var e=document.getElementById('qoder-statusbar-module');return !e || e.style.display === 'none';})()`
  );
  ok(r === true, "H 无挂载点隐藏: " + r);
} finally {
  try {
    if (ws) ws.close();
  } catch {}
  try {
    child.kill();
  } catch {}
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}

console.log(failed ? "\n失败 " + failed + " 项" : "\n全部通过");
process.exit(failed ? 1 : 0);
