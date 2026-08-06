#!/usr/bin/env node
/**
 * Layer 4 全链路 E2E 运行器
 *
 * 流程:
 *   1. 启动 OpenCode serve（需在 PATH 中或通过 OPENCODE_PATH 指定）
 *   2. 启动 Bridge 服务器（通过 servers/bridge）
 *   3. 等待两者就绪
 *   4. 安装 APK
 *   5. 运行 Maestro L4 flows
 *   6. 清理
 *
 * 用法:
 *   node scripts/e2e/run-layer4.mjs
 *
 * 环境变量:
 *   OPENCODE_PATH — opencode 可执行文件路径（默认 opencode）
 *   OPENCODE_PORT — OpenCode 端口（默认 4096）
 *   BRIDGE_PORT   — Bridge 端口（默认 19985）
 *   BRIDGE_PASSWORD — Bridge 密码（默认 test123）
 *   APK_PATH      — APK 文件路径（默认自动查找 release APK）
 */
import { spawn, execSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import fs from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)

const OPENCODE_PATH = process.env.OPENCODE_PATH ||
  resolve(process.env.APPDATA || "C:\\Users\\MT\\AppData\\Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
const OPENCODE_PORT = process.env.OPENCODE_PORT || "4096"
const BRIDGE_PORT = process.env.BRIDGE_PORT || "19985"
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || "test123"
const BRIDGE_DEFAULT_MODEL = process.env.BRIDGE_DEFAULT_MODEL || "opencode-go/deepseek-v4-flash"

// opencode-go provider 在 models.dev 定义 env=OPENCODE_API_KEY。
// serve 模式不读 auth.json 的 opencode-go 条目，必须显式注入该 env（env → 注册表 → auth.json 三级解析）。
function resolveOpenCodeAPIKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY
  try {
    const reg = execSync('reg query "HKCU\\Environment" /v OPENCODE_API_KEY', {
      stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8",
    }).toString()
    const m = reg.match(/OPENCODE_API_KEY\s+REG_\w+\s+(\S+)/)
    if (m && m[1]) return m[1]
  } catch (_) {}
  try {
    const authPath = resolve(process.env.USERPROFILE || "C:\\Users\\MT", ".local", "share", "opencode", "auth.json")
    const auth = JSON.parse(fs.readFileSync(authPath, "utf-8"))
    for (const p of ["opencode-go", "opencode"]) {
      if (auth[p] && auth[p].key) return auth[p].key
    }
  } catch (_) {}
  return undefined
}
const OPENCODE_API_KEY = resolveOpenCodeAPIKey()
if (!OPENCODE_API_KEY) {
  console.error("[FATAL] 无法解析 OPENCODE_API_KEY（未设置环境变量且注册表/auth.json 均无 key）")
  process.exit(2)
}

