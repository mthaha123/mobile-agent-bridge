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

const OC_PORT = 4108, BR_PORT = 20008, DIR = process.env.OPENCODE_DIR || ROOT
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

async function main() {
  console.log("=== E2E SSE event type coverage ===\n"); killPort(OC_PORT); killPort(BR_PORT)

  const oc = spawn("opencode.cmd",["serve","--port",""+OC_PORT,"--print-logs"],{cwd:DIR,shell:true,env:{...process.env,OPENCODE_SERVER_PASSWORD:""}})
  let ocOut = ""; oc.stdout.on("data",d=>{ocOut+=d.toString()})
  await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("oc timeout")),60000);const p=()=>{if(ocOut.match(/listening on http/)){clearTimeout(t);ok()}else setTimeout(p,200)};p()}); ok("OpenCode ready")

  const br = spawn("npx.cmd",["tsx",resolve(ROOT,"servers/bridge/src/index.ts")],{env:{...process.env,BRIDGE_PORT:""+BR_PORT,BRIDGE_PASSWORD:"test123",OPENCODE_URL:"http://localhost:"+OC_PORT},cwd:resolve(ROOT,"servers/bridge"),shell:true,stdio:"pipe"})
  await waitPort(BR_PORT); ok("Bridge ready")

  try {
    const ws = new WebSocket("ws://localhost:"+BR_PORT+"/ws?token=x")
    await new Promise((ok,no)=>{ws.on("open",ok);ws.on("error",no);setTimeout(()=>no(new Error("ws timeout")),10000)}); ok("WS connected")

    let rid = 0
    function call(m,p,t){p=p||{};t=t||10000;return new Promise((ok,no)=>{const id=""+(++rid);const timer=setTimeout(()=>no(new Error("timeout:"+m)),t);const h=d=>{const f=JSON.parse(d.toString());if(f.id===id){clearTimeout(timer);ws.off("message",h);f.ok?ok(f.payload):no(new Error(f.error))}};ws.on("message",h);ws.send(JSON.stringify({type:"req",id,method:m,params:p}))})}

    await call("auth.login",{password:"test123"}); ok("auth.login")
    await call("project.switch",{directory:DIR}); ok("project.switch")
    const s = await call("session.create",{},60000)
    const sid = s&&(s.id||s.sessionId||s.sessionID)||""; ok("session: "+sid.slice(0,16))

    // collect events for up to 30s after message.send
    const seen = new Set()
    const events = []
    const collector = d => {
      try {
        const f = JSON.parse(d.toString())
        if (f.type === "notify" || (f.type === "event" && f.method)) {
          const m = f.method || "?"
          if (!seen.has(m)) { seen.add(m); events.push(m) }
        }
      } catch(e) {}
    }
    ws.on("message", collector)

    await call("message.send",{sessionId:sid,message:"hello"},30000)
    ok("message.send ok")

    // wait briefly for more events
    await slp(8000)
    ws.off("message", collector)

    // report results
    console.log("\n--- event types collected ("+events.length+") ---")
    for (const e of events) console.log("  " + e)

    const known = ["session.created","session.next.prompted","session.next.step.started"]
    for (const k of known) {
      if (events.some(e => e.includes(k))) ok("event type: " + k)
      else no("event type not seen: " + k)
    }

    // require at least one event
    if (events.length > 0) ok("received "+events.length+" event types")
    else no("no events received")

    ws.close()
    console.log("\n=== "+pass+" pass, "+fail+" fail ===")
  } catch(e){
    console.error("\nERROR: "+e.message)
    console.log("\n=== "+pass+" pass, "+fail+" fail ===")
  }

  oc.kill("SIGTERM");br.kill("SIGTERM");await slp(2000)
  oc.kill("SIGKILL");br.kill("SIGKILL")
  process.exit(fail>0?1:0)
}
main()
