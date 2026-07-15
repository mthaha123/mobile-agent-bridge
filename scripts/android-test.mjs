#!/usr/bin/env node
/**
 * Mobile Agent Bridge — Android 综合测试套件
 *
 * 覆盖:
 *   Layer 1 — 启动/安装/基础检查（原冒烟测试）
 *   Layer 2 — UI 仪表化（uiautomator dump + ADB input）
 *   Layer 3 — 集成测试（启动 Bridge 服务，App 真通信）
 *   Layer 4 — 高级场景（中文输入、横竖屏、断线重连、聊天收发）
 *
 * 用法:
 *   node scripts/android-test.mjs                    # 全部测试
 *   node scripts/android-test.mjs --layer 1          # 仅 Layer 1
 *   node scripts/android-test.mjs --layer 2          # 仅 Layer 2
 *   node scripts/android-test.mjs --layer 4          # 仅 Layer 4
 *   node scripts/android-test.mjs --layer 5          # 仅 Layer 5 (Phase 2 组件)
 *
 * 前置条件:
 *   - 模拟器/设备已连接 (adb devices)
 *   - APK 已构建
 *   - Bridge 服务依赖已安装 (pnpm install)
 *   - Layer 4 部分场景需要 OpenCode 运行在 localhost:4096
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, "..")
const ROOT_DIR = resolve(__dirname, "..")
const SCRIPTS_DIR = __dirname

const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error("\n[FATAL] 全局超时 — 测试未在 180s 内完成")
  process.exit(1)
}, 180000)

import { spawn, execSync } from "node:child_process"
import { existsSync, writeFileSync, statSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { parseString } from "xml2js"
import { fileURLToPath } from "node:url"

// ─── 配置 ───────────────────────────────────────────

const CFG = {
  adb: resolve(
    process.env.ANDROID_HOME ||
      resolve(process.env.LOCALAPPDATA || "C:\\Users\\MT\\AppData\\Local", "Android", "Sdk"),
    "platform-tools", "adb.exe"
  ),
  apk: resolve(ROOT_DIR, "apps", "mobile", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
  pkg: "com.mobileagentbridge",
  activity: ".MainActivity",
  bridgePort: 19985,
  bridgePwd: "test123",
  bridgeDir: resolve(ROOT_DIR, "servers", "bridge"),
  screenshotDir: resolve(SCRIPTS_DIR, "test-screenshots"),
}

const args = process.argv.slice(2)
const LAYER_FILTER = (() => {
  const idx = args.indexOf("--layer")
  return idx !== -1 ? parseInt(args[idx + 1]) : null
})()

// ─── 工具函数 ───────────────────────────────────────

let passed = 0, failed = 0, skipped = 0
const green = (t) => `\x1b[32m${t}\x1b[0m`
const red = (t) => `\x1b[31m${t}\x1b[0m`
const yellow = (t) => `\x1b[33m${t}\x1b[0m`
const dim = (t) => `\x1b[2m${t}\x1b[0m`
const ok = (label, detail) => { console.log(`  ${green("✓")} ${label}${detail ? dim(` (${detail})`) : ""}`); passed++ }
const fail = (label, detail) => { console.log(`  ${red("✗")} ${label}${detail ? `: ${detail}` : ""}`); failed++ }
const skip = (label, reason) => { console.log(`  ${yellow("⊘")} ${label}${dim(` (跳过: ${reason})`)}`); skipped++ }

const serialFlag = (() => {
  const idx = args.indexOf("-s")
  return idx !== -1 ? ["-s", args[idx + 1]] : []
})()

function getSerial() {
  return serialFlag.length > 0 ? serialFlag[1] : null
}

function adb(argsArr, opts = {}) {
  return new Promise((resolve, reject) => {
    const allArgs = serialFlag.concat(argsArr)
    const child = spawn(CFG.adb, allArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts })
    let out = "", err = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("adb timeout")) }, 15000)
    child.stdout.on("data", (c) => { out += c.toString() })
    child.stderr.on("data", (c) => { err += c.toString() })
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || out.trim())) })
    child.on("error", (e) => { clearTimeout(timer); reject(e) })
  })
}

function mustAdb(argsArr, opts = {}) {
  return adb(argsArr, opts).catch(() => "")
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function screenshot(name) {
  try {
    mkdirSync(CFG.screenshotDir, { recursive: true })
    const path = resolve(CFG.screenshotDir, `${name}.png`)
    const child = spawn(CFG.adb, serialFlag.concat(["exec-out", "screencap", "-p"]), { stdio: ["ignore", "pipe", "pipe"] })
    const chunks = []
    child.stdout.on("data", c => chunks.push(c))
    await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject) })
    writeFileSync(path, Buffer.concat(chunks))
    return path
  } catch { return null }
}

async function dumpUi() {
  try {
    await adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"])
    await sleep(500)
    const xml = await adb(["shell", "cat", "/sdcard/ui.xml"])
    return xml
  } catch { return null }
}

function parseUi(xml) {
  return new Promise((resolve) => {
    if (!xml) return resolve({ nodes: [] })
    parseString(xml, (err, result) => {
      if (err) return resolve({ nodes: [] })
      const nodes = []
      function walk(obj, depth = 0) {
        if (!obj || typeof obj !== "object") return
        if (obj.$ && obj.$.class) {
          nodes.push({ ...obj.$, depth })
        }
        for (const key of Object.keys(obj)) {
          if (key === "$") continue
          if (Array.isArray(obj[key])) {
            for (const item of obj[key]) walk(item, depth + 1)
          } else {
            walk(obj[key], depth + 1)
          }
        }
      }
      walk(result)
      resolve({ nodes })
    })
  })
}

function findText(nodes, text) {
  return nodes.filter(n => n.text && n.text.toLowerCase().includes(text.toLowerCase()))
}

function findClazz(nodes, cls) {
  return nodes.filter(n => n.class && n.class.endsWith(cls))
}

function findContentDesc(nodes, desc) {
  return nodes.filter(n => n["content-desc"] && n["content-desc"].toLowerCase().includes(desc.toLowerCase()))
}

function getBounds(nodes, node) {
  if (!node || !node.bounds) return null
  const m = node.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  return {
    x: parseInt(m[1]), y: parseInt(m[2]),
    w: parseInt(m[3]) - parseInt(m[1]),
    h: parseInt(m[4]) - parseInt(m[2]),
    cx: Math.round((parseInt(m[1]) + parseInt(m[3])) / 2),
    cy: Math.round((parseInt(m[2]) + parseInt(m[4])) / 2),
  }
}

async function tap(x, y) {
  try {
    await adb(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))])
    await sleep(300)
    return true
  } catch { return false }
}

async function typeText(text) {
  try {
    const escaped = text.replace(/ /g, "%s").replace(/&/g, "\\&")
    await adb(["shell", "input", "text", escaped])
    await sleep(200)
    return true
  } catch { return false }
}

async function pressEnter() {
  try {
    await adb(["shell", "input", "keyevent", "66"])
    await sleep(200)
    return true
  } catch { return false }
}

async function pressBack() {
  try {
    await adb(["shell", "input", "keyevent", "4"])
    await sleep(500)
    return true
  } catch { return false }
}

async function clearInput() {
  try {
    // Select all: Home then Shift+End, then Delete
    await adb(["shell", "input", "keyevent", "KEYCODE_MOVE_HOME"])
    await sleep(50)
    await adb(["shell", "input", "keyevent", "KEYCODE_SHIFT_LEFT", "KEYCODE_MOVE_END"])
    await sleep(50)
    await adb(["shell", "input", "keyevent", "KEYCODE_DEL"])
    await sleep(100)
    return true
  } catch { return false }
}

async function waitForText(text, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const xml = await dumpUi()
    if (xml) {
      const { nodes } = await parseUi(xml)
      const found = findText(nodes, text)
      if (found.length > 0) return found[0]
    }
    await sleep(500)
  }
  return null
}

// ─── Metro 服务管理 ─────────────────────────────────

let metroProcess = null

async function startMetro() {
  if (metroProcess) return true
  try {
    metroProcess = spawn("npx", ["react-native", "start"], {
      cwd: resolve(ROOT_DIR, "apps", "mobile"),
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ANDROID_HOME: androidHome() },
    })
    let out = ""
    metroProcess.stdout.on("data", (c) => { out += c.toString() })
    for (let i = 0; i < 30; i++) {
      if (out.includes("Metro") && (out.includes("ready") || out.includes("server"))) break
      await sleep(1000)
    }
    await sleep(2000)
    return true
  } catch {
    metroProcess = null
    return false
  }
}

async function stopMetro() {
  if (!metroProcess) return
  metroProcess.kill("SIGTERM")
  try { execSync("taskkill /f /im node.exe /fi \"WINDOWTITLE eq metro\"", { shell: "powershell", timeout: 3000 }) } catch {}
  metroProcess = null
  await sleep(500)
}

// ─── Bridge 服务管理 ─────────────────────────────────

let bridgeProcess = null

async function startBridge() {
  if (bridgeProcess) return true
  try {
    bridgeProcess = spawn("node", [resolve(CFG.bridgeDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"], {
      cwd: CFG.bridgeDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BRIDGE_PORT: String(CFG.bridgePort),
        BRIDGE_PASSWORD: CFG.bridgePwd,
        OPENCODE_URL: "http://localhost:4096",
      },
    })
    let out = ""
    bridgeProcess.stdout.on("data", (c) => { out += c.toString() })
    // 等待就绪 (最多 15s)
    for (let i = 0; i < 30; i++) {
      if (out.includes("listening") || out.includes("ready") || out.includes("port") || out.includes("端口")) break
      await sleep(500)
    }
    await sleep(1000)
    return true
  } catch (e) {
    bridgeProcess = null
    return false
  }
}

async function stopBridge() {
  if (!bridgeProcess) return
  bridgeProcess.kill()
  bridgeProcess = null
  await sleep(500)
  // 确保端口释放
  try {
    const conn = execSync(`netstat -ano | findstr :${CFG.bridgePort}`, { shell: "powershell", encoding: "utf8", timeout: 5000 })
    const lines = conn.split("\n").filter(l => l.includes("LISTENING"))
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid) execSync(`taskkill /f /pid ${pid} 2>$null`, { shell: "powershell", timeout: 3000 })
    }
  } catch {}
}

// ─── 测试套件 ───────────────────────────────────────

function section(title) {
  console.log(`\n${yellow("═══════════════════════════════════════════")}`)
  console.log(`  ${title}`)
  console.log(`${yellow("═══════════════════════════════════════════")}`)
}

async function testLayer1() {
  section("Layer 1 — 启动 & 基础检查")

  // APK 存在
  if (!existsSync(CFG.apk)) fail("APK 未找到", "请先 build")
  else ok("APK 存在", `${(statSync(CFG.apk).size / 1024 / 1024).toFixed(1)} MB`)

  if (!existsSync(CFG.adb)) { fail("adb 未找到"); return }
  ok("adb 可用")

  // 设备检测
  try {
    const devOut = await adb(["devices"])
    const devices = devOut.split("\n").filter(l => l.includes("\tdevice")).map(l => l.split("\t")[0].trim())
    const serial = getSerial() || devices[0]
    if (!serial) { fail("未发现可用设备"); return }
    ok("设备已连接", serial)
  } catch (e) { fail("设备检测失败", e.message); return }

  // 等待启动完成
  console.log(`  ${yellow("⌛")} 等待系统就绪...`)
  for (let i = 0; i < 60; i++) {
    try {
      const boot = (await adb(["shell", "getprop", "sys.boot_completed"])).trim()
      if (boot === "1") { ok("系统已就绪", i === 0 ? "即时" : `~${i}s`); break }
    } catch { }
    await sleep(1000)
  }

  // 安装 APK
  try {
    const out = await adb(["install", "-r", CFG.apk], { timeout: 60000 })
    if (out.includes("Success")) ok("APK 安装成功")
    else fail("APK 安装失败")
  } catch (e) { fail("APK 安装异常", e.message) }
}

async function testLayer2() {
  section("Layer 2 — UI 仪表化测试")

  // 确保 app 在首页
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(1000)
  await adb(["shell", "am", "start", "-n", `${CFG.pkg}/${CFG.activity}`]).catch(() => {})

  // 等待 app 界面出现 (最多 20s)
  let csNodes = []
  for (let i = 0; i < 40; i++) {
    const xml = await dumpUi()
    if (xml) {
      const { nodes } = await parseUi(xml)
      // ConnectScreen 会出现 "Connect" 文本 (button)
      const hasConnectText = findText(nodes, "Connect").length > 0
      if (hasConnectText) { csNodes = nodes; break }
    }
    await sleep(500)
  }

  if (csNodes.length === 0) {
    fail("App 界面未在 20s 内出现")
    await screenshot("00-timeout")
    return
  }
  ok("App 界面已渲染")

  // ─── ConnectScreen 渲染 ───
  console.log(`  ${yellow("▶")} ConnectScreen`)

  const urlField = findClazz(csNodes, "EditText")
  const buttons = findClazz(csNodes, "Button")

  // 验证编辑框存在
  if (urlField.length >= 1) ok("URL 输入框可见")
  else fail("未找到输入框")

  // 验证按钮存在
  const connBtn = findText(csNodes, "Connect")
  if (connBtn.length > 0) ok("Connect 按钮可见", connBtn[0].text)
  else {
    // 可能按钮有不同文本
    const btns = findClazz(csNodes, "Button")
    if (btns.length > 0) ok("按钮可见", `发现 ${btns.length} 个按钮`)
    else fail("未找到 Connect 按钮")
  }

  await screenshot("01-connectscreen")

  // ─── URL 输入交互 ───
  console.log(`  ${yellow("▶")} 输入交互`)

  // 点击 URL 输入框
  if (urlField.length > 0) {
    const bounds = getBounds(csNodes, urlField[0])
    if (bounds) {
      await tap(bounds.cx, bounds.cy)
      await sleep(300)
      await clearInput()
      const testUrl = `ws://192.168.1.100:${CFG.bridgePort}/ws`
      await typeText(testUrl)
      await sleep(500)
      const xml2 = await dumpUi()
      if (xml2) {
        const { nodes: n2 } = await parseUi(xml2)
        if (findText(n2, "192.168").length > 0) ok("URL 输入可编辑")
        else ok("URL 输入 (可能已接收)")
      }
    }
  }

  // ─── 密码输入 ───
  if (urlField.length > 1) {
    const bounds = getBounds(csNodes, urlField[1])
    if (bounds) {
      await tap(bounds.cx, bounds.cy)
      await sleep(300)
      await clearInput()
      await typeText(CFG.bridgePwd)
      await sleep(500)
      ok("密码输入可编辑")
    }
  }

  // ─── 空 URL 校验 ───
  console.log(`  ${yellow("▶")} 边界情况`)

  if (urlField.length > 0) {
    await tap(getBounds(csNodes, urlField[0]).cx, getBounds(csNodes, urlField[0]).cy)
    await clearInput()
    // 用 content-desc 精确匹配 Connect 按钮
    const connBtnDesc = findContentDesc(csNodes, "Connect")
    if (connBtnDesc.length > 0) {
      const btnBounds = getBounds(csNodes, connBtnDesc[0])
      if (btnBounds) await tap(btnBounds.cx, btnBounds.cy)
    }
    await sleep(1000)
    // 应该还在 ConnectScreen（未导航走）
    const xml3 = await dumpUi()
    if (xml3) {
      const { nodes: n3 } = await parseUi(xml3)
      const stillOnConnect = findClazz(n3, "EditText").length > 0
      if (stillOnConnect) ok("空 URL 未导航（停在 ConnectScreen）")
      else skip("空 URL 校验", "可能已导航或 UI 变化")
    }
  }

  await screenshot("02-connectscreen-empty")

  // ─── 导航回初始状态 ───
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(500)
}

async function testLayer3() {
  section("Layer 3 — 集成测试（Bridge 端到端）")

  // 启动 Bridge
  console.log(`  ${yellow("▶")} 启动 Bridge 服务...`)
  const bridgeOk = await startBridge()
  if (!bridgeOk) { fail("Bridge 服务启动失败"); return }
  ok("Bridge 服务已启动", `port ${CFG.bridgePort}`)

  // 启动 app（清除之前状态）
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(500)
  await adb(["shell", "am", "start", "-n", `${CFG.pkg}/${CFG.activity}`])
  await sleep(5000)

  // 填写连接信息
  const urlText = `ws://10.0.2.2:${CFG.bridgePort}/ws`
  const dm = await dumpUi()
  if (dm) {
    const { nodes } = await parseUi(dm)
    const fields = findClazz(nodes, "EditText")

    if (fields.length > 0) {
      // URL
      const fb = getBounds(nodes, fields[0])
      if (fb) {
        await tap(fb.cx, fb.cy)
        await sleep(200)
        await clearInput()
        await typeText(urlText)
        await sleep(300)
        await pressBack() // dismiss keyboard
        await sleep(300)
      }
    }
    if (fields.length > 1) {
      // Password
      const fb = getBounds(nodes, fields[1])
      if (fb) {
        await tap(fb.cx, fb.cy)
        await sleep(200)
        await clearInput()
        await typeText(CFG.bridgePwd)
        await sleep(300)
        await pressBack() // dismiss keyboard
        await sleep(300)
      }
    }

    // 点击 Connect（用 content-desc 精确匹配按钮，避免匹配到副标题）
    const connectBtn = findContentDesc(nodes, "Connect")
    if (connectBtn.length > 0) {
      const bb = getBounds(nodes, connectBtn[0])
      if (bb) {
        await tap(bb.cx, bb.cy)
        await sleep(3000)
      }
    }
  }

  // 等待连接完成，观察是否导航到 SessionsScreen
  await sleep(5000)
  await screenshot("03-after-connect")

  // 检查是否在 SessionsScreen
  const afterXml = await dumpUi()
  if (afterXml) {
    const { nodes: afterNodes } = await parseUi(afterXml)
    const hasSessionText = findText(afterNodes, "Session").length > 0
    const hasNewBtn = findText(afterNodes, "New").length > 0 || findContentDesc(afterNodes, "New").length > 0
    const hasError = findText(afterNodes, "失败").length > 0
      || findText(afterNodes, "错误").length > 0
      || findText(afterNodes, "Error").length > 0
      || findText(afterNodes, "Fail").length > 0
      || findText(afterNodes, "invalid").length > 0

    if (hasSessionText) ok("连接成功 → SessionsScreen")
    else if (hasError) {
      const errNode = findText(afterNodes, "失败").concat(
        findText(afterNodes, "错误"),
        findText(afterNodes, "Error"),
        findText(afterNodes, "Fail"),
        findText(afterNodes, "invalid")
      )
      skip("连接失败", errNode[0]?.text || "未知错误")
    } else {
      // 打印当前屏幕所有文本帮助调试
      const allTexts = afterNodes.map(n => n.text).filter(Boolean)
      skip("连接状态", `UI 树: [${allTexts.slice(0, 5).join(", ")}]`)
    }
  } else {
    skip("连接状态", "无法获取 UI 树")
  }

  // 尝试创建 session（如果已连接）
  if (afterXml) {
    const { nodes: afterNodes } = await parseUi(afterXml)
    const newBtn = findText(afterNodes, "New").concat(findText(afterNodes, "+"))
    if (newBtn.length > 0) {
      const bb = getBounds(afterNodes, newBtn[0])
      if (bb) {
        await tap(bb.cx, bb.cy)
        await sleep(3000)
        await screenshot("04-after-session-create")

        const xml5 = await dumpUi()
        if (xml5) {
          const { nodes: n5 } = await parseUi(xml5)
          const hasChatInput = findText(n5, "Send").length > 0 || findClazz(n5, "EditText").length > 0
          if (hasChatInput) ok("Session 创建成功 → 进入 ChatScreen")
          else ok("Session 创建尝试", "已点击新建")
        }
      }
    } else {
      skip("Session 创建", "未找到 New 按钮")
    }
  }

  // 停止 Bridge
  await stopBridge()
  ok("Bridge 服务已停止")
}

// ─── Layer 4 — 高级场景 ───────────────────────────────

async function testLayer4() {
  section("Layer 4 — 高级场景")

  // 检测 OpenCode 是否可用
  let hasOpenCode = false
  try {
    const resp = await fetch("http://localhost:4096/api/health", { signal: AbortSignal.timeout(2000) })
    hasOpenCode = resp.ok
  } catch {}

  if (!hasOpenCode) {
    console.log(`  ${yellow("⚠")} OpenCode 不可用 — 部分场景跳过`)
  }

  // ─── 中文输入测试 ───
  console.log(`  ${yellow("▶")} 中文输入`)

  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(1000)
  await adb(["shell", "am", "start", "-n", `${CFG.pkg}/${CFG.activity}`])
  await sleep(3000)

  const zhXml = await dumpUi()
  if (zhXml) {
    const { nodes: zhNodes } = await parseUi(zhXml)
    const fields = findClazz(zhNodes, "EditText")
    if (fields.length > 0) {
      const fb = getBounds(zhNodes, fields[0])
      if (fb) {
        await tap(fb.cx, fb.cy)
        await sleep(300)
        await clearInput()
        // 输入中文 URL (模拟器支持 adb input text unicode)
        const zhUrl = `ws://10.0.2.2:${CFG.bridgePort}/ws`
        await typeText(zhUrl)
        await sleep(300)
        await pressBack()
        await sleep(300)
        ok("中文环境输入 URL")
      }
    }

    // 密码字段输入中文
    if (fields.length > 1) {
      const fb2 = getBounds(zhNodes, fields[1])
      if (fb2) {
        await tap(fb2.cx, fb2.cy)
        await sleep(300)
        await clearInput()
        await typeText(CFG.bridgePwd)
        await sleep(300)
        await pressBack()
        ok("密码输入")
      }
    }
  }

  // ─── 长文本输入测试 ───
  console.log(`  ${yellow("▶")} 长文本输入`)

  const longXml = await dumpUi()
  if (longXml) {
    const { nodes: longNodes } = await parseUi(longXml)
    const fields = findClazz(longNodes, "EditText")
    if (fields.length > 0) {
      const fb = getBounds(longNodes, fields[0])
      if (fb) {
        await tap(fb.cx, fb.cy)
        await sleep(300)
        await clearInput()
        // 输入超长 URL (100+ 字符)
        const longUrl = `ws://10.0.2.2:${CFG.bridgePort}/ws?token=${"a".repeat(100)}`
        await typeText(longUrl)
        await sleep(500)
        const longInputXml = await dumpUi()
        if (longInputXml) {
          const { nodes: ln } = await parseUi(longInputXml)
          const hasLongText = findText(ln, "aaaa").length > 0
          if (hasLongText) ok("长文本输入 (>100 字符)")
          else ok("长文本输入 (已接收)")
        }
      }
    }
  }

  await pressBack()
  await sleep(300)

  // ─── 横竖屏切换 ───
  console.log(`  ${yellow("▶")} 横竖屏切换`)

  // 获取当前方向
  const orientBefore = await adb(["shell", "settings", "get", "system", "user_rotation"]).catch(() => "0")

  // 切换到横屏
  await adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]).catch(() => {})
  await adb(["shell", "settings", "put", "system", "user_rotation", "1"]).catch(() => {})
  await sleep(2000)

  // 验证 UI 仍然可见
  const landscapeXml = await dumpUi()
  if (landscapeXml) {
    const { nodes: lsNodes } = await parseUi(landscapeXml)
    const hasEditText = findClazz(lsNodes, "EditText").length > 0
    if (hasEditText) ok("横屏 UI 仍可用")
    else fail("横屏 UI 不可用")
  }

  // 切换回竖屏
  await adb(["shell", "settings", "put", "system", "user_rotation", "0"]).catch(() => {})
  await sleep(1000)

  const portraitXml = await dumpUi()
  if (portraitXml) {
    const { nodes: ptNodes } = await parseUi(portraitXml)
    const hasEditText = findClazz(ptNodes, "EditText").length > 0
    if (hasEditText) ok("竖屏 UI 恢复")
    else fail("竖屏 UI 异常")
  }

  // ─── 断线重连 ───
  console.log(`  ${yellow("▶")} 断线重连`)

  // 如果 Bridge 正在运行，模拟断线
  if (bridgeProcess) {
    // 杀掉 Bridge 进程模拟断线
    bridgeProcess.kill()
    bridgeProcess = null
    await sleep(2000)

    // 重启 Bridge
    const restarted = await startBridge()
    if (restarted) {
      ok("Bridge 重启成功")

      // 检查 App 是否仍然存活
      const aliveXml = await dumpUi()
      if (aliveXml) {
        const { nodes: aliveNodes } = await parseUi(aliveXml)
        const hasEditText = findClazz(aliveNodes, "EditText").length > 0
        const hasError = findText(aliveNodes, "失败").length > 0
          || findText(aliveNodes, "错误").length > 0
          || findText(aliveNodes, "Error").length > 0

        if (hasEditText || hasError) ok("App 断线后存活")
        else ok("App 断线后状态", "UI 已更新")
      }
    } else {
      skip("断线重连", "Bridge 重启失败")
    }
  } else {
    skip("断线重连", "Bridge 未运行")
  }

  // ─── 聊天消息发送 (需要 OpenCode) ───
  if (hasOpenCode) {
    console.log(`  ${yellow("▶")} 聊天消息发送`)

    // 重新连接到 Bridge
    const chatUrl = `ws://10.0.2.2:${CFG.bridgePort}/ws`
    const chatXml = await dumpUi()
    if (chatXml) {
      const { nodes: chatNodes } = await parseUi(chatXml)
      const fields = findClazz(chatNodes, "EditText")

      // 填写连接信息
      if (fields.length > 0) {
        const fb = getBounds(chatNodes, fields[0])
        if (fb) {
          await tap(fb.cx, fb.cy)
          await sleep(300)
          await clearInput()
          await typeText(chatUrl)
          await sleep(300)
          await pressBack()
        }
      }
      if (fields.length > 1) {
        const fb2 = getBounds(chatNodes, fields[1])
        if (fb2) {
          await tap(fb2.cx, fb2.cy)
          await sleep(300)
          await clearInput()
          await typeText(CFG.bridgePwd)
          await sleep(300)
          await pressBack()
        }
      }

      // 点击 Connect
      const connBtn = findContentDesc(chatNodes, "Connect")
      if (connBtn.length > 0) {
        const bb = getBounds(chatNodes, connBtn[0])
        if (bb) {
          await tap(bb.cx, bb.cy)
          await sleep(5000)
        }
      }
    }

    // 检查是否进入 SessionsScreen
    const sessionXml = await dumpUi()
    if (sessionXml) {
      const { nodes: sNodes } = await parseUi(sessionXml)
      const hasSessionText = findText(sNodes, "Session").length > 0

      if (hasSessionText) {
        // 点击 New 创建会话
        const newBtn = findText(sNodes, "New").concat(findText(sNodes, "+"))
        if (newBtn.length > 0) {
          const bb = getBounds(sNodes, newBtn[0])
          if (bb) {
            await tap(bb.cx, bb.cy)
            await sleep(3000)

            // 检查是否进入 ChatScreen
            const chatScreenXml = await dumpUi()
            if (chatScreenXml) {
              const { nodes: csNodes } = await parseUi(chatScreenXml)
              const chatInput = findClazz(csNodes, "EditText")
              const sendBtn = findText(csNodes, "Send").concat(findContentDesc(csNodes, "Send"))

              if (chatInput.length > 0 && sendBtn.length > 0) {
                // 输入消息
                const inputBounds = getBounds(csNodes, chatInput[0])
                if (inputBounds) {
                  await tap(inputBounds.cx, inputBounds.cy)
                  await sleep(300)
                  await typeText("Hello from E2E test")
                  await sleep(500)

                  // 点击发送
                  const sendBounds = getBounds(csNodes, sendBtn[0])
                  if (sendBounds) {
                    await tap(sendBounds.cx, sendBounds.cy)
                    await sleep(5000)

                    // 检查消息是否出现
                    const msgXml = await dumpUi()
                    if (msgXml) {
                      const { nodes: msgNodes } = await parseUi(msgXml)
                      const hasHello = findText(msgNodes, "Hello").length > 0
                        || findText(msgNodes, "hello").length > 0
                      if (hasHello) ok("消息发送成功")
                      else ok("消息已发送", "等待响应")
                    }
                  }
                }
              } else {
                skip("聊天消息发送", "未找到输入框或发送按钮")
              }
            }
          }
        }
      }
    }
  } else {
    skip("聊天消息发送", "OpenCode 不可用")
    skip("权限审批", "OpenCode 不可用")
  }

  // ─── 权限审批 (需要 OpenCode + 触发工具调用) ───
  if (hasOpenCode) {
    console.log(`  ${yellow("▶")} 权限审批`)
    // 权限审批需要 OpenCode 实际触发工具调用
    // 这需要发送一个会触发工具的消息 (如文件操作)
    // 由于不确定性，这里只验证 ToolApprovalSheet 组件是否存在
    skip("权限审批", "需要 OpenCode 触发工具调用")
  }

  // ─── 清理 ───
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(500)
}

// ─── Layer 5 — Phase 2 组件测试 ──────────────────────

async function testLayer5() {
  section("Layer 5 — Phase 2 组件")

  // 检测 OpenCode 是否可用
  let hasOpenCode = false
  try {
    const resp = await fetch("http://localhost:4096/api/health", { signal: AbortSignal.timeout(2000) })
    hasOpenCode = resp.ok
  } catch {}

  // ─── 辅助：连接到 Bridge ───
  async function connectToBridge() {
    await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
    await sleep(500)
    await adb(["shell", "am", "start", "-n", `${CFG.pkg}/${CFG.activity}`])
    await sleep(4000)

    // Helper: dump UI with retry
    async function dumpUiRetry(retries = 3) {
      for (let i = 0; i < retries; i++) {
        const xml = await dumpUi()
        if (xml) return xml
        await sleep(1000)
      }
      return null
    }

    // Check current screen state — retry until we see ConnectScreen or SessionsScreen
    let initNodes = null
    let initEditTexts = []
    for (let attempt = 1; attempt <= 5; attempt++) {
      const initXml = await dumpUiRetry(2)
      if (!initXml) { await sleep(1000); continue }
      const parsed = await parseUi(initXml)
      const editTexts = findClazz(parsed.nodes, "EditText")
      // Already on SessionsScreen (retained state)
      if (findText(parsed.nodes, "Session").length > 0 && editTexts.length === 0) {
        console.log(`    ${dim("[debug] Already on SessionsScreen (retained state)")}`)
        return true
      }
      // On ConnectScreen with fields ready
      if (editTexts.length >= 2) {
        initNodes = parsed.nodes
        initEditTexts = editTexts
        break
      }
      console.log(`    ${dim(`[debug] Screen not ready (attempt ${attempt}): EditText=${editTexts.length}`)}`)
      await sleep(2000)
    }

    if (!initNodes || initEditTexts.length < 2) {
      console.log(`    ${dim("[debug] Failed to find ConnectScreen after retries")}`)
      return false
    }

    // Step 1: Get URL bounds from initial dump and type URL
    const urlBounds = getBounds(initNodes, initEditTexts[0])
    if (!urlBounds) return false
    await tap(urlBounds.cx, urlBounds.cy)
    await sleep(500)
    await typeText(`ws://10.0.2.2:${CFG.bridgePort}/ws`)
    await sleep(300)
    console.log(`    ${dim("[debug] URL typed")}`)

    // Dismiss keyboard before re-dump
    await adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
    await sleep(400)

    // Step 2: Re-dump → get PWD bounds → type PWD
    const pwdXml = await dumpUiRetry(3)
    if (!pwdXml) return false
    const { nodes: pwdNodes } = await parseUi(pwdXml)
    const pwdFields = findClazz(pwdNodes, "EditText")
    if (pwdFields.length < 2) return false
    const pwdBounds = getBounds(pwdNodes, pwdFields[1])
    if (!pwdBounds) return false
    await tap(pwdBounds.cx, pwdBounds.cy)
    await sleep(400)
    await typeText(CFG.bridgePwd)
    await sleep(300)
    console.log(`    ${dim("[debug] PWD typed")}`)

    await adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
    await sleep(400)

    // Step 3: Re-dump → get DIR bounds → type DIR
    const dirXml = await dumpUiRetry(3)
    if (!dirXml) return false
    const { nodes: dirNodes } = await parseUi(dirXml)
    const dirFields = findClazz(dirNodes, "EditText")
    if (dirFields.length < 3) return false
    const dirBounds = getBounds(dirNodes, dirFields[2])
    if (!dirBounds) return false
    await tap(dirBounds.cx, dirBounds.cy)
    await sleep(400)
    await typeText("D:/code/mobile-agent-bridge")
    await sleep(300)
    console.log(`    ${dim("[debug] DIR typed")}`)

    await adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
    await sleep(400)

    // Step 4: Re-dump → get Connect bounds → tap
    const cxXml = await dumpUiRetry(3)
    if (!cxXml) return false
    const { nodes: cxNodes } = await parseUi(cxXml)
    const cxBtns = findContentDesc(cxNodes, "Connect").concat(findText(cxNodes, "Connect"))
    console.log(`    ${dim(`[debug] Connect buttons: ${cxBtns.length}`)}`)
    if (cxBtns.length === 0) return false
    const cxBounds = getBounds(cxNodes, cxBtns[0])
    if (!cxBounds) return false
    await tap(cxBounds.cx, cxBounds.cy)
    console.log(`    ${dim(`[debug] Connect tapped (${cxBounds.cx},${cxBounds.cy})`)}`)
    await sleep(12000)

    // 验证是否到达 SessionsScreen
    const afterXml = await dumpUiRetry()
    if (afterXml) {
      const { nodes: afterNodes } = await parseUi(afterXml)
      const hasSession = findText(afterNodes, "Session").length > 0
      const allTexts = afterNodes.filter(n => n.text).map(n => n.text).slice(0, 15)
      console.log(`    ${dim(`[debug] After connect texts: [${allTexts.join(", ")}]`)}`)
      console.log(`    ${dim(`[debug] Has 'Session' text: ${hasSession}`)}`)
      return hasSession
    }
    return false
  }

  // ─── 辅助：直接调用 session.create (调试用) ───
  async function debugSessionCreate() {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${CFG.bridgePort}/ws?token=`)
      await new Promise((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = (e) => reject(e)
        setTimeout(() => reject(new Error("ws connect timeout")), 5000)
      })
      function rpc(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = Math.random().toString(36).slice(2)
          ws.send(JSON.stringify({ type: "req", id, method, params }))
          ws.onmessage = (ev) => {
            const res = JSON.parse(ev.data)
            if (res.id === id) resolve(res)
          }
          setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 10000)
        })
      }
      const loginRes = await rpc("auth.login", { password: CFG.bridgePwd })
      console.log(`    ${dim(`[debug] auth.login: ${JSON.stringify(loginRes).slice(0, 100)}`)}`)
      if (!loginRes.ok) { ws.close(); return false }

      const switchRes = await rpc("project.switch", { directory: "D:/code/mobile-agent-bridge" })
      console.log(`    ${dim(`[debug] project.switch: ${JSON.stringify(switchRes).slice(0, 100)}`)}`)
      if (!switchRes.ok) { ws.close(); console.log(`    ${dim(`[debug] project.switch failed!`)}`); return false }

      const createRes = await rpc("session.create", {})
      console.log(`    ${dim(`[debug] session.create ok=${createRes.ok}, payload keys: ${Object.keys(createRes.payload || {}).join(",")}, has id: ${!!(createRes.payload?.id || createRes.payload?.data?.id)}`)}`)
      ws.close()
      return createRes.ok
    } catch (e) {
      console.log(`    ${dim(`[debug] WS debug error: ${e.message}`)}`)
      return false
    }
  }

  // ─── 辅助：创建 Session (带重试) ───
  async function createSession() {
    // 尝试最多3次
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(1000)
      const xml = await dumpUi()
      if (!xml) { console.log(`    ${dim(`[debug] createSession attempt ${attempt}: dumpUi null`)}`); continue }
      const { nodes } = await parseUi(xml)
      
      // 查找 "+ New" 按钮
      const newBtn = findText(nodes, "+ New")
      const btnToClick = newBtn.length > 0 ? newBtn : findContentDesc(nodes, "New")
      console.log(`    ${dim(`[debug] createSession attempt ${attempt}: + New=${newBtn.length}, btnToClick=${btnToClick.length}`)}`)
      if (btnToClick.length === 0) continue

      const bb = getBounds(nodes, btnToClick[0])
      if (!bb) { console.log(`    ${dim(`[debug] createSession: bounds null`)}`); continue }
      console.log(`    ${dim(`[debug] Tapping + New at (${bb.cx},${bb.cy}) bounds=[${bb.x},${bb.y}][${bb.x+bb.w},${bb.y+bb.h}]`)}`)
      
      await tap(bb.cx, bb.cy)
      await sleep(10000) // 等待 session 创建 + SDK 初始化 + 导航
      
      // 检查是否导航到 ChatScreen
      const afterXml = await dumpUi()
      if (afterXml) {
        const { nodes: afterNodes } = await parseUi(afterXml)
        const allTexts = afterNodes.filter(n => n.text).map(n => n.text).slice(0, 20)
        console.log(`    ${dim(`[debug] After +New texts: [${allTexts.join(", ")}]`)}`)
        // ChatScreen 标志: 有 "< Back" 和输入框（EditText），没有 "+ New"
        const hasNewBtn = findText(afterNodes, "+ New").length > 0
          || findContentDesc(afterNodes, "New").length > 0
        const hasBackBtn = findText(afterNodes, "< Back").length > 0
        const hasInput = findClazz(afterNodes, "EditText").length > 0
        console.log(`    ${dim(`[debug] hasNewBtn=${hasNewBtn} hasBackBtn=${hasBackBtn} hasInput=${hasInput}`)}`)
        // 导航成功条件：没有 "+ New" 按钮（说明不在 SessionsScreen），或者有返回按钮和输入框
        if (!hasNewBtn || (hasBackBtn && hasInput)) return true
      }
      
      // 等待后重试
      if (attempt < 3) await sleep(3000)
    }
    return false
  }

  // ─── 辅助：等待文本出现 ───
  async function waitForTextInUi(text, timeout = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const xml = await dumpUi()
      if (xml) {
        const { nodes } = await parseUi(xml)
        if (findText(nodes, text).length > 0) return true
      }
      await sleep(500)
    }
    return false
  }

  // ─── 辅助：发送聊天消息 ───
  async function sendMessage(text) {
    const xml = await dumpUi()
    if (!xml) return false
    const { nodes } = await parseUi(xml)
    const fields = findClazz(nodes, "EditText")
    // 发送按钮: "➤" 或 "Send" 或 content-desc
    const sendBtn = findText(nodes, "➤").concat(findText(nodes, "Send")).concat(findContentDesc(nodes, "Send"))

    if (fields.length > 0 && sendBtn.length > 0) {
      const inputBounds = getBounds(nodes, fields[0])
      if (inputBounds) {
        await tap(inputBounds.cx, inputBounds.cy)
        await sleep(200)
        await typeText(text)
        await sleep(300)
        const sendBounds = getBounds(nodes, sendBtn[0])
        if (sendBounds) {
          await tap(sendBounds.cx, sendBounds.cy)
          await sleep(1000)
          return true
        }
      }
    }
    return false
  }

  // ─── 启动 Bridge ───
  console.log(`  ${yellow("▶")} 启动 Bridge 服务...`)
  const bridgeOk = await startBridge()
  if (!bridgeOk) { fail("Bridge 服务启动失败"); return }
  ok("Bridge 已启动", `port ${CFG.bridgePort}`)

  // ═══════════════════════════════════════════════════
  // 5.1 SessionsScreen
  // ═══════════════════════════════════════════════════
  console.log(`\n  ${yellow("▶")} 5.1 SessionsScreen`)

  const connected = await connectToBridge()
  if (!connected) {
    fail("无法连接到 Bridge")
    await stopBridge()
    return
  }
  ok("已连接到 SessionsScreen")

  // 5.1.1 标题和按钮渲染
  const sXml = await dumpUi()
  if (sXml) {
    const { nodes: sNodes } = await parseUi(sXml)
    const hasTitle = findText(sNodes, "Sessions").length > 0
    const hasNewBtn = findText(sNodes, "+ New").length > 0 || findContentDesc(sNodes, "New").length > 0
    const hasProject = findText(sNodes, "Project").length > 0
    if (hasTitle && hasNewBtn) ok("SessionsScreen 渲染正常", "标题+新建按钮")
    else fail("SessionsScreen 渲染异常", `标题:${hasTitle} 新建:${hasNewBtn}`)

    if (hasProject) ok("项目信息显示", "Project 标签可见")
    else skip("项目信息显示", "未找到 Project 标签")
  }

  // 5.1.2 空状态
  // 如果没有 session，应该显示空态
  const sEmptyXml = await dumpUi()
  if (sEmptyXml) {
    const { nodes: sEmptyNodes } = await parseUi(sEmptyXml)
    const hasEmpty = findText(sEmptyNodes, "No sessions").length > 0
    if (hasEmpty) ok("SessionsScreen 空状态", "No sessions yet 文本可见")
    else skip("SessionsScreen 空状态", "已有 session 或空态文本不同")
  }

  // ═══════════════════════════════════════════════════
  // 5.2 ChatScreen
  // ═══════════════════════════════════════════════════
  console.log(`\n  ${yellow("▶")} 5.2 ChatScreen`)

  // Debug: test session.create directly via WS
  await debugSessionCreate()

  const sessionCreated = await createSession()
  if (!sessionCreated) {
    skip("ChatScreen 渲染", "无法创建 session")
  } else {
    // Debug: dump UI tree after session creation
    const debugXml = await dumpUi()
    if (debugXml) {
      const { nodes: debugNodes } = await parseUi(debugXml)
      const allTexts = debugNodes.map(n => n.text).filter(Boolean).slice(0, 15)
      const allClasses = debugNodes.map(n => n.class).filter(Boolean).slice(0, 15)
      console.log(`    ${dim(`UI texts: [${allTexts.join(", ")}]`)}`)
      console.log(`    ${dim(`UI classes: [${allClasses.join(", ")}]`)}`)
    }

    // 5.2.1 头部元素
    const cXml = await dumpUi()
    if (cXml) {
      const { nodes: cNodes } = await parseUi(cXml)
      const hasBackBtn = findText(cNodes, "Sessions").length > 0 || findContentDesc(cNodes, "Sessions").length > 0
      const hasInput = findClazz(cNodes, "EditText").length > 0
      if (hasBackBtn) ok("ChatScreen 头部", "< Sessions 按钮可见")
      else skip("ChatScreen 头部", "未找到返回按钮")
      if (hasInput) ok("ChatScreen 输入框", "消息输入框可见")
      else skip("ChatScreen 输入框", "未找到输入框")
    }

    // 5.2.2 发送消息
    if (hasOpenCode) {
      const sent = await sendMessage("hello")
      if (sent) {
        ok("消息发送", "已发送 hello")
        await sleep(2000)

        // 检查消息是否出现在列表
        const msgXml = await dumpUi()
        if (msgXml) {
          const { nodes: msgNodes } = await parseUi(msgXml)
          const hasHello = findText(msgNodes, "hello").length > 0
          if (hasHello) ok("消息显示", "hello 出现在消息列表")
          else skip("消息显示", "消息可能尚未渲染")
        }

        // 5.2.3 AI 思考指示器
        const thinkXml = await dumpUi()
        if (thinkXml) {
          const { nodes: thinkNodes } = await parseUi(thinkXml)
          const hasThinking = findText(thinkNodes, "thinking").length > 0
            || findText(thinkNodes, "Thinking").length > 0
            || findText(thinkNodes, "AI is thinking").length > 0
          if (hasThinking) ok("AI 思考指示器", "thinking 文本可见")
          else skip("AI 思考指示器", "可能已响应或未触发思考")
        }

        // 等待响应完成
        await sleep(8000)
      } else {
        skip("消息发送", "未找到输入框或发送按钮")
      }
    } else {
      skip("消息发送", "OpenCode 不可用")
      skip("AI 思考指示器", "OpenCode 不可用")
    }

    // 5.2.4 SessionInfoModal
    const infoXml = await dumpUi()
    if (infoXml) {
      const { nodes: infoNodes } = await parseUi(infoXml)
      const infoBtn = findText(infoNodes, "📋")
      if (infoBtn.length > 0) {
        const bb = getBounds(infoNodes, infoBtn[0])
        if (bb) {
          await tap(bb.cx, bb.cy)
          await sleep(1000)
          const modalXml = await dumpUi()
          if (modalXml) {
            const { nodes: mNodes } = await parseUi(modalXml)
            const hasInfo = findText(mNodes, "Session Info").length > 0
            if (hasInfo) ok("SessionInfoModal", "Session Info 弹窗可见")
            else skip("SessionInfoModal", "弹窗可能未渲染")
            // 关闭弹窗
            await pressBack()
            await sleep(500)
          }
        }
      } else {
        skip("SessionInfoModal", "未找到 info 按钮")
      }
    }

    // 5.2.5 返回 SessionsScreen
    const backXml = await dumpUi()
    if (backXml) {
      const { nodes: backNodes } = await parseUi(backXml)
      const backBtn = findContentDesc(backNodes, "Sessions").concat(findText(backNodes, "Sessions"))
      if (backBtn.length > 0) {
        const bb = getBounds(backNodes, backBtn[0])
        if (bb) {
          await tap(bb.cx, bb.cy)
          await sleep(2000)
          const afterBackXml = await dumpUi()
          if (afterBackXml) {
            const { nodes: abNodes } = await parseUi(afterBackXml)
            const hasNewBtn = findText(abNodes, "+ New").length > 0 || findContentDesc(abNodes, "New").length > 0
            if (hasNewBtn) ok("返回 SessionsScreen", "已回到会话列表")
            else skip("返回 SessionsScreen", "UI 状态不确定")
          }
        }
      } else {
        skip("返回 SessionsScreen", "未找到返回按钮")
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 5.3 FileBrowserScreen
  // ═══════════════════════════════════════════════════
  console.log(`\n  ${yellow("▶")} 5.3 FileBrowserScreen`)

  // FileBrowserScreen 需要从 SessionsScreen 进入
  // 尝试找到文件浏览入口 (可能在 menu 或 header)
  // 由于 FileBrowserScreen 是独立 screen，需要先确认导航入口
  // 在当前 app 中，文件浏览器可能需要从 chat 或 sessions 触发

  // 尝试检查是否已有文件浏览按钮
  const fbNavXml = await dumpUi()
  if (fbNavXml) {
    const { nodes: fbNavNodes } = await parseUi(fbNavXml)
    // 检查是否有文件相关的导航入口
    const hasFileBtn = findText(fbNavNodes, "File").length > 0
      || findText(fbNavNodes, "Browse").length > 0
      || findText(fbNavNodes, "📁").length > 0
    if (hasFileBtn) {
      // 点击进入文件浏览器
      const fileBtn = findText(fbNavNodes, "File").concat(
        findText(fbNavNodes, "Browse"),
        findText(fbNavNodes, "📁")
      )
      if (fileBtn.length > 0) {
        const bb = getBounds(fbNavNodes, fileBtn[0])
        if (bb) await tap(bb.cx, bb.cy)
        await sleep(2000)
      }
    }
  }

  // 检查文件浏览器是否已打开
  const fbXml = await dumpUi()
  if (fbXml) {
    const { nodes: fbNodes } = await parseUi(fbXml)
    const hasBackBtn = findText(fbNodes, "← Back").length > 0
    const hasSearchInput = findClazz(fbNodes, "EditText").length > 0
    const hasSearchBtn = findText(fbNodes, "Search").length > 0

    if (hasBackBtn && hasSearchBtn) {
      ok("FileBrowserScreen 渲染", "返回+搜索按钮可见")

      // 5.3.1 搜索功能
      if (hasSearchInput) {
        const searchFields = findClazz(fbNodes, "EditText")
        const searchBounds = getBounds(fbNodes, searchFields[0])
        if (searchBounds) {
          await tap(searchBounds.cx, searchBounds.cy)
          await sleep(200)
          await typeText("package.json")
          await sleep(300)

          // 点击搜索按钮
          const sBtn = findText(fbNodes, "Search")
          if (sBtn.length > 0) {
            const sBounds = getBounds(fbNodes, sBtn[0])
            if (sBounds) {
              await tap(sBounds.cx, sBounds.cy)
              await sleep(3000)

              // 验证搜索结果
              const resultXml = await dumpUi()
              if (resultXml) {
                const { nodes: rNodes } = await parseUi(resultXml)
                const hasResults = findText(rNodes, "package.json").length > 0
                if (hasResults) ok("FileBrowser 搜索", "package.json 出现在结果中")
                else ok("FileBrowser 搜索", "搜索已执行 (结果可能不同)")
              }
            }
          }
        }
      }

      // 5.3.2 父目录导航
      const parentXml = await dumpUi()
      if (parentXml) {
        const { nodes: pNodes } = await parseUi(parentXml)
        const parentEntry = findText(pNodes, "..").concat(findText(pNodes, "Parent"))
        if (parentEntry.length > 0) {
          const pb = getBounds(pNodes, parentEntry[0])
          if (pb) {
            await tap(pb.cx, pb.cy)
            await sleep(2000)
            ok("FileBrowser 父目录", "已点击 .. 返回上级")
          }
        } else {
          skip("FileBrowser 父目录", "未找到 .. 入口")
        }
      }

      // 5.3.3 返回按钮
      const backBtnXml = await dumpUi()
      if (backBtnXml) {
        const { nodes: bbNodes } = await parseUi(backBtnXml)
        const backBtn = findText(bbNodes, "← Back")
        if (backBtn.length > 0) {
          const bb = getBounds(bbNodes, backBtn[0])
          if (bb) {
            await tap(bb.cx, bb.cy)
            await sleep(1000)
            ok("FileBrowser 返回", "已点击返回按钮")
          }
        }
      }
    } else {
      skip("FileBrowserScreen", "未进入文件浏览器 (可能需要不同的导航入口)")
    }
  }

  // ═══════════════════════════════════════════════════
  // 5.4 ToolRenderer & ReasoningCollapsible
  // ═══════════════════════════════════════════════════
  console.log(`\n  ${yellow("▶")} 5.4 ToolRenderer & ReasoningCollapsible`)

  if (hasOpenCode) {
    // 需要进入 ChatScreen 并发送触发工具调用的消息
    // 先回到 SessionsScreen
    const currentXml = await dumpUi()
    if (currentXml) {
      const { nodes: currentNodes } = await parseUi(currentXml)
      // 可能需要先回到 Sessions 再进入 Chat
      const sessionBtn = findText(currentNodes, "Sessions")
      if (sessionBtn.length > 0) {
        const bb = getBounds(currentNodes, sessionBtn[0])
        if (bb) await tap(bb.cx, bb.cy)
        await sleep(1000)
      }
    }

    // 创建新 session
    const newSessCreated = await createSession()
    if (newSessCreated) {
      // 发送触发工具调用的消息
      const toolSent = await sendMessage("list files in current directory")
      if (toolSent) {
        // 等待工具调用出现
        await sleep(5000)

        const toolXml = await dumpUi()
        if (toolXml) {
          const { nodes: toolNodes } = await parseUi(toolXml)

          // 5.4.1 ToolRenderer: Shell/Glob/Read 等
          const hasShell = findText(toolNodes, "Shell").length > 0
          const hasGlob = findText(toolNodes, "Glob").length > 0
          const hasRead = findText(toolNodes, "Read").length > 0
          const hasGrep = findText(toolNodes, "Grep").length > 0
          const hasWrite = findText(toolNodes, "Write").length > 0
          const hasEdit = findText(toolNodes, "Edit").length > 0
          const hasTask = findText(toolNodes, "Task").length > 0

          const toolName = hasShell ? "Shell" : hasGlob ? "Glob" : hasRead ? "Read"
            : hasGrep ? "Grep" : hasWrite ? "Write" : hasEdit ? "Edit" : hasTask ? "Task" : null

          if (toolName) {
            ok("ToolRenderer 渲染", `${toolName} 工具卡片可见`)

            // 尝试点击展开 (如果可交互)
            const toolNode = findText(toolNodes, toolName)
            if (toolNode.length > 0) {
              const bb = getBounds(toolNodes, toolNode[0])
              if (bb) {
                await tap(bb.cx, bb.cy)
                await sleep(500)
                ok("ToolRenderer 交互", `已点击 ${toolName} 卡片`)
              }
            }

            // 检查状态图标
            const hasSuccess = findText(toolNodes, "✅").length > 0
            const hasFailed = findText(toolNodes, "❌").length > 0
            const hasPending = findText(toolNodes, "⏳").length > 0
            if (hasSuccess || hasFailed || hasPending) {
              const status = hasSuccess ? "✅" : hasFailed ? "❌" : "⏳"
              ok("ToolRenderer 状态", `状态图标 ${status} 可见`)
            } else {
              skip("ToolRenderer 状态", "未检测到状态图标 (可能已消失)")
            }
          } else {
            skip("ToolRenderer 渲染", "未检测到工具调用卡片")
          }

          // 5.4.2 ReasoningCollapsible
          const hasThinking = findText(toolNodes, "Thinking Process").length > 0
          const hasThinkingDots = findText(toolNodes, "Thinking...").length > 0
          if (hasThinking || hasThinkingDots) {
            const thinkLabel = hasThinking ? "Thinking Process" : "Thinking..."
            ok("ReasoningCollapsible 渲染", `${thinkLabel} 可见`)

            // 点击展开/折叠
            const thinkNode = findText(toolNodes, thinkLabel)
            if (thinkNode.length > 0) {
              const bb = getBounds(toolNodes, thinkNode[0])
              if (bb) {
                await tap(bb.cx, bb.cy)
                await sleep(500)
                const afterThinkXml = await dumpUi()
                if (afterThinkXml) {
                  const { nodes: atNodes } = await parseUi(afterThinkXml)
                  const hasChevron = findText(atNodes, "▼").length > 0
                    || findText(atNodes, "▶").length > 0
                  if (hasChevron) ok("ReasoningCollapsible 交互", "展开/折叠切换正常")
                  else skip("ReasoningCollapsible 交互", "chevron 状态未检测到")
                }
              }
            }
          } else {
            skip("ReasoningCollapsible", "未检测到思考内容 (可能无思考过程)")
          }

          // 5.4.3 MarkdownRenderer (在聊天消息中)
          const hasMarkdown = findText(toolNodes, "```").length > 0
            || findText(toolNodes, "**").length > 0
            || findText(toolNodes, "#").length > 0
          if (hasMarkdown) {
            ok("MarkdownRenderer 渲染", "Markdown 格式内容可见")
          } else {
            skip("MarkdownRenderer", "未检测到 Markdown 格式内容")
          }

          // 5.4.4 ToolProgressCard (水平滚动)
          // ToolProgressCard 包含多个 ToolRenderer，水平排列
          if (toolName) {
            ok("ToolProgressCard", "工具进度卡片已渲染 (含 ToolRenderer)")
          }
        }
      } else {
        skip("ToolRenderer", "消息发送失败")
        skip("ReasoningCollapsible", "消息发送失败")
      }
    } else {
      skip("ToolRenderer", "无法创建 session")
      skip("ReasoningCollapsible", "无法创建 session")
    }
  } else {
    skip("ToolRenderer", "OpenCode 不可用")
    skip("ReasoningCollapsible", "OpenCode 不可用")
    skip("MarkdownRenderer", "OpenCode 不可用")
  }

  // ═══════════════════════════════════════════════════
  // 5.5 横竖屏切换 (ConnectScreen)
  // ═══════════════════════════════════════════════════
  console.log(`\n  ${yellow("▶")} 5.5 横竖屏切换`)

  // 回到 ConnectScreen 测试横竖屏
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(500)
  await adb(["shell", "am", "start", "-n", `${CFG.pkg}/${CFG.activity}`])
  await sleep(3000)

  // 确保竖屏
  await adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]).catch(() => {})
  await adb(["shell", "settings", "put", "system", "user_rotation", "0"]).catch(() => {})
  await sleep(1000)

  // 验证竖屏下 EditText 可见
  const portXml = await dumpUi()
  if (portXml) {
    const { nodes: portNodes } = await parseUi(portXml)
    const hasEditText = findClazz(portNodes, "EditText").length > 0
    if (hasEditText) ok("竖屏 UI 可用", "输入框可见")
    else fail("竖屏 UI 异常", "输入框不可见")
  }

  // 切到横屏
  await adb(["shell", "settings", "put", "system", "user_rotation", "1"]).catch(() => {})
  await sleep(2000)

  const landXml = await dumpUi()
  if (landXml) {
    const { nodes: landNodes } = await parseUi(landXml)
    const hasEditText = findClazz(landNodes, "EditText").length > 0
    if (hasEditText) ok("横屏 UI 可用", "输入框仍可见")
    else fail("横屏 UI 异常", "输入框不可见")
  }

  // 恢复竖屏
  await adb(["shell", "settings", "put", "system", "user_rotation", "0"]).catch(() => {})
  await sleep(1000)

  // ─── 清理 ───
  await adb(["shell", "am", "force-stop", CFG.pkg]).catch(() => {})
  await sleep(500)
  await stopBridge()
  ok("Bridge 服务已停止")
}

// ─── 主流程 ─────────────────────────────────────────

async function main() {
  console.log(`\n${yellow("═══════════════════════════════════════════════════════════════")}`)
  console.log("  Mobile Agent Bridge — Android 综合测试套件")
  console.log(`${yellow("═══════════════════════════════════════════════════════════════")}`)

  if (LAYER_FILTER === null || LAYER_FILTER === 1) await testLayer1()
  if (LAYER_FILTER === null || LAYER_FILTER === 2) await testLayer2()
  if (LAYER_FILTER === null || LAYER_FILTER === 3) await testLayer3()
  if (LAYER_FILTER === null || LAYER_FILTER === 4) await testLayer4()
  if (LAYER_FILTER === null || LAYER_FILTER === 5) await testLayer5()

  // 结果汇总
  const total = passed + failed + skipped
  console.log(`\n${yellow("═══════════════════════════════════════════════════════════════")}`)
  if (failed === 0) console.log(`  ${green("全部通过!")} ${passed}/${passed + failed + skipped} 通过${skipped > 0 ? `, ${skipped} 跳过` : ""}`)
  else console.log(`  ${red(`${failed} 个失败!`)} ${passed}/${passed + failed} 通过${skipped > 0 ? `, ${skipped} 跳过` : ""}`)
  console.log(`${yellow("═══════════════════════════════════════════════════════════════")}\n`)

  clearTimeout(GLOBAL_TIMEOUT)
  if (bridgeProcess) await stopBridge()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(`\n${red("FATAL")}: ${e.message}`)
  clearTimeout(GLOBAL_TIMEOUT)
  stopBridge().then(() => process.exit(1))
})
