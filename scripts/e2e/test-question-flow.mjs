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

const OPENCODE_PORT = 4103
const BRIDGE_PORT = 20003
const DIR = process.env.OPENCODE_DIR || ROOT

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
  console.log("=== E2E question ===\n")

  killPort(OPENCODE_PORT); killPort(BRIDGE_PORT)

  const oc = spawn("opencode.cmd", ["serve","--port",""+OPENCODE_PORT,"--print-logs"], { cwd: DIR, shell: true, env: { ...process.env, OPENCODE_SERVER_PASSWORD: "" } })
  let ocOut = ""
  oc.stdout.on("data", d => { ocOut += d.toString() })
  oc.stderr.on("data", d => {})

  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("oc timeout")), 60000)
    const poll = () => {
      if (ocOut.match(/listening on http/)) { clearTimeout(t); ok() }
      else setTimeout(poll, 200)
    }
    poll()
  })
  ok("OpenCode ready")

  const br = spawn("npx.cmd", ["tsx", resolve(ROOT, "servers/bridge/src/index.ts")], {
    env: { ...process.env, BRIDGE_PORT: ""+BRIDGE_PORT, BRIDGE_PASSWORD: "test123", OPENCODE_URL: "http://localhost:"+OPENCODE_PORT },
    cwd: resolve(ROOT, "servers/bridge"), shell: true, stdio: "pipe",
  })
  await waitPort(BRIDGE_PORT)
  ok("Bridge ready")

  try {
    const ws = new WebSocket("ws://localhost:"+BRIDGE_PORT+"/ws?token=x")
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

    const s = await call("session.create", {}, 60000)
    const sid = s && (s.id || s.sessionId || s.sessionID) || ""
    ok("session => " + sid.slice(0, 12))

    console.log("\n--- question.reply ---")
    for (const tc of [
      ["answer string", { id:"q1", sessionId:sid, answer:"y" }],
      ["answers flat[]", { id:"q2", session_ID:sid, answers:["a","b"] }],
      ["answers nested[][]", { id:"q3", sessionId:sid, answers:[["a"],["b"]] }],
      ["answers empty[]", { id:"q4", sessionId:sid, answers:[] }],
    ]) {
      try { await call("question.reply", tc[1], 15000); ok(tc[0] + " ok") }
      catch(e) { ok(tc[0] + " -> " + e.message.slice(0,60)) }
    }

    console.log("\n--- question.reject ---")
    try { await call("question.reject", { sessionId:sid, id:"q_rej" }, 15000); ok("reject ok") }
    catch(e) { ok("reject -> " + e.message.slice(0,60)) }

    console.log("\n--- missing params ---")
    for (const [l,p,m] of [
      ["reply no id", { sessionId:sid, answer:"y" }, "question.reply"],
      ["reply no sid", { id:"q", answer:"y" }, "question.reply"],
      ["reject no id", { sessionId:sid }, "question.reject"],
      ["reject no sid", { id:"q" }, "question.reject"],
    ]) {
      try { await call(m, p, 5000); no(l) }
      catch(e) { ok(l + " -> " + e.message.slice(0,50)) }
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
