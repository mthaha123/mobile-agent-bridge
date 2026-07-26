#!/usr/bin/env node
/**
 * Maestro E2E Layer Runner — 统一入口
 *
 * 用法:
 *   node scripts/e2e/run-layer.mjs --layer l1
 *   node scripts/e2e/run-layer.mjs --layer l2 --mock   ← 自动启动 Mock Bridge
 *   node scripts/e2e/run-layer.mjs --layer l1 --layer l2 --mock
 *   node scripts/e2e/run-layer.mjs --all               ← 全部 (mock)
 *
 * 环境变量:
 *   MOCK_BRIDGE_PORT  Mock Bridge 端口 (默认 8081)
 *   EMULATOR_SERIAL   adb serial (默认自动)
 *   MAESTRO_TIMEOUT   每个 flow 超时秒数 (默认 120)
 */

import { spawn, execSync } from "node:child_process"
import { resolve, dirname, basename, relative, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readdirSync, existsSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, "..", "..")
const maestroCmd = resolve(rootDir, ".maestro", "maestro.cmd")
const flowsDir = resolve(rootDir, ".maestro", "flows")

const USE_MOCK = process.argv.includes("--mock")
const RUN_ALL = process.argv.includes("--all")
const layers = RUN_ALL
  ? ["l1", "l2", "l3"]
  : process.argv
      .filter(a => a.startsWith("--layer="))
      .map(a => a.split("=")[1])

const MOCK_PORT = process.env.MOCK_BRIDGE_PORT || "8081"
const FLOW_TIMEOUT = parseInt(process.env.MAESTRO_TIMEOUT || "120", 10) * 1000

let mockProcess = null
let passed = 0
let failed = 0

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }

function adb(args) {
  const androidHome = process.env.ANDROID_HOME ||
    resolve(process.env.LOCALAPPDATA || "C:\\Users\\MT\\AppData\\Local", "Android", "Sdk")
  const adbPath = resolve(androidHome, "platform-tools", "adb.exe")
  try {
    execSync(`"${adbPath}" ${args}`, { stdio: "pipe", timeout: 15000 })
  } catch { /* ignore */ }
}

function findFlows(layer) {
  const prefix = `${layer}-`
  function walk(dir) {
    const files = []
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) files.push(...walk(full))
      else if (e.name.endsWith(".yaml")) files.push(full)
    }
    return files
  }
  const all = walk(flowsDir)
  const matched = all
    .filter(f => basename(dirname(f)).startsWith(prefix) || basename(f).startsWith(prefix))
    .map(f => relative(flowsDir, f))

  if (matched.length === 0) {
    console.warn(yellow(`[WARN] Layer ${layer}: no flows found matching "${prefix}-*"`))
  }
  return matched.sort()
}

function waitForPort(port, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(`netstat -ano | findstr :${port}`, { stdio: "pipe", timeout: 3000 })
      return true
    } catch {
      // port not ready yet
    }
  }
  return false
}

async function startMockBridge() {
  console.log(yellow(`[MockBridge] 启动中... (端口 ${MOCK_PORT})`))

  const child = spawn("node", [
    resolve(rootDir, "scripts/e2e/mock-bridge.mjs"),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MOCK_BRIDGE_PORT: MOCK_PORT },
  })

  child.stdout.on("data", d => {
    const msg = d.toString().trim()
    if (msg) console.log(`  ${msg}`)
  })
  child.stderr.on("data", d => {
    const msg = d.toString().trim()
    if (msg) console.error(`  ${red("[ERR]")} ${msg}`)
  })

  child.on("error", (err) => {
    console.error(red(`[MockBridge] 启动失败: ${err.message}`))
  })

  if (!waitForPort(parseInt(MOCK_PORT), 10000)) {
    console.error(red(`[MockBridge] 端口 ${MOCK_PORT} 未就绪，超时`))
    child.kill()
    return null
  }

  console.log(green(`[MockBridge] 就绪`))
  return child
}

