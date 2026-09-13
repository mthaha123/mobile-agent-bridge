#!/usr/bin/env node
/**
 * verify-prod-env.mjs — 生产环境隔离冒烟验证
 *
 * 启动一个【独立端口 + 独立数据目录 + 独立 serve 端口池】的 bridge 实例，验证：
 *   1) /health 返回 200 且 JSON 正确；
 *   2) BRIDGE_DATA_DIR 生效：projects.json 落在临时目录，不碰生产/开发数据；
 *   3) BRIDGE_SERVE_PORT_POOL 生效：不占用默认 4100-4104；
 *   4) 停止后监听端口释放。
 *
 * 不依赖 opencode serve（bridge 启动本身不会主动拉起 serve）。
 * 用法: node scripts/verify-prod-env.mjs
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const TSX = path.join(root, "servers", "bridge", "node_modules", "tsx", "dist", "cli.mjs")
const BRIDGE_SRC = path.join(root, "servers", "bridge", "src", "index.ts")

const BRIDGE_PORT = 18443
const SERVE_POOL = "4310,4311,4312"
const DATA_DIR = path.join(root, "logs", "build", "prod-env-smoke-data")
const LOG_FILE = path.join(root, "logs", "build", "prod-env-smoke.log")

let child = null
let finished = false

function log(msg) { process.stdout.write(msg + "\n") }
function fail(msg) { log("[FAIL] " + msg); cleanup(1) }

function cleanup(code) {
  if (finished) return
  finished = true
  try { clearTimeout(globalTimeout) } catch {}
  if (child && child.pid) {
    try {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true })
    } catch {}
  }
  setTimeout(() => {
    // 等端口释放后收尾
    portListening(BRIDGE_PORT).then((up) => {
      if (up) { log("[FAIL] 端口未释放 " + BRIDGE_PORT); process.exit(1) }
      log("[PASS] 端口 " + BRIDGE_PORT + " 已释放")
      log(code === 0 ? "\n✅ 生产环境隔离冒烟通过" : "\n❌ 冒烟失败")
      process.exit(code)
    })
  }, 800)
}

function httpGetJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = ""
      res.on("data", (c) => (body += c))
      res.on("end", () => resolve({ status: res.statusCode, body }))
    })
    req.on("error", () => resolve(null))
    req.on("timeout", () => { req.destroy(); resolve(null) })
  })
}

function portListening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1")
    s.once("connect", () => { s.destroy(); resolve(true) })
    s.once("error", () => resolve(false))
  })
}

async function waitHealth(deadlineMs) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    const r = await httpGetJson(`http://127.0.0.1:${BRIDGE_PORT}/health`)
    if (r && r.status === 200) return r
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

const globalTimeout = setTimeout(() => fail("全局超时（bridge 未就绪）"), 60000)

async function main() {
  if (!existsSync(TSX)) fail("tsx 不存在: " + TSX)
  if (await portListening(BRIDGE_PORT)) fail("端口 " + BRIDGE_PORT + " 已被占用，请先释放")

  // 干净临时数据目录（顺带验证不会读到开发数据）
  rmSync(DATA_DIR, { recursive: true, force: true })
  mkdirSync(DATA_DIR, { recursive: true })
  log("── 启动生产仿真 bridge (port " + BRIDGE_PORT + ", data=" + DATA_DIR + ") ──")

  const entry = process.env.BRIDGE_ENTRY || BRIDGE_SRC
  const entryArgs = process.env.BRIDGE_ENTRY ? [entry] : [TSX, BRIDGE_SRC]
  log("  入口: " + entry)

  child = spawn(process.execPath, entryArgs, {
    cwd: path.join(root, "servers", "bridge"),
    env: {
      ...process.env,
      BRIDGE_PORT: String(BRIDGE_PORT),
      BRIDGE_PASSWORD: "test123",
      BRIDGE_DATA_DIR: DATA_DIR,
      BRIDGE_SERVE_PORT_POOL: SERVE_POOL,
      OPENCODE_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  let out = ""
  child.stdout.on("data", (d) => (out += d.toString()))
  child.stderr.on("data", (d) => (out += d.toString()))
  child.on("exit", (code) => {
    if (!finished) fail("bridge 提前退出 code=" + code + "\n" + out)
  })

  // 1) /health
  const health = await waitHealth(30000)
  if (!health) { log(out); fail("/health 未在 30s 内就绪") }
  let parsed
  try { parsed = JSON.parse(health.body) } catch { fail("/health 返回非 JSON: " + health.body) }
  if (parsed.ok !== true || parsed.service !== "mobile-agent-bridge" || parsed.port !== BRIDGE_PORT) {
    fail("/health 内容异常: " + health.body)
  }
  log("[PASS] /health 200: " + health.body)

  // 2) 独立数据目录生效（未被开发数据污染）
  const registry = path.join(DATA_DIR, "projects.json")
  if (!existsSync(registry)) fail("BRIDGE_DATA_DIR 未生效，缺少 " + registry)
  log("[PASS] 独立数据目录生效: " + registry)

  // 3) serve 端口池隔离：本实例实际生效的是配置的池，而非默认 4100-4104
  const pool = parsed.servePortPool
  const expected = SERVE_POOL.split(",").map((s) => parseInt(s, 10))
  if (!Array.isArray(pool) || JSON.stringify(pool) !== JSON.stringify(expected)) {
    fail("serve 端口池未按 BRIDGE_SERVE_PORT_POOL 生效: " + JSON.stringify(pool))
  }
  if (pool.some((p) => [4100, 4101, 4102, 4103, 4104].includes(p))) {
    fail("端口池仍包含默认端口，隔离失效: " + JSON.stringify(pool))
  }
  log("[PASS] serve 端口池隔离生效: " + JSON.stringify(pool))

  // 4) 数据目录也随配置生效
  if (parsed.dataDir !== DATA_DIR) fail("dataDir 未生效: " + parsed.dataDir)
  log("[PASS] /health dataDir 生效")

  cleanup(0)
}

main().catch((e) => fail(e?.stack || String(e)))
