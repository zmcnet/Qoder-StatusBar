/* 插件自测：node runtime/test/test-runner.mjs
 * 1) 清单里的路径都存在
 * 2) overlay.js 语法正确
 * 3) 指标引擎对最近会话算出合理值（没有会话日志时跳过） */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
let failed = 0;

function ok(cond, msg) {
  console.log((cond ? "  ok   " : "  FAIL ") + msg);
  if (!cond) failed++;
}

/* 1) 清单 */
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".qoder-plugin", "plugin.json"), "utf8")
);
console.log("manifest");
ok(!!manifest.name, "name: " + manifest.name);
ok(!!manifest.version, "version: " + manifest.version);
for (const key of ["skills", "commands"]) {
  const p = manifest[key];
  if (!p) continue;
  const abs = path.join(ROOT, p);
  ok(fs.existsSync(abs), key + " → " + p + " 存在");
}
if (manifest.logo) {
  ok(fs.existsSync(path.join(ROOT, manifest.logo)), "logo → " + manifest.logo + " 存在");
}

/* 2) overlay 语法 */
console.log("overlay");
try {
  new Function(fs.readFileSync(path.join(ROOT, "runtime", "overlay.js"), "utf8"));
  ok(true, "overlay.js 语法正确");
} catch (e) {
  ok(false, "overlay.js 语法错误: " + e.message);
}
const ov = fs.readFileSync(path.join(ROOT, "runtime", "overlay.js"), "utf8");
ok(/var VERSION = "[^"]+"/.test(ov), "overlay.js 带 VERSION");

/* 3) 指标引擎 */
console.log("metrics");
const { computeMetrics } = await import(
  "file:///" + path.join(ROOT, "runtime", "metrics.mjs").split(path.sep).join("/")
);
const sessionsRoot = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".qoder",
  "logs",
  "sessions"
);
let latest = null;
try {
  for (const slug of fs.readdirSync(sessionsRoot)) {
    const base = path.join(sessionsRoot, slug);
    for (const sid of fs.readdirSync(base)) {
      const segDir = path.join(base, sid, "segments");
      let files = [];
      try {
        files = fs.readdirSync(segDir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        const mt = fs.statSync(path.join(segDir, f)).mtimeMs;
        if (!latest || mt > latest.mt) latest = { sid, mt };
      }
    }
  }
} catch {}

if (!latest) {
  console.log("  skip  没有会话日志，跳过指标校验");
} else {
  const m = computeMetrics(latest.sid);
  ok(!!m, "会话 " + latest.sid.slice(0, 8) + " 算出指标");
  if (m) {
    /* 0 是合法的：本轮可能被中止/没有任何输出 token */
    ok(m.speed === null || (m.speed >= 0 && m.speed < 100000), "速度合理: " + m.speed);
    ok(m.cache === null || (m.cache >= 0 && m.cache <= 100), "缓存率在 0~100: " + m.cache);
    ok(m.ttft === null || m.ttft >= 0, "首字非负: " + m.ttft);
    ok(m.requests >= 0, "请求数: " + m.requests);
  }
}

/* 3b) 内部轮次不能顶替用户轮次：压缩轮的 cache_read=0 不能显示成 0% */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-statusbar-test-"));
try {
  const sid = "22222222-2222-4222-8222-222222222222";
  const turn = "11111111-1111-4111-8111-111111111111";
  const segDir = path.join(tmp, "logs", "sessions", "test-slug", sid, "segments");
  fs.mkdirSync(segDir, { recursive: true });
  const lines = [
    { type: "turn.started", ts: "2026-10-26T21:00:00.000+08:00", turn_id: turn, data: { model: "test-model" } },
    { type: "model.request.started", ts: "2026-10-26T21:00:01.000+08:00", turn_id: turn, request_id: "req-real", data: { model: "test-model" } },
    { type: "model.response.completed", ts: "2026-10-26T21:00:03.000+08:00", request_id: "req-real", data: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 900 } },
    { type: "turn.started", ts: "2026-10-26T21:00:10.000+08:00", turn_id: turn + "-fork-compact", data: { model: "test-model" } },
    { type: "model.request.started", ts: "2026-10-26T21:00:11.000+08:00", turn_id: turn + "-fork-compact", request_id: "req-compact", data: { model: "test-model" } },
    { type: "model.response.completed", ts: "2026-10-26T21:00:20.000+08:00", request_id: "req-compact", data: { input_tokens: 5000, output_tokens: 500, cache_read_input_tokens: 0 } },
  ];
  fs.writeFileSync(
    path.join(segDir, "2026-10-26T21-00-00-000+08-00-test.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
  );
  process.env.QODER_HOME = tmp;
  const s = computeMetrics(sid);
  ok(!!s, "内部轮次过滤：算出指标");
  if (s) {
    ok(s.cache === 90, "内部轮次过滤：缓存取真实轮 90%（实际 " + s.cache + "）");
    ok(s.outTokens === 100, "内部轮次过滤：输出取真实轮 100（实际 " + s.outTokens + "）");
    ok(s.requests === 1, "内部轮次过滤：请求数取真实轮 1（实际 " + s.requests + "）");
  }
} finally {
  delete process.env.QODER_HOME;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(failed ? "\n失败 " + failed + " 项" : "\n全部通过");
process.exit(failed ? 1 : 0);
