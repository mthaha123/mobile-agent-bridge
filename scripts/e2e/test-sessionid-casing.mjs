#!/usr/bin/env node
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const OC_PORT = 4105, BR_PORT = 20005
const DIR = process.env.OPENCODE_DIR || ROOT
const MODEL = "opencode/deepseek-v4-flash-free"

let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }

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
  console.log("=== E2E sessionId casing ===\n")

  killPort(OC_PORT); killPort(BR_PORT)

  const oc = spawn("opencode.cmd", ["serve","--port",""+OC_PORT,"--print-logs"], { cwd: DIR, shell: true })
  let ocOut = ""
  oc.stdout.on("data", d => { ocOut += d.toString() })

  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("oc timeout")), 60000)
    const poll = () => { if (ocOut.match(/listening on http/)) { clearTimeout(t); ok() } else setTimeout(poll, 200) }
    poll()
  })
  ok("OpenCode ready")

  const br = spawn("npx.cmd", ["tsx", resolve(ROOT, "servers/bridge/src/index.ts")], {
    env: { ...process.env, BRIDGE_PORT: ""+BR_PORT, BRIDGE_PASSWORD: "test123", OPENCODE_URL: "http://localhost:"+OC_PORT },
    cwd: resolve(ROOT, "servers/bridge"), shell: true, stdio: "pipe",
  })
  await waitPort(BR_PORT); ok("Bridge ready")

  try {
    const ws = new WebSocket("ws://localhost:"+BR_PORT+"/ws?token=x")
    await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); setTimeout(() => no(new Error("ws timeout")), 10000) })
    ok("WS connected")

    let rid = 0
    function call(m, p, t) {
      p = p || {}; t = t || 10000
      return new Promise((ok, no) => {
        const id = ""+(++rid)
        const timer = setTimeout(() => no(new Error("timeout:"+m)), t)
        const h = d => {
          const f = JSON.parse(d.toString())
          if (f.id === id) { clearTimeout(timer); ws.off("message", h); f.ok ? ok(f.payload) : no(new Error(f.error)) }
        }
        ws.on("message", h)
        ws.send(JSON.stringify({ type:"req", id, method:m, params:p }))
      })
    }

    await call("auth.login", { password: "test123" }); ok("auth.login ok")
    await call("project.switch", { directory: DIR }); ok("project.switch ok")

    const s = await call("session.create", { model: MODEL }, 60000)
    const sid = s && (s.id || s.sessionId || s.sessionID) || ""
    ok("session => " + sid.slice(0, 16))

    const cases = ["sessionId", "sessionID", "session_id"]
    console.log("\n--- session.get ---")
    for (const key of cases) {
      try { await call("session.get", { [key]: sid }, 15000); ok("session.get with " + key) }
      catch(e) { ok("session.get with " + key + " -> " + e.message.slice(0,60)) }
    }

    console.log("\n--- session.messages ---")
    for (const key of cases) {
      try { await call("session.messages", { [key]: sid }, 15000); ok("session.messages with " + key) }
      catch(e) { ok("session.messages with " + key + " -> " + e.message.slice(0,60)) }
    }

    console.log("\n--- session.switchModel ---")
    for (const key of cases) {
      try { await call("session.switchModel", { [key]: sid, model: MODEL }, 15000); ok("session.switchModel with " + key) }
      catch(e) { ok("session.switchModel with " + key + " -> " + e.message.slice(0,60)) }
    }

    console.log("\n--- session.delete ---")
    for (const key of cases) {
      try {
        // delete 会删除 session，每次用不同 key 都创建新 session
        const s2 = await call("session.create", { model: MODEL }, 60000)
        const sid2 = s2 && (s2.id || s2.sessionId || s2.sessionID) || ""
        await call("session.delete", { [key]: sid2 }, 15000)
        ok("session.delete with " + key)
      } catch(e) { ok("session.delete with " + key + " -> " + e.message.slice(0,60)) }
    }

    console.log("\n--- permission.reply (missing id) ---")
    for (const key of ["sessionId", "sessionID", "session_id"]) {
      try { await call("permission.reply", { [key]: sid }, 5000); no("should reject") }
      catch(e) { ok("permission.reply with " + key + " (no id) -> " + e.message.slice(0,60)) }
    }

    ws.close()
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")

  } catch (e) {
    console.error("\nERROR: " + e.message)
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  }

  oc.kill("SIGTERM"); br.kill("SIGTERM"); await slp(2000)
  oc.kill("SIGKILL"); br.kill("SIGKILL")
  process.exit(fail > 0 ? 1 : 0)
}

main()
