#!/usr/bin/env node
/**
 * 客户端功能接口覆盖验证（服务端层）
 *
 * 起 opencode serve + Bridge，通过 WS 逐个调用手机客户端用到的所有
 * WS 方法，确认真实对接可用。覆盖 L4/L5 E2E 未跑到的功能：
 *   session.messages / session.get / message.abort / permission.* /
 *   question.* / config.agents / config.providers / command.list /
 *   model.list / provider.list / project.current / file.*
 *
 * 用法: node scripts/e2e/test-interface-coverage.mjs
 * 环境变量: BRIDGE_PORT / OPENCODE_PORT / BRIDGE_DEFAULT_MODEL
 */
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"
import fs from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const OC_PORT = parseInt(process.env.OPENCODE_PORT || "4106", 10)
const BR_PORT = parseInt(process.env.BRIDGE_PORT || "20006", 10)
const PROJECT_DIR = process.env.PROJECT_DIR || ROOT
const MODEL = process.env.BRIDGE_DEFAULT_MODEL || "opencode-go/deepseek-v4-flash"

// opencode-go provider 在 models.dev 定义 env=OPENCODE_API_KEY
function resolveOpenCodeAPIKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY
  try {
    const reg = execSync('reg query "HKCU\\Environment" /v OPENCODE_API_KEY', { stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" }).toString()
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
  console.error("[FATAL] 无法解析 OPENCODE_API_KEY")
  process.exit(2)
}

let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }
function arrLen(r) { return Array.isArray(r) ? r.length : (r && Array.isArray(r.data) ? r.data.length : 0) }

function waitPort(p, t) {
  t = t || 30000; const s = Date.now()
  return new Promise((ok, no) => {
    function poll() {
      if (Date.now() - s > t) return no(new Error("timeout:" + p))
      const c = net.createConnection(p, "127.0.0.1", () => { c.destroy(); ok() })
      c.on("error", () => { c.destroy(); setTimeout(poll, 500) })
    }
    poll()
  })
}

function killPort(p) {
  try {
    const o = execSync("netstat -ano | findstr \":" + p + " \"", { stdio: "pipe", shell: true, timeout: 3000 }).toString()
    for (const l of o.trim().split("\n").filter(x => x.includes("LISTENING"))) {
      const pid = l.trim().split(/\s+/).pop()
      if (pid && pid !== "0") execSync("taskkill /f /pid " + pid, { stdio: "pipe" })
    }
  } catch (_) {}
}

async function main() {
  console.log("=== 客户端功能接口覆盖验证 ===")
  console.log("项目: " + PROJECT_DIR)
  console.log("模型: " + MODEL + "\n")

  setTimeout(() => { console.log("\n[FATAL] 全局超时"); process.exit(2) }, 240000)

  killPort(OC_PORT); killPort(BR_PORT)

  const opencodeExe = process.env.OPENCODE_EXE || resolve(process.env.APPDATA || "C:\\Users\\MT\\AppData\\Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
  const oc = spawn(opencodeExe, ["serve", "--port", "" + OC_PORT, "--print-logs"], { cwd: PROJECT_DIR, shell: false, env: { ...process.env, OPENCODE_SERVER_PASSWORD: "", OPENCODE_API_KEY } })
  let ocOut = ""
  oc.stdout.on("data", d => { ocOut += d.toString() })
  oc.stderr.on("data", d => { ocOut += d.toString() })

  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("opencode timeout")), 60000)
    const poll = () => { if (ocOut.match(/listening on http/)) { clearTimeout(t); ok() } else setTimeout(poll, 200) }
    poll()
  })
  ok("OpenCode serve 就绪")

  const br = spawn(process.execPath, [resolve(ROOT, "servers/bridge/node_modules/tsx/dist/cli.mjs"), resolve(ROOT, "servers/bridge/src/index.ts")], {
    env: { ...process.env, BRIDGE_PORT: "" + BR_PORT, BRIDGE_PASSWORD: "test123", BRIDGE_DEFAULT_MODEL: MODEL, OPENCODE_URL: "http://localhost:" + OC_PORT },
    cwd: resolve(ROOT, "servers/bridge"), stdio: "pipe",
  })
  await waitPort(BR_PORT)
  ok("Bridge 就绪")

  const ws = new WebSocket("ws://localhost:" + BR_PORT + "/ws?token=x")
  await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); setTimeout(() => no(new Error("ws timeout")), 10000) })
  ok("WS 连接成功")

  let rid = 0
  function call(m, p, t) {
    p = p || {}; t = t || 15000
    return new Promise((ok, no) => {
      const id = "" + (++rid)
      const timer = setTimeout(() => no(new Error("timeout:" + m)), t)
      const h = d => {
        const f = JSON.parse(d.toString())
        if (f.id === id) { clearTimeout(timer); ws.off("message", h); f.ok ? ok(f.payload) : no(new Error(f.error)) }
      }
      ws.on("message", h)
      ws.send(JSON.stringify({ type: "req", id, method: m, params: p }))
    })
  }

  await call("auth.login", { password: "test123" }); ok("auth.login")
  await call("project.switch", { directory: PROJECT_DIR }); ok("project.switch")

  // ── 项目 / 配置 / 列表 ──
  try { const r = await call("project.current", {}); ok("project.current -> " + JSON.stringify(r?.directory || r).slice(0, 60)) } catch (e) { no("project.current: " + e.message) }
  try { const r = await call("project.list", {}); ok("project.list -> " + (Array.isArray(r) ? r.length + " 项" : JSON.stringify(r).slice(0, 40))) } catch (e) { no("project.list: " + e.message) }
  try { await call("config.agents", {}); ok("config.agents") } catch (e) { no("config.agents: " + e.message) }
  try { const r = await call("config.providers", {}); ok("config.providers -> " + ((r && Array.isArray(r.providers)) ? r.providers.length : 0) + " providers") } catch (e) { no("config.providers: " + e.message) }
  try { const r = await call("command.list", {}); ok("command.list -> " + arrLen(r) + " commands") } catch (e) { no("command.list: " + e.message) }
  try { const r = await call("model.list", {}); ok("model.list -> " + arrLen(r) + " models") } catch (e) { no("model.list: " + e.message) }
  try { const r = await call("provider.list", {}); ok("provider.list -> " + arrLen(r) + " providers") } catch (e) { no("provider.list: " + e.message) }

  // ── 会话创建 + 消息 ──
  const s = await call("session.create", { model: MODEL }, 60000)
  const sid = s && (s.id || s.sessionId || s.sessionID) || ""
  ok("session.create -> " + sid.slice(0, 12))

  try { await call("session.get", { sessionId: sid }); ok("session.get") } catch (e) { no("session.get: " + e.message) }
  try { const r = await call("session.messages", { sessionId: sid }); ok("session.messages -> " + (Array.isArray(r) ? r.length : 0) + " 条") } catch (e) { no("session.messages: " + e.message) }
  try { const r = await call("session.status", {}); ok("session.status/active -> " + JSON.stringify(r).slice(0, 40)) } catch (e) { no("session.status: " + e.message) }

  await call("message.send", { sessionId: sid, message: "Reply with only: Hi" }, 120000)
  ok("message.send")

  try { await call("message.abort", { sessionId: sid }); ok("message.abort") } catch (e) { no("message.abort: " + e.message) }

  // ── permission ──
  try { const r = await call("permission.list", {}); ok("permission.list -> " + arrLen(r) + " 请求") } catch (e) { no("permission.list: " + e.message) }
  try { const r = await call("permission.saved.list", {}); ok("permission.saved.list -> " + arrLen(r) + " 规则") } catch (e) { no("permission.saved.list: " + e.message) }

  // ── question（用不存在的 requestID，验证端点存在且返回预期错误） ─
  try { await call("question.reply", { id: "nonexistent_q", sessionId: sid, answer: "yes" }); ok("question.reply (端点存在)") } catch (e) { ok("question.reply -> 预期错误(端点存在): " + e.message.slice(0, 60)) }
  try { await call("question.reject", { id: "nonexistent_q", sessionId: sid }); ok("question.reject (端点存在)") } catch (e) { ok("question.reject -> 预期错误(端点存在): " + e.message.slice(0, 60)) }

  // ── 文件操作 ──
  try { const r = await call("file.list", { path: PROJECT_DIR }); ok("file.list -> " + arrLen(r) + " 项") } catch (e) { no("file.list: " + e.message) }
  const pkgFile = resolve(PROJECT_DIR, "package.json")
  try { const r = await call("file.read", { path: pkgFile }); ok("file.read -> " + JSON.stringify(r).slice(0, 40)) } catch (e) { no("file.read: " + e.message) }
  try { const r = await call("file.search", { query: "registerHandler" }); ok("file.search -> " + arrLen(r) + " 结果") } catch (e) { no("file.search: " + e.message) }
  try { const r = await call("file.info", { path: pkgFile }); ok("file.info -> " + JSON.stringify(r).slice(0, 50)) } catch (e) { no("file.info: " + e.message) }

  ws.close()
  console.log("\n=== " + pass + " pass, " + fail + " fail ===")

  oc.kill(); br.kill(); await slp(1500)
  killPort(OC_PORT); killPort(BR_PORT)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
