/* 插件自测：node runtime/test/test-runner.mjs
 * 1) 清单里的路径都存在
 * 2) overlay.js 语法正确
 * 3) 指标引擎对最近会话算出合理值（没有会话日志时跳过） */
import fs from "node:fs";
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
    ok(m.speed === null || (m.speed > 0 && m.speed < 100000), "速度合理: " + m.speed);
    ok(m.cache === null || (m.cache >= 0 && m.cache <= 100), "缓存率在 0~100: " + m.cache);
    ok(m.ttft === null || m.ttft >= 0, "首字非负: " + m.ttft);
    ok(m.requests >= 0, "请求数: " + m.requests);
  }
}

console.log(failed ? "\n失败 " + failed + " 项" : "\n全部通过");
process.exit(failed ? 1 : 0);
