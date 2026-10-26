/* 从 Qoder 本地日志算指标。
 * 数据源：
 *   ~/.qoder/logs/sessions/<项目>/<会话>/segments/*.jsonl  —— 请求发起/完成、token 用量、轮次边界
 *   ~/.qoder/logs/runs/<同名目录>/qodercli.log            —— phase=headers_received = 服务端开始吐字
 * 口径沿用 Zcode-Status-TypeBar：
 *   纯生成速度 = Σ输出token ÷ Σ(首字时刻 → 完成时刻)
 *   首字       = 首个请求的首字时刻 − 本轮开始时刻（turn 级）
 *   缓存命中率 = Σcache_read ÷ Σinput
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function qoderHome() {
  const h =
    process.env.QODER_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), ".qoder");
  return h;
}

const logsRoot = () => path.join(qoderHome(), "logs");

/* ---------- 增量读文件尾巴：日志只追加，所以按偏移续读即可 ---------- */
function makeReader() {
  return { path: null, offset: 0, lines: [] };
}

function readNewLines(reader, file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return [];
  }
  if (reader.path !== file) {
    reader.path = file;
    reader.offset = 0;
    reader.pending = "";
  }
  if (st.size < reader.offset) {
    /* 文件被截断/替换，重来 */
    reader.offset = 0;
    reader.pending = "";
  }
  if (st.size === reader.offset) return [];
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const len = st.size - reader.offset;
    const buf = Buffer.alloc(len);
    /* readSync 不保证一次读满（大文件/被杀毒软件扫的瞬间会短读），循环读 */
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, reader.offset + got);
      if (!n) break;
      got += n;
    }
    reader.offset += got;
    /* 上次没读完的半行接到这次前面，末尾半行留到下次 */
    const parts = (reader.pending + buf.subarray(0, got).toString("utf8")).split("\n");
    reader.pending = parts.pop();
    return parts.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/* ---------- 找会话的 segment 文件 ---------- */
/* 注意：缓存必须按 sid 分别存。早先的实现每次刷新只扫描「当前这次请求的 sid」，
 * 然后把整个 map 换掉 —— 多会话/多标签页时 A 刚查完，B 的缓存就被 A 冲掉了，
 * 结果是几个会话轮流拿到 null（或一直拿到同一个会话的数据）。 */
let sessionCache = { at: 0, map: new Map() };