function log(msg) {
  console.log(`[L4] ${msg}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForPort(port, label, timeout = 30000) {
  const start = Date.now()
  const { createConnection } = await import("net")
  while (Date.now() - start < timeout) {
    const ok = await new Promise((resolve) => {
      const conn = createConnection({ port, host: "127.0.0.1", timeout: 2000 })
      conn.on("connect", () => { conn.destroy(); resolve(true) })
      conn.on("error", () => { conn.destroy(); resolve(false) })
    })
    if (ok) return
    await sleep(1000)
  }
  throw new Error(`${label} 端口 ${port} 未在 ${timeout}ms 内就绪`)
}

async function main() {
  // 确保 adb 可用（run-layer4 用 execSync("adb ...")，需要 adb 在 PATH）
  const adbHome = process.env.ANDROID_HOME ||
    resolve(process.env.LOCALAPPDATA || "C:\\Users\\MT\\AppData\\Local", "Android", "Sdk")
  const adbDir = resolve(adbHome, "platform-tools")
  if (!process.env.PATH.split(";").some(p => p.trim().toLowerCase() === adbDir.toLowerCase())) {
    process.env.PATH = `${adbDir};${process.env.PATH}`
  }
  log("adb: " + (execSync("adb --version", { stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" }).split("\n")[0] || "?").trim())

  log("=== Layer 4 E2E 启动 ===")
  log(`OpenCode: ${OPENCODE_PATH} :${OPENCODE_PORT}`)
  log(`Bridge: :${BRIDGE_PORT}`)
  log("")

  // 1. 启动 OpenCode serve（直接 spawn exe，不经 .cmd + shell:true，否则 env 丢失 → 模型 key 失效）
  log("1. 启动 OpenCode serve...")
  const opencode = spawn(OPENCODE_PATH, ["serve", "--port", OPENCODE_PORT, "--print-logs"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: "", OPENCODE_API_KEY },
  })
  opencode.stdout.on("data", (d) => process.stdout.write(`[opencode] ${d}`))
  opencode.stderr.on("data", (d) => process.stderr.write(`[opencode] ${d}`))

  try {
    await waitForPort(parseInt(OPENCODE_PORT), "OpenCode")
    log("   OpenCode 已就绪")
  } catch (e) {
    log(`   ❌ ${e.message}`)
    opencode.kill()
    process.exit(1)
  }

  // 2. 启动 Bridge
  log("2. 启动 Bridge 服务器...")
  const tsxCli = resolve(ROOT, "servers/bridge/node_modules/tsx/dist/cli.mjs")
  const bridge = spawn(
    process.execPath,
    [tsxCli, resolve(ROOT, "servers/bridge/src/index.ts")],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BRIDGE_PORT,
        BRIDGE_PASSWORD,
        OPENCODE_URL: `http://localhost:${OPENCODE_PORT}`,
      },
    },
  )
  bridge.stdout.on("data", (d) => process.stdout.write(`[bridge] ${d}`))
  bridge.stderr.on("data", (d) => process.stderr.write(`[bridge] ${d}`))

  try {
    await waitForPort(parseInt(BRIDGE_PORT), "Bridge")
    log("   Bridge 已就绪")
  } catch (e) {
    log(`   ❌ ${e.message}`)
    opencode.kill()
    bridge.kill()
    process.exit(1)
  }

  // 3. 安装 APK
  log("3. 安装 APK...")
  const apkPaths = [
    process.env.APK_PATH,
    resolve(ROOT, "apps/mobile/android/app/build/outputs/apk/release/app-release.apk"),
  ]
  const apkPath = apkPaths.find((p) => p && fs.existsSync(p))
  if (!apkPath) {
    log("   ❌ APK 未找到，请先构建")
    opencode.kill()
    bridge.kill()
    process.exit(1)
  }
  try {
    execSync(`adb install -r "${apkPath}"`, { stdio: "pipe" })
    log("   APK 安装完成")
  } catch (e) {
    log(`   ❌ APK 安装失败: ${e.message}`)
    opencode.kill()
    bridge.kill()
    process.exit(1)
  }

  // 4. 清理 App 数据
  try {
    execSync("adb shell pm clear com.mobileagentbridge", { stdio: "pipe" })
  } catch {}

  // 5. 运行 Maestro flows（--layer l4/l5/all，默认 l4；支持 --layer=all 与 --layer all）
  let layerArg = "l4"
  const layerIdx = process.argv.indexOf("--layer")
  if (process.argv.includes("--all")) layerArg = "all"
  else if (layerIdx >= 0 && process.argv[layerIdx + 1]) layerArg = process.argv[layerIdx + 1]
  else {
    const eq = process.argv.find(a => a.startsWith("--layer="))
    if (eq) layerArg = eq.split("=")[1]
  }
  const targets = []
  if (layerArg === "all" || layerArg === "l4") {
    const flowsDir = resolve(ROOT, ".maestro/flows/l4-e2e")
    targets.push(...fs.readdirSync(flowsDir).filter((f) => f.endsWith(".yaml")).map((f) => resolve(flowsDir, f)))
  }
  if (layerArg === "all" || layerArg === "l5") {
    targets.push(resolve(ROOT, ".maestro/flows/l5-complete-e2e.yaml"))
  }
  log(`4. 运行 Maestro flows (layer=${layerArg})...`)
  log(`   找到 ${targets.length} 个 flow`)

  let passed = 0
  let failed = 0

  for (let i = 0; i < targets.length; i++) {
    const flow = targets[i]
    // flow 之间延时，避免 Maestro driver 并发/重启竞争导致启动超时
    if (i > 0) {
      log(`   [delay] 等待 driver 释放 5s...`)
      await sleep(5000)
    }
    log(`   运行: ${flow}`)
    const start = Date.now()
    try {
      execSync(`"${resolve(ROOT, ".maestro/maestro.cmd")}" test "${flow}"`, {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 300000, // 5min per flow
      })
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      log(`   ✅ ${flow} (${elapsed}s)`)
      passed++
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      const stderr = e.stderr ? e.stderr.toString().slice(0, 500) : ""
      log(`   ❌ ${flow} (${elapsed}s)`)
      if (stderr) log(`      stderr: ${stderr}`)
      failed++
    }
  }

  // 6. 清理
  log("5. 清理...")
  opencode.kill()
  bridge.kill()

  log("")
  log(`=== 结果: ${passed} 通过, ${failed} 失败 ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
