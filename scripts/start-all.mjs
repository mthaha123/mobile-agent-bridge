#!/usr/bin/env node
/**
 * start-all.mjs — 一键启动 opencode serve + bridge + 内网穿透隧道
 *
 * 用法:
 *   node scripts/start-all.mjs          一键启动三件套
 *   node scripts/start-all.mjs --status 查看 PID / 端口 / 隧道 URL
 *   node scripts/start-all.mjs --stop   按 PID 精确停止全部
 *
 * 约束（AGENTS.md）:
 *   - 所有长驻进程 spawn detached + stdio:"ignore" + unref()，完全脱离进程树/管道
 *   - 清理按 PID 精确匹配，禁止 taskkill /f /im opencode.exe（避免连带杀 serve/当前会话）
 *   - opencode serve 直接 spawn exe 绝对路径（不走 .cmd/shell:true，env 才可靠）
 *   - 日志统一写 logs/build/
 */
import { spawn, execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, createWriteStream } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const logDir = path.join(rootDir, "logs", "build")
const LOG_PREFIX = (n) => path.join(logDir, n)

const OPENCODE_EXE = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
const TSX = path.join(rootDir, "servers", "bridge", "node_modules", "tsx", "dist", "cli.mjs")
const BRIDGE_SRC = path.join(rootDir, "servers", "bridge", "src", "index.ts")
const CLOUDFLARED = path.join(rootDir, "scripts", "tools", "cloudflared.exe")

const SERVE_PORT = 4096
const BRIDGE_PORT = 8080
const BRIDGE_PASSWORD = "test123"
const SERVE_CWD = "D:\\code\\mobile-agent-bridge"
const BRIDGE_CWD = path.join(rootDir, "servers", "bridge")
const TUNNEL_URL = `http://localhost:${BRIDGE_PORT}`

mkdirSync(logDir, { recursive: true })

// ─── 工具函数 ─────────────────────────────────────────────

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解析 OPENCODE_API_KEY：env → 注册表(User) → auth.json */
function resolveOpenCodeAPIKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY
  try {
    const reg = execSync('reg query "HKCU\\Environment" /v OPENCODE_API_KEY', { encoding: "utf8", timeout: 5000 })
    const m = reg.match(/OPENCODE_API_KEY\s+REG_\w+\s+(\S+)/)
    if (m && m[1]) return m[1]
  } catch {}
  try {
    const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf8"))
      for (const p of ["opencode-go", "opencode"]) {
        if (auth[p] && typeof auth[p].key === "string" && auth[p].key) return auth[p].key
      }
    }
  } catch {}
  return ""
}

/** 从 PID 文件提取数字 PID（兼容 UTF-8 / UTF-16 编码，strip BOM） */
function readPid(pidFile) {
  if (!existsSync(pidFile)) return 0
  try {
    const raw = readFileSync(pidFile)
    // 去掉 UTF-8/UTF-16 BOM 及非数字字符
    const text = raw.toString("utf8").replace(/^\uFEFF/, "").replace(/[^0-9]/g, "")
    return parseInt(text, 10) || 0
  } catch { return 0 }
}

/** 读 PID 文件，返回进程是否存活 */
function pidAlive(pidFile) {
  const pid = readPid(pidFile)
  if (!pid) return false
  try {
    const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { encoding: "utf8", timeout: 5000 })
    return out.trim().length > 0 && !out.includes("INFO: No tasks")
  } catch { return false }
}

/** 端口是否在监听 */
function portListening(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8", timeout: 5000 })
    return out.trim().length > 0
  } catch { return false }
}

/** 按 PID 精确 kill（禁止 -im 无差别杀） */
function killPid(pid) {
  if (!pid) return
  try { execSync(`taskkill /f /pid ${pid}`, { stdio: "ignore", timeout: 5000 }) } catch {}
}

/** 日志文件是否出现匹配行 */
function logHas(logFile, re) {
  if (!existsSync(logFile)) return false
  try { return re.test(readFileSync(logFile, "utf8")) } catch { return false }
}

