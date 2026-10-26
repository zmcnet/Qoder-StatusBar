/* 打包发布用的 zip：node tools/pack.mjs
 *
 * 只从 git HEAD 取文件（git archive），工作区里没提交的改动不会进包 ——
 * 发出去的包必须能对应到一个确定的 commit，不然 README 里写的文件和用户
 * 装到机器上的文件会悄悄对不上。
 * 顶层目录名 Qoder-Status-TypeBar/ 是安装器解压后找 runtime/ 的前提，不能改。
 * 版本号取 package.json，跟 .qoder-plugin/plugin.json 一起改才不会漏。
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".qoder-plugin", "plugin.json"), "utf8")
);
if (manifest.version !== version) {
  console.error(
    "版本不一致：package.json=" + version + " plugin.json=" + manifest.version
  );
  process.exit(1);
}

const slug = path.basename(ROOT);
const outName = slug + "-v" + version + ".zip";
const outPath = path.join(ROOT, "dist", outName);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
try { fs.unlinkSync(outPath); } catch {}

execFileSync(
  "git",
  ["archive", "--format=zip", "--prefix=" + slug + "/", "-o", outPath, "HEAD"],
  { cwd: ROOT, stdio: "inherit" }
);

const buf = fs.readFileSync(outPath);
const sha = crypto.createHash("sha256").update(buf).digest("hex");
console.log("zip     :", outPath);
console.log("size    :", buf.length);
console.log("sha256  :", sha);
console.log("installers must pin: v" + version + " / sha256 " + sha);
