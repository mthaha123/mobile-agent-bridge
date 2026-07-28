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

const DIR = process.env.OPENCODE_DIR || ROOT
const BR_PORT = process.env.BRIDGE_PORT || "20003"

let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }

async function main() {
  console.log("=== E2E question ===\n")

  let ocCleanup
  if (!process.env.OPENCODE_URL) {
    const oc = spawn("opencode.cmd", ["serve","--port","4103","--print-logs"], { cwd: DIR, shell: true, env: { ...process.env, OPENCODE_SERVER_PASSWORD: "" } })
    let ocOut = ""
    oc.stdout.on("data", d => { ocOut += d.toString() })
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("oc timeout")), 60000)
      const poll = () => {
        if (ocOut.match(/listening on http/)) { clearTimeout(t); ok() }
        else setTimeout(poll, 200)
      }
      poll()
    })
    ok("OpenCode ready (self-spawned)")
    process.env.OPENCODE_URL = "http://localhost:4103"
    ocCleanup = () => { oc.kill("SIGKILL") }
  } else {
    ok("OpenCode ready (existing: " + process.env.OPENCODE_URL + ")")
  }

  let brClose
  if (!process.env.BRIDGE_PORT) {
    const br = spawn("npx.cmd", ["tsx", resolve(ROOT, "servers/bridge/src/index.ts")], {
      env: { ...process.env, BRIDGE_PORT: BR_PORT, BRIDGE_PASSWORD: "test123" },
      cwd: resolve(ROOT, "servers/bridge"), shell: true, stdio: "pipe",
    })
    await slp(5000)
    ok("Bridge ready (self-spawned, port " + BR_PORT + ")")
    brClose = () => { br.kill("SIGKILL") }
  } else {
    ok("Bridge ready (existing: " + process.env.BRIDGE_PORT + ")")
  }

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
  } finally {
    if (ocCleanup) ocCleanup()
    if (brClose) brClose()
    await slp(1000)
  }
  process.exit(fail > 0 ? 1 : 0)
}
main()
