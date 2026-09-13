#!/usr/bin/env node
/**
 * start-all.mjs — 一键启动 opencode serve + bridge + 内网穿透隧道
 *
 * 用法:
 *   node scripts/start-all.mjs                    一键启动三件套
 *   node scripts/start-all.mjs --status           查看 PID / 端口 / 隧道 URL
 *   node scripts/start-all.mjs --stop             按 PID 精确停止全部
 *   node scripts/start-all.mjs --env-file <file>  先加载环境文件再启动（生产隔离）
 *
 * 生产/测试隔离（环境变量，均有向后兼容默认值）:
 *   SERVE_PORT             默认 serve 端口（默认 4097）
 *   BRIDGE_PORT            bridge 端口（默认 8080）
 *   BRIDGE_PASSWORD        bridge 密码（默认 test123）
 *   BRIDGE_DATA_DIR        bridge 数据目录（默认 <root>/servers/bridge/data）
 *   BRIDGE_SERVE_PORT_POOL 项目 serve 端口池，逗号分隔（默认 4100-4104）
 *   BRIDGE_LOG_DIR         日志目录（默认 <root>/logs/build）
 *   BRIDGE_RUN_DIR         PID 目录（默认同日志目录）
 *   BRIDGE_ENTRY           可选：编译产物入口（生产用 dist/index.js，免 tsx）
 *   SERVE_CWD              serve 工作目录（默认仓库根）
 *   OPENCODE_EXE / CLOUDFLARED_EXE  可执行文件路径覆盖
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
import { checkPortGroup, PROD_PORTS, DEV_PORTS } from "./ports.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")

// ─── 环境文件（可选，用于生产/测试隔离）────────────────────
// 用法: node scripts/start-all.mjs --env-file scripts/prod.env
// 必须在读取下方任何配置常量【之前】注入 process.env。
function loadEnvFile(file) {
  if (!existsSync(file)) { console.error(`[FATAL] env file not found: ${file}`); process.exit(1) }
  const text = readFileSync(file, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (key && !(key in process.env)) process.env[key] = val
  }
}

const rawArgs = process.argv.slice(2)
const envFileIdx = rawArgs.indexOf("--env-file")
if (envFileIdx !== -1 && rawArgs[envFileIdx + 1]) {
  loadEnvFile(path.resolve(rawArgs[envFileIdx + 1]))
}

// 去掉 --env-file <path>，得到真正的动作参数（供 main 使用）
// 注意：仅当确实出现 --env-file 时才剔除其值，否则会误删首个动作参数（如 --status）
const actionArgs = rawArgs.filter((_, i) => !(envFileIdx !== -1 && (i === envFileIdx || i === envFileIdx + 1)))

const intEnv = (k, d) => {
  const n = parseInt(process.env[k] || "", 10)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : d
}

const logDir = process.env.BRIDGE_LOG_DIR ? path.resolve(process.env.BRIDGE_LOG_DIR) : path.join(rootDir, "logs", "build")
const runDir = process.env.BRIDGE_RUN_DIR ? path.resolve(process.env.BRIDGE_RUN_DIR) : logDir
/** 日志文件路径（logs） */
const LOG_PREFIX = (n) => path.join(logDir, n)
/** PID 文件路径（run/pid 目录，生产与测试隔离） */
const PID_PATH = (n) => path.join(runDir, n)

const OPENCODE_EXE = process.env.OPENCODE_EXE || path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
const TSX = process.env.BRIDGE_TSX || path.join(rootDir, "servers", "bridge", "node_modules", "tsx", "dist", "cli.mjs")
const BRIDGE_SRC = path.join(rootDir, "servers", "bridge", "src", "index.ts")
/** 可选：生产用编译产物入口（如 ...\dist\index.js），设了就不再走 tsx/src */
const BRIDGE_ENTRY = process.env.BRIDGE_ENTRY ? path.resolve(process.env.BRIDGE_ENTRY) : ""
const CLOUDFLARED = process.env.CLOUDFLARED_EXE || path.join(rootDir, "scripts", "tools", "cloudflared.exe")

const SERVE_PORT = intEnv("SERVE_PORT", 4097)
const BRIDGE_PORT = intEnv("BRIDGE_PORT", 8080)
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || "test123"
const SERVE_CWD = process.env.SERVE_CWD || rootDir
const BRIDGE_CWD = path.join(rootDir, "servers", "bridge")
const TUNNEL_URL = `http://localhost:${BRIDGE_PORT}`

mkdirSync(logDir, { recursive: true })
mkdirSync(runDir, { recursive: true })

