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

const OPENCODE_PATH = process.env.OPENCODE_PATH || "opencode.cmd"
const OPENCODE_PORT = process.env.OPENCODE_PORT || "4096"
const BRIDGE_PORT = process.env.BRIDGE_PORT || "19985"
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || "test123"

function log(msg) {
  console.log(`[L4] ${msg}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForPort(port, label, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const { createConnection } = await import("net")
      return new Promise((resolve, reject) => {
        const conn = createConnection({ port, host: "127.0.0.1", timeout: 2000 }, () => {
          conn.end()
          resolve()
        })
        conn.on("error", () => {
          conn.destroy()
          reject()
        })
      })
    } catch {
      await sleep(1000)
    }
  }
  throw new Error(`${label} 端口 ${port} 未在 ${timeout}ms 内就绪`)
}

async function main() {
  log("=== Layer 4 E2E 启动 ===")
  log(`OpenCode: ${OPENCODE_PATH} :${OPENCODE_PORT}`)
  log(`Bridge: :${BRIDGE_PORT}`)
  log("")

  // 1. 启动 OpenCode serve
  log("1. 启动 OpenCode serve...")
  const opencode = spawn(OPENCODE_PATH, ["serve", "--port", OPENCODE_PORT, "--print-logs"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env },
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
  const bridge = spawn(
    require.resolve("tsx/dist/cli.mjs"),
    [resolve(ROOT, "servers/bridge/src/index.ts")],
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

  // 5. 运行 Maestro flows
  log("4. 运行 Maestro L4 flows...")
  const flowsDir = resolve(ROOT, ".maestro/flows/l4-e2e")
  const flows = fs.readdirSync(flowsDir).filter((f) => f.endsWith(".yaml"))
  log(`   找到 ${flows.length} 个 flow`)

  let passed = 0
  let failed = 0

  for (const flow of flows) {
    log(`   运行: ${flow}`)
    const start = Date.now()
    try {
      execSync(`.maestro/maestro.cmd test .maestro/flows/l4-e2e/${flow}`, {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 300000, // 5min per flow
      })
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      log(`   ✅ ${flow} (${elapsed}s)`)
      passed++
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      log(`   ❌ ${flow} (${elapsed}s)`)
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