function scanSessionFiles(sid) {
  const root = path.join(logsRoot(), "sessions");
  let slugs = [];
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true });
  } catch {}
  const all = [];
  for (const s of slugs) {
    if (!s.isDirectory()) continue;
    const segDir = path.join(root, s.name, sid, "segments");
    let files = [];
    try {
      files = fs.readdirSync(segDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) all.push(path.join(segDir, f));
  }
  return all.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function sessionFiles(sid) {
  const now = Date.now();
  /* 每 3 秒整体失效一次：新 segment 文件（runtime 重启）能被发现 */
  if (now - sessionCache.at > 3000) {
    sessionCache = { at: now, map: new Map() };
  }
  if (sessionCache.map.has(sid)) return sessionCache.map.get(sid);
  const files = scanSessionFiles(sid);
  sessionCache.map.set(sid, files);
  return files;
}

/* ---------- 状态机 ---------- */
const state = new Map(); /* sid -> {segReader, runReader, requests, completes, turns, headers} */

function getState(sid) {
  let s = state.get(sid);
  if (!s) {
    s = {
      segReaders: new Map(), /* segment 文件 -> reader */
      runReaders: new Map(), /* run 日志 -> reader */
      requests: new Map(), /* rid -> {ts, turnId, model} */
      completes: new Map(), /* rid -> {ts, out, inp, cr} */
      turns: [], /* {ts, turnId, model} */
      /* turn_id 会在两类事件里出现，必须分开记：
       *   - 用户主轮 turn.started（is_subagent=false）
       *   - 子代理 turn.started：有的平台直接复用父轮 turn_id（is_subagent=true）
       * 只靠 turn_id 去重分不出「同一个轮被重复记录」和「子代理轮」，
       * 所以同时记录两个集合，后面按「只当过子代理的 id」剔除。 */
      mainTurnIds: new Set(),
      subTurnIds: new Set(),
      headers: new Map(), /* rid -> 首字时刻 */
    };
    state.set(sid, s);
  }
  return s;
}

/* 请求表会随会话增长，砍掉最老的，保留最近 5000 条足够回退用 */
function prune(s) {
  while (s.requests.size > 5000) {
    const oldest = s.requests.keys().next().value;
    s.requests.delete(oldest);
    s.completes.delete(oldest);
  }
  while (s.turns.length > 200) s.turns.shift();
}

function parseSegmentLine(s, line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const type = o.type;
  if (type === "model.request.started") {
    const rid = o.request_id;
    if (!rid) return;
    s.requests.set(rid, {
      ts: Date.parse(o.ts),
      turnId: o.turn_id || null,
      model: o.data && o.data.model ? o.data.model : null,
    });
  } else if (type === "model.response.completed") {
    const rid = o.request_id;
    if (!rid) return;
    const d = o.data || {};
    s.completes.set(rid, {
      ts: Date.parse(o.ts),
      out: d.output_tokens || 0,
      inp: d.input_tokens || 0,
      cr: d.cache_read_input_tokens || 0,
      cc: d.cache_creation_input_tokens || 0,
    });
  } else if (type === "turn.started") {
    const turnId = o.turn_id || null;
    /* 没有 turn_id 的启动事件没法跟请求对上，丢弃 */
    if (!turnId) return;
    const sub = !!(o.data && o.data.is_subagent);
    if (sub) s.subTurnIds.add(turnId);
    else s.mainTurnIds.add(turnId);
    const t = {
      ts: Date.parse(o.ts),
      turnId,
      model: o.data && o.data.model ? o.data.model : null,
      sub,
    };
    /* 多个 segment 文件按时间顺序并进来，turns 要保持按时间排 */
    if (!s.turns.length || s.turns[s.turns.length - 1].ts <= t.ts) s.turns.push(t);
    else {
      let i = s.turns.length;
      while (i > 0 && s.turns[i - 1].ts > t.ts) i--;
      s.turns.splice(i, 0, t);
    }
    if (s.turns.length > 200) s.turns.shift();
  }
}

const RE_HEADER =
  /^(\S+)\s.*qoderRequestId=([0-9a-fA-F-]{8,64}).*phase=headers_received/;

function parseRunLine(s, line) {
  if (line.indexOf("headers_received") < 0) return;
  const m = RE_HEADER.exec(line);
  if (!m) return;
  const t = Date.parse(m[1]);
  if (isFinite(t)) s.headers.set(m[2], t);
}

/* 取某轮的请求；includeIncomplete=true 时连还没结束的请求一起返回 */
function rowsForTurn(s, turn, includeIncomplete) {
  const turnTs = turn ? turn.ts : 0;
  const turnId = turn ? turn.turnId : null;
  const rows = [];
  for (const [rid, req] of s.requests) {
    const cmp = s.completes.get(rid);
    if (!cmp && !includeIncomplete) continue;
    const inTurn = turnId && req.turnId ? req.turnId === turnId : req.ts >= turnTs;
    if (!inTurn) continue;
    rows.push({
      rid,
      start: req.ts,
      end: cmp ? cmp.ts : null,
      first: s.headers.get(rid) || null,
      out: cmp ? cmp.out : 0,
      inp: cmp ? cmp.inp : 0,
      cr: cmp ? cmp.cr : 0,
      model: req.model,
    });
  }
  rows.sort((a, b) => a.start - b.start);
  return rows;
}

/* 首字：只看请求有没有开始吐字（headers），不等它结束。
 * 等「请求完成」才算的话，模型刚开始吐字那一段首字是空的。 */
function ttftOf(rows, turnTs) {
  if (!turnTs) return null;
  const firsts = [];
  for (const r of rows) if (r.first) firsts.push(r.first);
  if (!firsts.length) return null;
  const f = Math.min.apply(null, firsts);
  return f > turnTs ? (f - turnTs) / 1000 : null;
}

/* 一轮的统计，口径与 Zcode-Status-TypeBar 对齐：
 *   速度   = Σ输出 ÷ Σ(首字时刻 → 完成时刻)      [本轮加权纯生成速度]
 *            取不到就退到 末次请求的纯生成速度 → 末次请求的端到端
 *   首字   = 本轮首个「开始吐字」时刻 − 本轮开始时刻（轮级，含客户端准备段）
 *   缓存   = 末次请求的 cache_read ÷ input
 *   端到端 = Σ输出 ÷ Σ(请求发出 → 完成)
 * 输出 token 已含思考链（实测一次响应 3903 token 对应 15397 字符 thinking 内容），
 * 所以分子与 ZCode 的「输出 + 思考」等价。 */
function turnStats(s, turn) {
  const rows = rowsForTurn(s, turn, true);
  const done = rows.filter((r) => r.end !== null);
  const ok = done.filter((r) => r.first && r.end > r.first);

  const genMs = ok.reduce((a, r) => a + (r.end - r.first), 0);
  const genOut = ok.reduce((a, r) => a + r.out, 0);
  /* 没有任何输出 token 的轮（请求被中止 / provider 不回报 token）不能算成 0 tok/s，
   * 那会把「没有数据」显示成「速度 0」，并顶掉上一轮的真实读数。 */
  const tpsGen = genOut > 0 && genMs > 0 ? genOut / (genMs / 1000) : null;

  const e2eMs = done.reduce((a, r) => a + (r.end - r.start), 0);
  const outAll = done.reduce((a, r) => a + r.out, 0);
  const tpsE2e = outAll > 0 && e2eMs > 0 ? outAll / (e2eMs / 1000) : null;

  const last = done.length ? done[done.length - 1] : null;
  const tpsLast =
    last && last.out > 0 && last.first && last.end > last.first
      ? last.out / ((last.end - last.first) / 1000)
      : null;
  const tpsLastE2E =
    last && last.out > 0 && last.end > last.start
      ? last.out / ((last.end - last.start) / 1000)
      : null;

  const cache = last && last.inp > 0 ? (last.cr / last.inp) * 100 : null;
  const ttft = ttftOf(rows, turn ? turn.ts : 0);

  return {
    tpsGen,
    tpsE2e,
    tpsLast,
    tpsLastE2E,
    speed: tpsGen !== null ? tpsGen : tpsLast !== null ? tpsLast : tpsLastE2E,
    cache,
    ttft,
    requests: done.length,
    outTokens: outAll,
    lastEnd: last ? last.end : null,
    inflight: rows.some((r) => r.end === null),
  };
}

/* 过滤内部轮次：这些不是用户发起的对话轮，而是客户端在后台做的事，
 * 读数不能拿它们充数（典型症状：压缩上下文后缓存显示 0%、速度变成压缩任务的速度）。
 *   - <uuid>-fork-compact   上下文压缩
 *   - skill-evolution-*     技能演化
 *   - memory-fork-*         记忆整理 */
function isRealTurn(t) {
  const id = String((t && t.turnId) || "");
  if (/-fork-compact$/i.test(id)) return false;
  if (/^skill-evolution-/i.test(id)) return false;
  if (/^memory-fork-/i.test(id)) return false;
  return true;
}

export function computeMetrics(sid, now = Date.now()) {
  const files = sessionFiles(sid);
  if (!files.length) return null;
  const s = getState(sid);

  /* 一个会话可能跨多个 runtime 进程（桌面端每次重启 agent 就换一个 segment 文件），
   * 全部读进来合并：早先的轮次才能作为「上一轮」回退来源。
   * 每个文件各自一个增量 reader，只读增量。 */
  for (const segFile of files) {
    let reader = s.segReaders.get(segFile);
    if (!reader) {
      reader = makeReader();
      s.segReaders.set(segFile, reader);
    }
    for (const line of readNewLines(reader, segFile)) parseSegmentLine(s, line);

    /* run 目录与 segment 同名 */
    const runLog = path.join(
      logsRoot(),
      "runs",
      path.basename(segFile, ".jsonl"),
      "qodercli.log"
    );
    if (!fs.existsSync(runLog)) continue;
    let rr = s.runReaders.get(runLog);
    if (!rr) {
      rr = makeReader();
      s.runReaders.set(runLog, rr);
    }
    for (const line of readNewLines(rr, runLog)) parseRunLine(s, line);
  }
  prune(s);

  /* 同一个 turn_id 会被重复记录：runtime 重启、子代理复用父轮 id、多个窗口打开
   * 同一会话时都会再发一次 turn.started。这里按 turn_id 去重，保留最早的那次
   * （首字要拿用户真正发起本轮的时刻算），并剔除「只以子代理身份出现过」的轮。 */
  const seenTurnIds = new Set();
  const realTurns = [];
  const sortedTurns = s.turns
    .filter((t) => t && t.turnId && isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);
  for (const t of sortedTurns) {
    if (seenTurnIds.has(t.turnId)) continue;
    seenTurnIds.add(t.turnId);
    if (!isRealTurn(t)) continue;
    if (s.subTurnIds.has(t.turnId) && !s.mainTurnIds.has(t.turnId)) continue;
    realTurns.push(t);
  }
  const cur = realTurns.length ? realTurns[realTurns.length - 1] : null;
  const curStats = cur ? turnStats(s, cur) : null;

  /* 逐项回退：当前轮没有就找更早的轮，保证三项任何时候都有值 */
  function pick(getter) {
    if (curStats) {
      const v = getter(curStats);
      if (v !== null && v !== undefined) return v;
    }
    for (let i = realTurns.length - 2; i >= 0; i--) {
      const v = getter(turnStats(s, realTurns[i]));
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  const speed = pick((st) => st.speed);
  const cache = pick((st) => st.cache);
  const ttft = pick((st) => st.ttft);
  const e2e = pick((st) => st.tpsE2e);

  /* 当前轮还在跑的请求 */
  let inflight = null;
  if (curStats) {
    const rows = rowsForTurn(s, cur, true);
    for (const r of rows) {
      if (r.end !== null) continue;
      const age = (now - r.start) / 1000;
      /* 超过 5 分钟还没结束的请求算残留事件（进程被杀/断连），不当成还在生成 */
      if (age < 0 || age > 300) continue;
      if (inflight === null || age > inflight) inflight = age;
    }
  }

  return {
    speed,
    e2e,
    ttft,
    cache,
    requests: curStats ? curStats.requests : 0,
    outTokens: curStats ? curStats.outTokens : 0,
    model: (cur && cur.model) || (curStats && curStats.lastModel) || null,
    age: curStats && curStats.lastEnd ? (now - curStats.lastEnd) / 1000 : null,
    turnStarted: cur ? cur.ts : null,
    stale: false,
    inflight,
  };
}
