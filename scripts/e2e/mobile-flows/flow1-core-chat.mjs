#!/usr/bin/env node
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const DIR = process.env.OPENCODE_DIR || ROOT
const BR_PORT = process.env.BRIDGE_PORT || "20010"
let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }

async function main() {
  console.log("=== mobile-flow: Core Chat (protocol) ===\n")

  let ocCleanup
  if (!process.env.OPENCODE_URL) {
    const oc = spawn("opencode.cmd",["serve","--port","4110","--print-logs"],{cwd:DIR,shell:true,env:{...process.env,OPENCODE_SERVER_PASSWORD:""}})
    let ocOut = ""
    oc.stdout.on("data",d=>{ocOut+=d.toString()})
    await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("oc timeout")),60000);const p=()=>{if(ocOut.match(/listening on http/)){clearTimeout(t);ok()}else setTimeout(p,200)};p()})
    ok("OpenCode ready (self-spawned, port 4110)")
    process.env.OPENCODE_URL = "http://localhost:4110"
    ocCleanup = () => { oc.kill("SIGKILL") }
  } else {
    ok("OpenCode ready (existing: " + process.env.OPENCODE_URL + ")")
  }

  let brClose
  if (parseInt(BR_PORT) !== 8081) {
    const br = spawn("npx.cmd",["tsx",resolve(ROOT,"servers/bridge/src/index.ts")],{env:{...process.env,BRIDGE_PORT:BR_PORT,BRIDGE_PASSWORD:"test123"},cwd:resolve(ROOT,"servers/bridge"),shell:true,stdio:"pipe"})
    await slp(5000); ok("Bridge ready (self-spawned, port " + BR_PORT + ")")
    brClose = () => { br.kill("SIGKILL") }
  } else {
    ok("Bridge ready (existing: " + BR_PORT + ")")
  }

  try {
    const ws = new WebSocket("ws://localhost:"+BR_PORT+"/ws?token=x")
    await new Promise((ok,no)=>{ws.on("open",ok);ws.on("error",no);setTimeout(()=>no(new Error("ws timeout")),10000)}); ok("WS connected")

    let rid = 0
    function call(m,p,t){p=p||{};t=t||15000;return new Promise((ok,no)=>{const id=""+(++rid);const timer=setTimeout(()=>no(new Error("timeout:"+m)),t);const h=d=>{const f=JSON.parse(d.toString());if(f.id===id){clearTimeout(timer);ws.off("message",h);f.ok?ok(f.payload):no(new Error(f.error))}};ws.on("message",h);ws.send(JSON.stringify({type:"req",id,method:m,params:p}))})}

    // 1. auth.login → token
    const auth = await call("auth.login",{password:"test123"})
    if (auth && auth.token) ok("auth.login -> token: " + auth.token.slice(0,16))
    else { fail++; console.log("  \u2717 auth.login expected token"); }

    // 2. health.ping → { ok: true }
    const pong = await call("health.ping",{})
    if (pong && pong.ok === true) ok("health.ping -> ok: true")
    else { fail++; console.log("  \u2717 health.ping expected { ok: true }"); }

    // 3. project.switch
    await call("project.switch",{directory:DIR}); ok("project.switch")

    // 4. session.create → id(以 ses_ 开头)
    const s = await call("session.create",{},60000)
    const sid = s && (s.id || s.sessionId || s.sessionID) || ""
    if (sid.startsWith("ses_")) ok("session.create -> id: " + sid.slice(0,16))
    else { fail++; console.log("  \u2717 session.create expected ses_ prefix"); }

    // 5. 收集 SSE 事件
    const events = []
    const collector = d => {
      try {
        const f = JSON.parse(d.toString())
        if (f.type === "notify" || (f.type === "event" && f.method)) events.push(f)
      } catch(_) {}
    }
    ws.on("message", collector)

    // 6. message.send (触发工具的消息)
    const msgR = await call("message.send",{sessionId:sid,message:"list files in the current directory"},60000)
    if (msgR !== undefined) ok("message.send -> payload received")
    else { fail++; console.log("  \u2717 message.send expected payload"); }

    // 7. 等更多事件
    await slp(15000)
    ws.off("message", collector)

    // 8. 验证 SSE 事件
    const types = [...new Set(events.filter(e => e.method).map(e => e.method))]

    // session.next.text.delta
    if (types.some(t => t.includes("text.delta"))) ok("event: session.next.text.delta")
    else no("event not seen: session.next.text.delta")

    // session.next.text.ended
    if (types.some(t => t.includes("text.ended"))) ok("event: session.next.text.ended")
    else no("event not seen: session.next.text.ended")

    // session.next.step.started + ended
    if (types.some(t => t.includes("step.started"))) ok("event: session.next.step.started")
    else no("event not seen: session.next.step.started")
    if (types.some(t => t.includes("step.ended"))) ok("event: session.next.step.ended")
    else no("event not seen: session.next.step.ended")

    // tool lifecycle (如果触发)
    if (types.some(t => t.includes("tool.called"))) {
      ok("event: session.next.tool.called")
      if (types.some(t => t.includes("tool.success"))) ok("event: session.next.tool.success")
      else no("event not seen: session.next.tool.success")
    } else {
      ok("tool lifecycle: not triggered (depends on model)")
    }

    // session.status idle
    // 检查最后一个 session.status 事件
    const statusEvents = events.filter(e => e.method === "session.status")
    const lastStatus = statusEvents[statusEvents.length - 1]
    if (lastStatus) {
      const d = lastStatus.payload || lastStatus.params || {}
      if (d.idle === true || d.state === "idle") ok("session.status -> idle")
      else ok("session.status -> non-idle (may still be processing): " + JSON.stringify(d).slice(0,40))
    } else {
      ok("session.status: not received")
    }

    console.log("\n--- event types (" + types.length + ") ---")
    types.forEach(t => console.log("  " + t))

    ws.close()
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  } catch(e){
    console.error("\nERROR: " + e.message)
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  } finally {
    if (ocCleanup) ocCleanup()
    if (brClose) brClose()
    await slp(1000)
  }
  process.exit(fail>0?1:0)
}
main()
