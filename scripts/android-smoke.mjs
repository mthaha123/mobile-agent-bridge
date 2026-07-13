#!/usr/bin/env node
/**
 * Mobile Agent Bridge — Android Smoke Test
 *
 * 检测模拟器 → 装 APK → 启动 app → 抓日志 → 截图 → 清理
 *
 * 用法:
 *   node scripts/android-smoke.mjs [-s <serial>]
 *
 * 前置条件:
 *   - 模拟器已在运行 (adb devices 能看到)
 *   - APK 已构建
 */

const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error("\n[FATAL] 全局超时 — 测试未在 120s 内完成，强制退出")
  process.exit(1)
}, 120000)

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { existsSync, writeFileSync, statSync } from "node:fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

function androidHome() {
  return process.env.ANDROID_HOME ||
    resolve(process.env.LOCALAPPDATA || "C:\\Users\\MT\\AppData\\Local", "Android", "Sdk")
}

const ADB = resolve(androidHome(), "platform-tools", "adb.exe")
const APK = resolve(rootDir, "apps", "mobile", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")
const PACKAGE = "com.mobileagentbridge"
const ACTIVITY = ".MainActivity"
const args = process.argv.slice(2)
const serialFlag = args.includes("-s") ? ["-s", args[args.indexOf("-s") + 1]] : []
const SERIAL = serialFlag.length > 0 ? serialFlag[1] : null

let passed = 0
let failed = 0

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }
function ok(label, detail) { console.log(`  ${green("✓")} ${label}${detail ? ` (${detail})` : ""}`); passed++ }
function fail(label, detail) { console.log(`  ${red("✗")} ${label}${detail ? `: ${detail}` : ""}`); failed++ }

function adb(argsArr, opts = {}) {
  return new Promise((resolve, reject) => {
    const allArgs = serialFlag.concat(argsArr)
    const child = spawn(ADB, allArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts })
    let out = ""; let err = ""
    child.stdout.on("data", (c) => { out += c.toString() })
    child.stderr.on("data", (c) => { err += c.toString() })
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || out)))
    child.on("error", reject)
  })
}

// ─── 0. 检查前置条件 ─────────────────────────────────

console.log(`\n${yellow("═══════════════════════════════════════════")}`)
console.log("  Mobile Agent Bridge — Android Smoke Test")
console.log(`${yellow("═══════════════════════════════════════════")}\n`)

if (!existsSync(APK)) { console.error(`  ${red("✗")} APK 未找到,请先 build`); clearTimeout(GLOBAL_TIMEOUT); process.exit(1) }
ok("APK 存在")

if (!existsSync(ADB)) { console.error(`  ${red("✗")} adb 未找到`); clearTimeout(GLOBAL_TIMEOUT); process.exit(1) }
ok("adb 可用")

// ─── 1. 检测设备 ─────────────────────────────────

console.log(`\n${yellow("▶")} 检测设备...`)
try {
  const devOut = await adb(["devices"])
  const lines = devOut.split("\n").filter(l => l.includes("device") && !l.includes("devices\n"))
  const devices = lines.filter(l => l.includes("\tdevice")).map(l => l.split("\t")[0].trim())
  const serial = SERIAL || devices[0]
  if (!serial) { fail("未发现可用设备"); clearTimeout(GLOBAL_TIMEOUT); process.exit(1) }
  ok("设备已连接", serial)
} catch (e) { fail("设备检测失败", e.message); clearTimeout(GLOBAL_TIMEOUT); process.exit(1) }

// ─── 2. 等待启动完成 ───────────────────────────────

console.log(`  ${yellow("⌛")} 等待启动完成...`)
for (let i = 0; i < 60; i++) {
  try {
    const boot = (await adb(["shell", "getprop", "sys.boot_completed"])).trim()
    if (boot === "1") { ok("系统已就绪", i === 0 ? "即时就绪" : `~${i}s`); break }
  } catch { }
  await new Promise(r => setTimeout(r, 1000))
}

// ─── 3. 安装 APK ───────────────────────────────────

console.log(`\n${yellow("▶")} 安装 APK...`)
try {
  const out = await adb(["install", "-r", APK], { timeout: 60000 })
  if (out.includes("Success")) ok("APK 安装成功")
  else fail("APK 安装失败")
} catch (e) { fail("APK 安装异常", e.message); clearTimeout(GLOBAL_TIMEOUT); process.exit(1) }

// ─── 4. 启动 app ───────────────────────────────────

console.log(`\n${yellow("▶")} 启动应用...`)
try {
  await adb(["shell", "am", "start", "-n", `${PACKAGE}/${ACTIVITY}`], { timeout: 10000 })
  ok("应用已启动")
} catch (e) { fail("应用启动失败", e.message) }

await new Promise(r => setTimeout(r, 8000))

// ─── 5. 检查日志 ───────────────────────────────────

console.log(`\n${yellow("▶")} 检查日志...`)
try {
  const log = await adb(["logcat", "-d", "-t", "200"], { timeout: 10000 })
  const lines = log.split("\n")
  const ourCrashes = lines.filter(l => /FATAL EXCEPTION/i.test(l) && l.includes(PACKAGE))
  if (ourCrashes.length === 0) ok("无应用崩溃日志")
  else fail(`发现 ${ourCrashes.length} 条崩溃日志`)

  const started = lines.filter(l => l.includes("Displayed") && l.includes(PACKAGE))
  if (started.length > 0) ok("Activity 已显示", started[0].match(/\+(\S+)/)?.[1] || "")
  else fail("未检测到 Activity 显示")
} catch (e) { fail("日志检查失败", e.message) }

// ─── 6. 截图 ───────────────────────────────────────

console.log(`\n${yellow("▶")} 截图...`)
const screenshotPath = resolve(rootDir, "scripts", "android-smoke-screenshot.png")
try {
  const child = spawn(ADB, serialFlag.concat(["exec-out", "screencap", "-p"]), { stdio: ["ignore", "pipe", "pipe"] })
  const chunks = []
  child.stdout.on("data", c => chunks.push(c))
  await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject) })
  writeFileSync(screenshotPath, Buffer.concat(chunks))
  ok("截图已保存", `${(statSync(screenshotPath).size / 1024).toFixed(0)} KB`)
} catch (e) { fail("截图失败", e.message) }

// ─── 结果 ──────────────────────────────────────────

console.log(`\n${yellow("═══════════════════════════════════════════")}`)
if (failed === 0) console.log(`  ${green("全部通过!")} ${passed}/${passed + failed} 个断言通过`)
else console.log(`  ${red(`${failed} 个检查失败!`)} ${passed}/${passed + failed} 个断言通过`)
console.log(`${yellow("═══════════════════════════════════════════")}\n`)

clearTimeout(GLOBAL_TIMEOUT)
process.exit(failed > 0 ? 1 : 0)