// ─── 端口分段校验（防生产/开发顺位串段）────────────────────
function validatePortSegments() {
  const pool = (process.env.BRIDGE_SERVE_PORT_POOL || "4100,4101,4102,4103,4104")
    .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0)

  if (SERVE_PORT === BRIDGE_PORT) {
    console.log(red(`[FATAL] SERVE_PORT 与 BRIDGE_PORT 不能相同 (${SERVE_PORT})`))
    process.exit(1)
  }
  if (pool.includes(SERVE_PORT) || pool.includes(BRIDGE_PORT)) {
    console.log(red(`[FATAL] serve 端口池 [${pool.join(",")}] 与 serve(${SERVE_PORT})/bridge(${BRIDGE_PORT}) 端口冲突`))
    process.exit(1)
  }
  const r = checkPortGroup([SERVE_PORT, BRIDGE_PORT, ...pool])
  if (!r.ok) {
    console.log(red("[FATAL] 端口跨生产/开发段混用，可能顺位串段冲突："))
    for (const o of r.offenders) console.log(red(`    ${o.port} → ${o.env}`))
    console.log(red(`    生产段: ${PROD_PORTS.join(",")}`))
    console.log(red(`    开发段: ${DEV_PORTS.join(",")}`))
    process.exit(1)
  }
}

// ─── 工具函数 ─────────────────────────────────────────────

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function maskKey(k) {
  return k ? `${k.slice(0, 12)}…${k.slice(-4)}` : "(empty)"
}

/**
 * 解析指定 provider 的 API key：注册表(User) → auth.json → env（三级，逐级兜底）
 *
 * 优先级理由：
 *   1) 注册表(HKCU\Environment)：`setx` 持久化的用户级变量，是显式配置的意图；
 *   2) auth.json：opencode 自己的权威凭据库（`opencode auth login` 维护），
 *      与 `opencode run` CLI 用的是同一个 key，最可靠；
 *   3) env（process.env）：**放最后**——长驻父进程（agent harness / 旧终端）
 *      常携带过期或已超额的同名 env，env-first 会把坏 key 注入 serve/bridge，
 *      触发 429（月份额度用尽）却极难定位。
 *
 * 三级各自的读取都在 try/catch 内：任一级缺失/不可读都自动降级，不会崩。
 * env 与注册表不一致时打警告，便于发现环境泄漏。
 */
function resolveProviderKey(envVar, providerId) {
  const envKey = process.env[envVar] || ""
  let regKey = ""
  try {
    const reg = execSync(`reg query "HKCU\\Environment" /v ${envVar}`, { encoding: "utf8", timeout: 5000 })
    const m = reg.match(new RegExp(`${envVar}\\s+REG_\\w+\\s+(\\S+)`))
    if (m && m[1]) regKey = m[1]
  } catch {}
  if (regKey) {
    if (envKey && envKey !== regKey) {
      console.warn(yellow(`[key] ${envVar}: 继承 env (${maskKey(envKey)}) 与注册表 (${maskKey(regKey)}) 不一致，采用注册表 key`))
    }
    return regKey
  }
  // auth.json：opencode 权威凭据库（优先于易被污染的环境变量）
  try {
    const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf8"))
      if (auth[providerId] && typeof auth[providerId].key === "string" && auth[providerId].key) {
        return auth[providerId].key
      }
    }
  } catch {}
  // env 兜底：仅当前两级都不可用时才用（避免坏 env 抢占）
  if (envKey) return envKey
  return ""
}

/** 解析 OPENCODE_API_KEY：注册表(User) → auth.json → env（opencode-go/opencode 任一） */
function resolveOpenCodeAPIKey() {
  const goKey = resolveProviderKey("OPENCODE_API_KEY", "opencode-go")
  if (goKey) return goKey
  return resolveProviderKey("OPENCODE_API_KEY", "opencode")
}

/** 解析 DEEPSEEK_API_KEY：注册表(User) → auth.json → env */
function resolveDeepSeekAPIKey() {
  return resolveProviderKey("DEEPSEEK_API_KEY", "deepseek")
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

/** 读 PID 文件，返回进程是否存活（兼容中/英文 Windows） */
function pidAlive(pidFile) {
  const pid = readPid(pidFile)
  if (!pid) return false
  try {
    const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { encoding: "utf8", timeout: 5000 })
    if (!out.trim()) return false
    // 英文: "INFO: No tasks are running..." / 中文: "没有运行的任务匹配指定标准"
    if (/INFO:|没有运行的任务/i.test(out)) return false
    // CSV 输出包含 PID 即为存在
    return out.includes(String(pid))
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
  const pidFile = PID_PATH("serve.pid")
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
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: "", OPENCODE_API_KEY: key, DEEPSEEK_API_KEY: resolveDeepSeekAPIKey() },
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
  console.log("  已启动 PID " + child.pid)
  return true
}