/** 短查询轮询直到条件成立或超时 */
async function waitFor(fn, what, timeoutMs = 20000, intervalMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await sleep(intervalMs)
  }
  return false
}// ─── 启动各服务 ───────────────────────────────────────────

/** 启动 opencode serve */
function startServe() {
  console.log(yellow("[1/3] opencode serve (port " + SERVE_PORT + ")..."))
  const key = resolveOpenCodeAPIKey()
  if (!key) {
    console.log(red("[FATAL] 无法解析 OPENCODE_API_KEY"))
    return null
  }
  const pidFile = LOG_PREFIX("serve.pid")
  if (pidAlive(pidFile)) {
    console.log(yellow("  serve 已在运行 (PID " + readPid(pidFile) + ")，跳过"))
    return true
  }
  const logFile = LOG_PREFIX("opencode-serve.log")
  try { rmSync(logFile, { force: true }) } catch {}
  const child = spawn(OPENCODE_EXE, ["serve", "--port", String(SERVE_PORT), "--print-logs"], {
    detached: true,
    stdio: "ignore",
    cwd: SERVE_CWD,
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: "", OPENCODE_API_KEY: key },
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
  console.log("  已启动 PID " + child.pid)
  return true
}

/** 启动 bridge */
function startBridge() {
  console.log(yellow("[2/3] bridge (port " + BRIDGE_PORT + ")..."))
  const pidFile = LOG_PREFIX("bridge.pid")
  if (portListening(BRIDGE_PORT)) {
    console.log(yellow("  bridge 端口 " + BRIDGE_PORT + " 已在监听，跳过"))
    return true
  }
  const logFile = LOG_PREFIX("bridge.log")
  try { rmSync(logFile, { force: true }) } catch {}
  const child = spawn(process.execPath, [TSX, BRIDGE_SRC], {
    detached: true,
    stdio: "ignore",
    cwd: BRIDGE_CWD,
    env: { ...process.env, BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_PASSWORD, OPENCODE_URL: `http://localhost:${SERVE_PORT}` },
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
  console.log("  已启动 PID " + child.pid)
  return true
}

/** 启动 cloudflared 隧道 */
function startTunnel() {
  console.log(yellow("[3/3] cloudflared 隧道 → " + TUNNEL_URL + "..."))
  const pidFile = LOG_PREFIX("cf-tunnel.pid")
  if (pidAlive(pidFile)) {
    console.log(yellow("  cloudflared 已在运行 (PID " + readPid(pidFile) + ")，跳过"))
    return true
  }
  const logFile = LOG_PREFIX("cf-tunnel.log")
  try { rmSync(logFile, { force: true }) } catch {}
  const child = spawn(CLOUDFLARED, [
    "tunnel", "--url", TUNNEL_URL, "--no-autoupdate",
    "--logfile", logFile, "--loglevel", "info",
  ], {
    detached: true,
    stdio: "ignore",
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
  console.log("  已启动 PID " + child.pid)
  return true
}

// ─── 就绪等待（带进度输出，不静默） ─────────────────────────

async function waitServe(timeoutMs = 25000) {
  return waitForWithProgress(() => portListening(SERVE_PORT), "serve 端口 " + SERVE_PORT, timeoutMs)
}

async function waitBridge(timeoutMs = 25000) {
  return waitForWithProgress(() => portListening(BRIDGE_PORT), "bridge 端口 " + BRIDGE_PORT, timeoutMs)
}

async function waitTunnel(timeoutMs = 30000) {
  return waitForWithProgress(
    () => logHas(LOG_PREFIX("cf-tunnel.log"), /https:\/\/[a-z0-9\-]+\.trycloudflare\.com/),
    "隧道 URL",
    timeoutMs,
  )
}

/** 轮询直到条件成立或超时，每轮打印进度 */
async function waitForWithProgress(fn, what, timeoutMs = 20000, intervalMs = 1000) {
  const start = Date.now()
  let last = ""
  while (Date.now() - start < timeoutMs) {
    if (fn()) {
      console.log(green("  ✓ " + what + " 就绪 (" + Math.round((Date.now() - start) / 1000) + "s)"))
      return true
    }
    const s = Math.round((Date.now() - start) / 1000)
    const line = "  ⏳ 等待 " + what + " (" + s + "s)..."
    if (line !== last) {
      console.log(line)
      last = line
    }
    await sleep(intervalMs)
  }
  console.log(red("  ✗ " + what + " 超时 (" + Math.round(timeoutMs / 1000) + "s)"))
  return false
}

// ─── 状态 / 停止 ──────────────────────────────────────────

function status() {
  console.log("── 服务状态 ──")
  for (const [name, pidFile, port] of [
    ["opencode serve", LOG_PREFIX("serve.pid"), SERVE_PORT],
    ["bridge", LOG_PREFIX("bridge.pid"), BRIDGE_PORT],
    ["cloudflared", LOG_PREFIX("cf-tunnel.pid"), null],
  ]) {
    const alive = pidAlive(pidFile)
    const portStr = port ? (portListening(port) ? `端口${port}✓` : `端口${port}✗`) : ""
    const pid = readPid(pidFile) || "-"
    console.log(`  ${name.padEnd(14)} PID=${String(pid).padEnd(7)} ${alive ? green("存活") : red("已停")} ${portStr}`)
  }
  const c = LOG_PREFIX("cf-tunnel.log")
  if (existsSync(c)) {
    const m = readFileSync(c, "utf8").match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/)
    if (m) console.log(`  Tunnel URL: ${m[0]}`)
  }
}

function stop() {
  console.log("── 停止全部 ──")
  for (const name of ["cf-tunnel", "bridge", "serve"]) {
    const pidFile = LOG_PREFIX(name + ".pid")
    const pid = readPid(pidFile)
    if (pid) {
      killPid(pid)
      console.log(`  ${name}: killed PID ${pid}`)
    }
    try { rmSync(pidFile, { force: true }) } catch {}
  }
}

// ─── main ─────────────────────────────────────────────────

/**
 * 启动模式：
 *   - 默认（无参数 / --start）：fire-and-forget——spawn 三个服务后立即退出（<1s）。
 *     不要在 bash 里同步等待本脚本，长驻进程会拖住 bash 工具（工具层判进程树未收敛）。
 *   - --wait：显式等待就绪，每轮打印进度（供人工/脚本确认，勿在 bash 工具里同步跑）。
 *   - --status / --stop：短查询 / 精确停止。
 */
async function main() {
  const arg = process.argv[2]
  if (arg === "--status") { status(); return }
  if (arg === "--stop") { stop(); return }
  const doWait = arg === "--wait"

  if (!existsSync(OPENCODE_EXE)) { console.log(red("[FATAL] opencode.exe not found: " + OPENCODE_EXE)); process.exit(1) }
  if (!existsSync(TSX)) { console.log(red("[FATAL] tsx not found: " + TSX)); process.exit(1) }
  if (!existsSync(CLOUDFLARED)) { console.log(red("[FATAL] cloudflared.exe not found: " + CLOUDFLARED)); process.exit(1) }

  startServe()
  startBridge()
  startTunnel()

  if (doWait) {
    await waitServe()
    await waitBridge()
    await waitTunnel()
    const c = LOG_PREFIX("cf-tunnel.log")
    if (existsSync(c)) {
      const m = readFileSync(c, "utf8").match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/)
      if (m) {
        console.log(green("  隧道 URL : " + m[0]))
        console.log(green("  手机端 WS: wss://" + m[0].replace("https://", "") + "/ws"))
        console.log(green("  密码     : " + BRIDGE_PASSWORD))
      }
    }
  } else {
    console.log(green("三个服务已派发启动（fire-and-forget）。用 --status 查询，或 --wait 等就绪。"))
  }
}

main().catch((e) => { console.error(red("[FATAL] " + e.message)); process.exit(1) })
