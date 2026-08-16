#!/usr/bin/env node
/**
 * 诊断: 会话发消息后再回读历史 — 复现 select-existing-session 失败场景
 * 流程: 起 serve+bridge → 创建会话 → 发消息(HELLO_HISTORY_123) → 回读 session.messages ×2
 * 验证: rawSessionMessages 对真实会话的历史返回完整性
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

const OC_PORT = 4107, BR_PORT = 20007
const PROJECT_DIR = ROOT
const MODEL = process.env.BRIDGE_DEFAULT_MODEL || "opencode/deepseek-v4-flash-free"

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
if (!OPENCODE_API_KEY) { console.error("[FATAL] no key"); process.exit(2) }

const slp = (t) => new Promise(r => setTimeout(r, t))
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
  console.log("=== diag: session.messages 历史往返 ===")
  setTimeout(() => { console.log("[FATAL] global timeout"); process.exit(2) }, 180000)
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
  console.log("[ok] opencode serve 就绪")

  const br = spawn(process.execPath, [resolve(ROOT, "servers/bridge/node_modules/tsx/dist/cli.mjs"), resolve(ROOT, "servers/bridge/src/index.ts")], {
    env: { ...process.env, BRIDGE_PORT: "" + BR_PORT, BRIDGE_PASSWORD: "test123", BRIDGE_DEFAULT_MODEL: MODEL, OPENCODE_URL: "http://localhost:" + OC_PORT },
    cwd: resolve(ROOT, "servers/bridge"), stdio: "pipe",
  })
  await waitPort(BR_PORT)
  console.log("[ok] bridge 就绪")

  const ws = new WebSocket("ws://localhost:" + BR_PORT + "/ws?token=x")
  await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); setTimeout(() => no(new Error("ws timeout")), 10000) })
  console.log("[ok] ws connected")

  let rid = 0
  const pending = new Map()
  ws.on("message", d => {
    const f = JSON.parse(d.toString())
    const h = pending.get(f.id)
    if (h) { pending.delete(f.id); h(f) }
  })
  function call(m, p, t) {
    p = p || {}; t = t || 20000
    return new Promise((ok, no) => {
      const id = "" + (++rid)
      const timer = setTimeout(() => no(new Error("timeout:" + m)), t)
      pending.set(id, f => { clearTimeout(timer); f.ok ? ok(f.payload) : no(new Error(f.error)) })
      ws.send(JSON.stringify({ type: "req", id, method: m, params: p }))
    })
  }

  await call("auth.login", { password: "test123" })
  await call("project.switch", { directory: PROJECT_DIR })

  const s = await call("session.create", { model: MODEL }, 60000)
  const sid = s && (s.id || s.sessionId || s.sessionID) || ""
  console.log("[ok] session.create ->", sid.slice(0, 16))

  const before = await call("session.messages", { sessionId: sid })
  const beforeN = Array.isArray(before) ? before.length : (before?.messages?.length ?? 0)
  console.log("[info] messages before send:", beforeN)

  await call("message.send", { sessionId: sid, message: "Reply with the word: HELLO_HISTORY_123" }, 120000)
  await slp(2000)

  const after1 = await call("session.messages", { sessionId: sid })
  const after1List = Array.isArray(after1) ? after1 : (after1?.messages ?? [])
  console.log("[info] messages after send #1:", after1List.length)
  const texts1 = after1List.map(m => (m?.content || m?.text || "")).slice(0, 10)
  console.log("  texts:", JSON.stringify(texts1, null, 0).slice(0, 400))

  await slp(1000)
  const after2 = await call("session.messages", { sessionId: sid })
  const after2List = Array.isArray(after2) ? after2 : (after2?.messages ?? [])
  console.log("[info] messages after send #2:", after2List.length)

  const found = after2List.some(m => /HELLO_HISTORY_123/.test(String(m?.content || m?.text || "")))
  console.log(found ? "[PASS] HELLO_HISTORY_123 在历史中" : "[FAIL] HELLO_HISTORY_123 不在历史中")

  const sessList = await call("session.list", {})
  const sessArr = (Array.isArray(sessList) ? sessList : (sessList?.sessions ?? [])).map(s => ({ id: String(s.id || "").slice(0, 14), name: s.name || s.title || "" }))
  console.log("[info] session.list 总数:", sessArr.length)
  console.log("  top3:", JSON.stringify(sessArr.slice(0, 3)))
  console.log("  刚创建的 sid:", sid.slice(0, 14), "在首位?", sessArr[0]?.id?.startsWith(sid.slice(0, 14)))

  ws.close()
  oc.kill(); br.kill(); await slp(1500)
  killPort(OC_PORT); killPort(BR_PORT)
  process.exit(found ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })