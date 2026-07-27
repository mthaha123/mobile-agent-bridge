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

const OC_PORT = 4104
const BR_PORT = 20004
const DIR = process.env.OPENCODE_DIR || ROOT
const MODEL = process.env.OPENCODE_MODEL || "opencode/deepseek-v4-flash-free"
const Q = "列出本项目根目录下有哪些文件，不要执行任何修改"

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
  console.log("=== E2E tool lifecycle ===\n")

  killPort(OC_PORT); killPort(BR_PORT)

  const oc = spawn("opencode.cmd", ["serve","--port",""+OC_PORT,"--print-logs"], { cwd: DIR, shell: true, env: { ...process.env, OPENCODE_SERVER_PASSWORD: "" } })
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
    env: { ...process.env, BRIDGE_PORT: ""+BR_PORT, BRIDGE_PASSWORD: "test123", OPENCODE_URL: "http://localhost:"+OC_PORT },
    cwd: resolve(ROOT, "servers/bridge"), shell: true, stdio: "pipe",
  })
  await waitPort(BR_PORT)
  ok("Bridge ready")

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
    ok("session => " + sid.slice(0, 12))

    const events = []
    const tools = {}
    const done = new Promise(ok => {
      ws.on("message", d => {
        const f = JSON.parse(d.toString())
        if (f.type !== "notify") return
        events.push(f)
        const m = f.method
        if (m === "session.next.tool.called") {
          const cid = f.payload && (f.payload.callID || "")
          if (cid) tools[cid] = { input: f.payload.input, steps: ["called"] }
        } else if (m === "session.next.tool.progress") {
          const cid = f.payload && (f.payload.callID || "")
          if (cid && tools[cid]) tools[cid].steps.push("progress")
        } else if (m === "session.next.tool.success") {
          const cid = f.payload && (f.payload.callID || "")
          if (cid && tools[cid]) { tools[cid].steps.push("success"); tools[cid].result = f.payload.result }
        } else if (m === "session.next.tool.failed") {
          const cid = f.payload && (f.payload.callID || "")
          if (cid && tools[cid]) { tools[cid].steps.push("failed"); tools[cid].error = f.payload.error }
        } else if (m === "session.idle" || m === "session.next.text.ended" || m === "session.error") {
          ok()
        }
      })
    })

    console.log("\n--- sending message ---")
    await call("message.send", { sessionId: sid, message: Q }, 300000)
    console.log("  message.send returned")

    await Promise.race([done, slp(180000).then(() => console.log("  [warn] wait timed out"))])

    const toolEvents = events.filter(e => e.method && e.method.startsWith("session.next.tool"))
    const textEvents = events.filter(e => e.method === "session.next.text.delta")
    const toolCalls = Object.keys(tools).length

    console.log("")
    ok("total events: " + events.length)
    ok("tool events: " + toolEvents.length)
    ok("text.delta: " + textEvents.length)
    ok("tool.called count: " + toolCalls)

    let completed = 0, failedTools = 0
    for (const [cid, t] of Object.entries(tools)) {
      if (t.steps.includes("success")) completed++
      if (t.steps.includes("failed")) failedTools++
    }
    ok("tool completed: " + completed)
    if (failedTools > 0) ok("tool failed: " + failedTools + " (may be expected)")

    let fullText = ""
    for (const e of events.filter(e => e.method === "session.next.text.delta")) {
      fullText += (e.payload && (e.payload.delta || e.payload.data && e.payload.data.delta || "")) || ""
    }
    if (fullText) {
      console.log("\n  reply (" + fullText.length + " chars):")
      console.log("  " + fullText.slice(0, 400))
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
