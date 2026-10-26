/* 启动器：
 *   node launcher.mjs            启动 Qoder（带 CDP 端口）并拉起注入器
 *   node launcher.mjs --stop     结束注入器
 *   node launcher.mjs --inject   只拉起注入器（Qoder 已经带端口在跑时）
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.QODER_CDP_PORT || "9222";
const QODER_EXE =
  process.env.QODER_EXE ||
  path.join(
    process.env.LOCALAPPDATA || "",
    "Programs",
    "Qoder",
    "Qoder.exe"
  );
const PIDFILE = path.join(HERE, "injector.pid");
const LOGDIR = path.join(HERE, "logs");
const LAUNCH_LOG = path.join(LOGDIR, "launcher.log");

/* 启动过程也写日志：桌面快捷方式是隐藏窗口跑的，出错时没有窗口可看 */
function log(...a) {
  const line = a.join(" ");
  try {
    fs.mkdirSync(LOGDIR, { recursive: true });
    fs.appendFileSync(LAUNCH_LOG, new Date().toISOString() + " " + line + "\n");
  } catch {}
  console.log(line);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ELECTRON_RUN_AS_NODE 存在时 Qoder.exe 会被当成 node 启动，必须彻底删掉 */
function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function qoderRunning() {
  try {
    const out = execSync("tasklist /FI \"IMAGENAME eq Qoder.exe\" /NH", {
      encoding: "utf8",
      shell: "cmd.exe",
    });
    return /Qoder\.exe/i.test(out);
  } catch {
    return false;
  }
}

function killOldInjectors() {
  /* 只能有一个注入器：多个会互相灌 overlay，页面上的数字来回跳 */
  try {
    if (fs.existsSync(PIDFILE)) {
      const pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
      try {
        process.kill(pid);
      } catch {}
      fs.unlinkSync(PIDFILE);
    }
  } catch {}
  try {
    /* 用 -EncodedCommand 避开 cmd 与 powershell 的多层引号地狱 */
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*injector.mjs*' } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
    const enc = Buffer.from(script, "utf16le").toString("base64");
    execSync(`powershell -NoProfile -EncodedCommand ${enc}`, {
      encoding: "utf8",
      shell: "cmd.exe",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {}
}

function startInjector() {
  killOldInjectors();
  fs.mkdirSync(LOGDIR, { recursive: true });
  const logFile = path.join(LOGDIR, "injector.log");
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      fs.truncateSync(logFile, 0);
    }
  } catch {}
  const out = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [path.join(HERE, "injector.mjs"), "--port", PORT],
    {
      detached: true,
      stdio: ["ignore", out, out],
      env: cleanEnv(),
    }
  );
  child.unref();
  fs.writeFileSync(PIDFILE, String(child.pid));
  return child.pid;
}

function stopInjector() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    process.kill(pid);
    fs.unlinkSync(PIDFILE);
    log("注入器已结束 (pid " + pid + ")");
  } catch (e) {
    log("没有正在运行的注入器");
  }
}

const args = process.argv.slice(2);

if (args.includes("--stop")) {
  stopInjector();
  process.exit(0);
}

if (args.includes("--inject")) {
  log("注入器已启动，端口 " + PORT + "，pid " + startInjector());
  process.exit(0);
}

if (!(await cdpAlive())) {
  if (qoderRunning() && process.env.QODER_FORCE !== "1") {
    log(
      "检测到 Qoder 已在运行，但没有开启调试端口。\n" +
        "请完全退出 Qoder（托盘也要退出）后重新执行本脚本。"
    );
    process.exit(1);
  }
  if (!fs.existsSync(QODER_EXE)) {
    log("找不到 Qoder.exe：" + QODER_EXE);
    process.exit(1);
  }
  log("正在启动 Qoder（带调试端口 " + PORT + "）…");
  const child = spawn(QODER_EXE, ["--remote-debugging-port=" + PORT], {
    detached: true,
    stdio: "ignore",
    env: cleanEnv(),
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (await cdpAlive()) break;
  }
}

if (!(await cdpAlive())) {
  log("调试端口没起来，启动失败。");
  process.exit(1);
}
log("注入器已启动，端口 " + PORT + "，pid " + startInjector());