/** 启动 bridge */
function startBridge() {
  console.log(yellow("[2/3] bridge (port " + BRIDGE_PORT + ")..."))
  const pidFile = PID_PATH("bridge.pid")
  if (portListening(BRIDGE_PORT)) {
    console.log(yellow("  bridge 端口 " + BRIDGE_PORT + " 已在监听，跳过"))
    return true
  }
  const logFile = LOG_PREFIX("bridge.log")
  try { rmSync(logFile, { force: true }) } catch {}
  const bridgeArgs = BRIDGE_ENTRY ? [BRIDGE_ENTRY] : [TSX, BRIDGE_SRC]
  const child = spawn(process.execPath, bridgeArgs, {
    detached: true,
    stdio: "ignore",
    cwd: BRIDGE_CWD,
    env: { ...process.env, BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_PASSWORD, OPENCODE_URL: `http://localhost:${SERVE_PORT}`, OPENCODE_API_KEY: resolveOpenCodeAPIKey() },
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
  console.log("  已启动 PID " + child.pid)
  return true
}

/** 启动 cloudflared 隧道 */
function startTunnel() {
  console.log(yellow("[3/3] cloudflared 隧道 → " + TUNNEL_URL + "..."))
  const pidFile = PID_PATH("cf-tunnel.pid")
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

/**
 * 只重启 cloudflared 隧道（不触碰 serve/bridge）。
 * trycloudflare 快速隧道每次启动都会分配新的随机地址，用于「更换内网穿透地址」。
 * 重启后等待并打印新地址。
 */
async function restartTunnel() {
  console.log("── 重启 cloudflared 隧道（更换地址）──")
  const pidFile = PID_PATH("cf-tunnel.pid")
  const logFile = LOG_PREFIX("cf-tunnel.log")
  // 日志会跨重启追加：先记录旧地址，之后只认「不在旧集合里」的新地址，避免误判
  const oldUrls = existsSync(logFile)
    ? (readFileSync(logFile, "utf8").match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/g) || [])
    : []
  const pid = readPid(pidFile)
  if (pid) { killPid(pid); console.log("  旧隧道: killed PID " + pid) }
  try { rmSync(pidFile, { force: true }) } catch {}
  await new Promise((r) => setTimeout(r, 1500)) // 等旧进程释放日志文件句柄
  try { rmSync(logFile, { force: true }) } catch {}
  startTunnel()

  const deadline = Date.now() + 40000
  let newUrl = ""
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    if (!existsSync(logFile)) continue
    const urls = readFileSync(logFile, "utf8").match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/g) || []
    const fresh = urls.find((u) => !oldUrls.includes(u))
    if (fresh) { newUrl = fresh; break }
  }
  if (newUrl) {
    console.log(green("  新地址:      " + newUrl))
    console.log(green("  App WS 地址: " + newUrl.replace(/^https/, "wss") + "/ws"))
  } else {
    console.log(red("  未能获取新地址，请稍后运行: node scripts/start-all.mjs --status"))
  }
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
    ["opencode serve", PID_PATH("serve.pid"), SERVE_PORT],
    ["bridge", PID_PATH("bridge.pid"), BRIDGE_PORT],
    ["cloudflared", PID_PATH("cf-tunnel.pid"), null],
  ]) {
    const alive = pidAlive(pidFile)
    const portStr = port ? (portListening(port) ? `端口${port}✓` : `端口${port}✗`) : ""
    const pid = readPid(pidFile) || "-"
    console.log(`  ${name.padEnd(14)} PID=${String(pid).padEnd(7)} ${alive ? green("存活") : red("已停")} ${portStr}`)
  }
  const c = LOG_PREFIX("cf-tunnel.log")
  if (existsSync(c)) {
    // 日志会跨重启追加：取【最后一条】URL（最新隧道），否则会显示已失效的旧地址
    const all = readFileSync(c, "utf8").match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/g)
    if (all && all.length) console.log(`  Tunnel URL: ${all[all.length - 1]}`)
  }
}

function stop() {
  console.log("── 停止全部 ──")
  for (const name of ["cf-tunnel", "bridge", "serve"]) {
    const pidFile = PID_PATH(name + ".pid")
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
 *   - --restart-tunnel：只重启 cloudflared 隧道（更换 trycloudflare 随机地址，不动 serve/bridge）。
 */
async function main() {
  const arg = actionArgs[0]
  if (arg === "--status") { status(); return }
  if (arg === "--stop") { stop(); return }
  if (arg === "--restart-tunnel") { await restartTunnel(); return }
  validatePortSegments()
  const doWait = arg === "--wait"

  if (!existsSync(OPENCODE_EXE)) { console.log(red("[FATAL] opencode.exe not found: " + OPENCODE_EXE)); process.exit(1) }
  if (BRIDGE_ENTRY) {
    if (!existsSync(BRIDGE_ENTRY)) { console.log(red("[FATAL] BRIDGE_ENTRY not found: " + BRIDGE_ENTRY)); process.exit(1) }
  } else if (!existsSync(TSX)) {
    console.log(red("[FATAL] tsx not found: " + TSX)); process.exit(1)
  }
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
