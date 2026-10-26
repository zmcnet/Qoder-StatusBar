/* 注入器：连上 Qoder 的 CDP 端口，把 overlay.js 塞进渲染页，并周期性推送指标。
 * 用法：node injector.mjs [--port 9333] [--interval 1500]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetrics } from "./metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(HERE, "overlay.js");

/* 每次都用磁盘上的最新 overlay.js。
 * 之前只在启动时读一次，导致「版本号比对」永远相等 —— 改完 UI 注入器还在灌旧代码，
 * 页面上一直显示老样子（生成中就是那时候留下的）。 */
function loadOverlay() {
  try {
    const src = fs.readFileSync(OVERLAY_PATH, "utf8");
    const v = (src.match(/var VERSION = "([^"]+)"/) || [])[1] || "";
    /* 版本号末尾的数字用来比大小：老注入器不许覆盖新版本，
     * 否则多个注入器会互相灌代码，页面来回跳 */
    const n = parseInt((v.match(/(\d+)\s*$/) || [])[1], 10);
    return { src, v, n: isNaN(n) ? 0 : n };
  } catch (e) {
    return { src: null, v: "", n: 0 };
  }
}

const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const PORT = arg("port", "9333");
const INTERVAL = Number(arg("interval", "1500"));

const log = (...a) => console.error("[qoder-statusbar]", ...a);

/* JSON 里的 U+2028/U+2029 在 JS 字面量中是行分隔符，转义后再拼进表达式 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
function safeJson(obj) {
  return JSON.stringify(obj)
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
}

/* ---------- 极简 CDP 客户端 ---------- */
class Page {
  constructor(info) {
    this.id = info.id;
    this.url = info.url;
    this.ws = new WebSocket(info.webSocketDebuggerUrl);
    this.seq = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP timeout: " + method));
        }
      }, 5000);
    });
  }
  async evalJs(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function listPages() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  return list.filter(
    (t) => t.type === "page" && t.url && t.url.includes("renderer/index.html")
  );
}

/* ---------- 主循环 ---------- */
const pages = new Map(); /* targetId -> {page, injectedSrc} */

let lastDeadLog = 0;

async function ensurePages() {
  let infos = [];
  try {
    infos = await listPages();
  } catch (e) {
    const now = Date.now();
    if (now - lastDeadLog > 30000) {
      lastDeadLog = now;
      log("cannot reach CDP port", PORT, "-", e.message);
    }
    return;
  }
  const seen = new Set();
  for (const info of infos) {
    seen.add(info.id);
    if (!pages.has(info.id)) {
      try {
        const p = new Page(info);
        await p.ready;
        pages.set(info.id, { page: p, injectedSrc: "" });
        log("connected renderer page", info.id, info.url.slice(0, 90));
      } catch (e) {
        log("connect renderer page failed:", e.message);
      }
    }
  }
  for (const [id, entry] of [...pages]) {
    if (!seen.has(id)) {
      entry.page.close();
      pages.delete(id);
      log("renderer page closed", id);
    }
  }
}

async function tick() {
  await ensurePages();
  const ov = loadOverlay();
  for (const [id, entry] of pages) {
    const { page } = entry;
    try {
      const reported = await page.evalJs("window.__qoderStatusOverlay || ''");
      const reportedN = parseInt(((reported || "").match(/(\d+)\s*$/) || [])[1], 10);
      /* 只在「页面比我旧」或「页面里没有」时注入：
       * 页面比我新（别的注入器灌过更新的）就不碰，避免互相覆盖来回跳 */
      const needInject =
        ov.src &&
        (reported === "" ||
          (isNaN(reportedN) ? reported !== ov.v : reportedN < ov.n) ||
          (reported === ov.v && entry.injectedSrc && entry.injectedSrc !== ov.src));
      if (needInject) {
        await page.evalJs("window.__qoderStatusOverlay=false");
        await page.evalJs(ov.src);
        entry.injectedSrc = ov.src;
        log("overlay loaded", id, ov.v);
      }
      const probe = await page.evalJs(
        "window.__qoderStatusProbe ? window.__qoderStatusProbe() : null"
      );
      if (!probe || !probe.sid) continue;
      const m = computeMetrics(probe.sid);
      const payload = {
        sid: probe.sid,
        speed: m ? m.speed : null,
        e2e: m ? m.e2e : null,
        ttft: m ? m.ttft : null,
        cache: m ? m.cache : null,
        requests: m ? m.requests : 0,
        outTokens: m ? m.outTokens : 0,
        model: m ? m.model : null,
        age: m ? m.age : null,
        inflight: m ? m.inflight : null,
        stale: m ? !!m.stale : false,
        ttftStale: m ? !!m.ttftStale : false,
        ctxPct: probe.ctxPct,
      };
      await page.evalJs(
        "window.__qoderStatusUpdate && window.__qoderStatusUpdate(" +
          safeJson(payload) +
          ")"
      );
    } catch (e) {
      log("push failed", id, e.message);
    }
  }
}

log(`started, CDP port ${PORT}, interval ${INTERVAL}ms`);
await tick();
setInterval(() => {
  tick().catch((e) => log("loop error", e.message));
}, INTERVAL);