async function runFlow(flowPath) {
  return new Promise((resolve) => {
    const flowName = flowPath.split(/[/\\]/).pop().replace(/\.yaml$/, "")
    console.log(`\n${yellow("─".repeat(50))}`)
    console.log(`  RUN: ${flowName}`)
    console.log(`${yellow("─".repeat(50))}`)

    const child = spawn(maestroCmd, ["test", flowPath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: rootDir,
      timeout: FLOW_TIMEOUT,
      shell: true,
    })

    let output = ""
    child.stdout.on("data", d => { output += d.toString() })
    child.stderr.on("data", d => { output += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      console.log(red(`  ╰ TIMEOUT (${FLOW_TIMEOUT / 1000}s)`))
      failed++
      resolve(false)
    }, FLOW_TIMEOUT + 5000)

    child.on("close", (code) => {
      clearTimeout(timer)
      const lines = output.split("\n").filter(l => l.trim())
      const resultLines = lines.filter(l =>
        l.includes("COMPLETED") || l.includes("FAILED") || l.includes("PASSED") || l.includes("ERROR")
      )
      resultLines.forEach(l => console.log(`  ${l}`))

      const hasFailed = output.includes("FAILED") || code !== 0
      if (hasFailed) {
        console.log(red(`  ╰ FAILED`))
        failed++
      } else {
        console.log(green(`  ╰ PASSED`))
        passed++
      }
      resolve(!hasFailed)
    })
  })
}

async function main() {
  // 1. Kill old bridge processes
  console.log(yellow("[Setup] 清理旧进程..."))
  const oldPorts = ["8080", "8081", "8082"]
  for (const port of oldPorts) {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { stdio: "pipe", timeout: 3000 }).toString()
      const lines = out.trim().split("\n").filter(l => l.includes("LISTENING"))
      for (const line of lines) {
        const pid = line.trim().split(/\s+/).pop()
        if (pid && pid !== "0") {
          execSync(`taskkill /f /pid ${pid} 2>nul`, { stdio: "pipe" })
        }
      }
    } catch { /* no process on this port */ }
  }

  // 2. Clean maestro session
  const sessionDb = resolve(process.env.USERPROFILE || "C:\\Users\\MT", ".maestro", "session.db")
  try {
    execSync(`del /f /q "${sessionDb}" 2>nul`, { stdio: "pipe" })
    execSync(`rmdir /s /q "${resolve(process.env.USERPROFILE || "C:\\Users\\MT", ".maestro", "tests")}" 2>nul`, { stdio: "pipe" })
  } catch { /* OK */ }

  // 3. Clean app state
  console.log(yellow("[Setup] 清理 app 状态..."))
  adb("shell am force-stop com.mobileagentbridge")
  adb("shell pm clear com.mobileagentbridge")

  // 4. Start mock bridge if needed
  if (USE_MOCK) {
    mockProcess = await startMockBridge()
    if (!mockProcess) {
      console.error(red("[FATAL] Mock Bridge 启动失败，退出"))
      process.exit(1)
    }
  }

  // 5. Run flows
  for (const layer of layers) {
    const flows = findFlows(layer)
    if (flows.length === 0) {
      console.log(yellow(`\n[Layer ${layer}] 无测试 flow，跳过`))
      continue
    }
    console.log(`\n${green(`[Layer ${layer}] ${flows.length} 个 flow`)}`)
    for (const flow of flows) {
      await runFlow(resolve(flowsDir, flow))
    }
  }

  // 6. Summary
  console.log(`\n${green("=".repeat(50))}`)
  console.log(`  结果: ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : green("0 failed")}`)
  console.log(`${green("=".repeat(50))}`)

  // 7. Cleanup
  if (mockProcess) {
    mockProcess.kill()
    console.log(yellow("[Cleanup] Mock Bridge 已停止"))
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
