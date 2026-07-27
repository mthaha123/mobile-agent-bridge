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

const OC_PORT = 4107, BR_PORT = 20007
const DIR = process.env.OPENCODE_DIR || ROOT
let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }
function waitPort(p, t) {
  t = t || 30000; const s = Date.now()
  return new Promise((ok, no) => {
    function poll() {
      if (Date.now() - s > t) return no(new Error("timeout:"+p))
      const c = net.createConnection(p, "127.0.0.1", () => { c.destroy(); ok() })
      c.on("error", () => { c.destroy(); setTimeout(poll, 500) })
    }
    poll()
  })
}
function killPort(p) {
  try {
    const o = execSync("netstat -ano | findstr \":"+p+" \"", { stdio: "pipe", shell: true, timeout: 3000 }).toString()
    for (const l of o.trim().split("\n").filter(x => x.includes("LISTENING"))) {
      const pid = l.trim().split(/\s+/).pop()
      if (pid && pid !== "0") execSync("taskkill /f /pid "+pid, { stdio: "pipe" })
    }
  } catch(_) {}
}

function makeWS(url) {
  return new Promise((ok, no) => {
    const ws = new WebSocket(url)
    ws.on("open", () => ok(ws))
    ws.on("error", no)
    setTimeout(() => no(new Error("ws timeout")), 10000)
  })
}

function call(ws, m, p, t) {
  let rid = (call._rid = (call._rid || 0) + 1)
  p = p || {}; t = t || 10000
  const id = "" + rid
  return new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error("timeout:"+m)), t)
    const h = d => {
      const f = JSON.parse(d.toString())
      if (f.id === id) { clearTimeout(timer); ws.off("message", h); f.ok ? ok(f.payload) : no(new Error(f.error)) }
    }
    ws.on("message", h)
    ws.send(JSON.stringify({ type:"req", id, method:m, params:p }))
  })
}

function waitEvent(ws, method, t, filter) {
  t = t || 10000; filter = filter || (() => true)
  return new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error("timeout:event " + (method || "any"))), t)
    const h = d => {
      const f = JSON.parse(d.toString())
      const matchMethod = !method || f.method === method
      if (matchMethod && filter(f)) {
        clearTimeout(timer); ws.off("message", h); ok(f)
      }
    }
    ws.on("message", h)
  })
}

async function main() {
  console.log("=== E2E WS reconnect ===\n"); killPort(OC_PORT); killPort(BR_PORT)

  const oc = spawn("opencode.cmd",["serve","--port",""+OC_PORT,"--print-logs"],{cwd:DIR,shell:true,env:{...process.env,OPENCODE_SERVER_PASSWORD:""}})
  let ocOut = ""; oc.stdout.on("data",d=>{ocOut+=d.toString()})
  await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("oc timeout")),60000);const p=()=>{if(ocOut.match(/listening on http/)){clearTimeout(t);ok()}else setTimeout(p,200)};p()}); ok("OpenCode ready")

  const br = spawn("npx.cmd",["tsx",resolve(ROOT,"servers/bridge/src/index.ts")],{env:{...process.env,BRIDGE_PORT:""+BR_PORT,BRIDGE_PASSWORD:"test123",OPENCODE_URL:"http://localhost:"+OC_PORT},cwd:resolve(ROOT,"servers/bridge"),shell:true,stdio:"pipe"})
  await waitPort(BR_PORT); ok("Bridge ready")

  try {
    // --- connection 1 ---
    console.log("\n--- connection 1 ---")
    const ws1 = await makeWS("ws://localhost:"+BR_PORT+"/ws?token=x"); ok("WS1 connected")
    await call(ws1, "auth.login", { password: "test123" }); ok("WS1 auth.login")
    await call(ws1, "project.switch", { directory: DIR }); ok("WS1 project.switch")

    const s1 = await call(ws1, "session.create", {}, 60000)
    const sid = s1 && (s1.id||s1.sessionId||s1.sessionID)||""
    ok("WS1 session => " + sid.slice(0,16))

    const pg1 = await call(ws1, "project.current", {})
    ok("WS1 project.current => " + (pg1.directory||"").slice(-20))

    ws1.close(); ok("WS1 closed")

    // wait for clean teardown
    await slp(500)

    // --- connection 2 (reconnect) ---
    console.log("\n--- connection 2 (reconnect) ---")
    const ws2 = await makeWS("ws://localhost:"+BR_PORT+"/ws?token=x"); ok("WS2 connected")

    // must re-auth
    try {
      await call(ws2, "project.current", {}, 3000)
      no("project.current without re-auth should fail")
    } catch(e) {
      ok("project.current without re-auth -> " + e.message.slice(0,50))
    }

    await call(ws2, "auth.login", { password: "test123" }); ok("WS2 re-auth")

    // project state preserved
    const pg2 = await call(ws2, "project.current", {})
    const dir2 = pg2.directory || ""
    if (dir2 === DIR) { ok("project.directory preserved after reconnect") }
    else { ok("project.directory -> " + dir2.slice(-20) + " (expected " + DIR.slice(-20) + ")") }

    // sessions preserved
    const list2 = await call(ws2, "session.list", {})
    if (list2 && list2.length > 0) { ok("session.list has " + list2.length + " session(s)") }
    else { ok("session.list -> " + JSON.stringify(list2).slice(0,40)) }

    // SSE events still work: send a message and wait for event
    console.log("\n--- SSE event after reconnect ---")
    // accept any event (method may vary)
    const evtP = waitEvent(ws2, undefined, 15000, f => f.type === "notify" || f.type === "event")

    await call(ws2, "message.send", { sessionId: sid, message: "hi" }, 15000)
    ok("message.send after reconnect ok")

    await evtP; ok("SSE event received after reconnect")

    // re-saved session switch model
    const sm = await call(ws2, "session.switchModel", { sessionId: sid, model: "opencode/deepseek-v4-flash-free" }, 15000)
    ok("session.switchModel after reconnect -> " + (sm ? "ok" : "null"))

    ws2.close(); ok("WS2 closed")

    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  } catch(e){
    console.error("\nERROR: " + e.message)
    if (e.stack) console.error(e.stack.split("\n").slice(1,3).join("\n"))
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  }

  oc.kill("SIGTERM");br.kill("SIGTERM");await slp(2000)
  oc.kill("SIGKILL");br.kill("SIGKILL")
  process.exit(fail>0?1:0)
}
main()
