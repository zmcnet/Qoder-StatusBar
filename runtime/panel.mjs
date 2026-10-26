/* 打印某个会话的用量面板（斜杠命令 /status 用它）。
 * 用法：node panel.mjs [会话id]
 * 不带参数时取最近活跃的会话。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { computeMetrics, qoderHome } from "./metrics.mjs";

const logsRoot = path.join(qoderHome(), "logs");
const sessionsRoot = path.join(logsRoot, "sessions");

function allSessions() {
  const out = [];
  let slugs = [];
  try {
    slugs = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const s of slugs) {
    if (!s.isDirectory()) continue;
    const base = path.join(sessionsRoot, s.name);
    let sids = [];
    try {
      sids = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of sids) {
      if (!d.isDirectory()) continue;
      const segDir = path.join(base, d.name, "segments");
      let files = [];
      try {
        files = fs.readdirSync(segDir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      if (!files.length) continue;
      let mt = 0;
      for (const f of files) {
        try {
          mt = Math.max(mt, fs.statSync(path.join(segDir, f)).mtimeMs);
        } catch {}
      }
      out.push({ sid: d.name, slug: s.name, mtime: mt });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function ago(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return "";
  if (sec < 60) return Math.round(sec) + "秒前";
  if (sec < 3600) return Math.round(sec / 60) + "分钟前";
  return Math.floor(sec / 3600) + "小时" + Math.floor((sec % 3600) / 60) + "分前";
}

const arg = process.argv[2];
const sessions = allSessions();
const sid = arg || (sessions[0] && sessions[0].sid);
if (!sid) {
  console.log("没有找到任何会话日志。");
  process.exit(1);
}

const m = computeMetrics(sid);
if (!m) {
  console.log(`会话 ${sid} 暂时没有可算的数据（可能还没发出过请求）。`);
  process.exit(0);
}

const num = (v, d) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
console.log(`会话 ${sid}${sessions[0] && sessions[0].sid === sid ? "" : ""}`);
console.log(
  `模型 ${m.model || "–"} · 速度 ${num(m.speed, 0)} tok/s · 缓存 ${num(m.cache, 2)}% · 首字 ${num(m.ttft, 2)}s`
);
console.log(
  `端到端 ${num(m.e2e, 0)} tok/s · 本轮 ${m.requests} 次请求 · 输出 ${m.outTokens} tok` +
    (m.age !== null && m.age !== undefined ? ` · ${ago(m.age)}` : "")
);
console.log(
  `口径：速度=Σ输出÷Σ(首字→完成)；首字=本轮首个吐字时刻−本轮开始；缓存=末次请求 cache_read÷input`
);
