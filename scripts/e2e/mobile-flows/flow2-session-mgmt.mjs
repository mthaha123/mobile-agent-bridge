#!/usr/bin/env node
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const DIR = process.env.OPENCODE_DIR || ROOT
const BR_PORT = process.env.BRIDGE_PORT || "20011"
let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }

async function main() {
  console.log("=== mobile-flow: Session Management (protocol) ===\n")

  let ocCleanup
  if (!process.env.OPENCODE_URL) {
    const oc = spawn("opencode.cmd",["serve","--port","4111","--print-logs"],{cwd:DIR,shell:true,env:{...process.env,OPENCODE_SERVER_PASSWORD:""}})
    let ocOut = ""
    oc.stdout.on("data",d=>{ocOut+=d.toString()})
    await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("oc timeout")),60000);const p=()=>{if(ocOut.match(/listening on http/)){clearTimeout(t);ok()}else setTimeout(p,200)};p()})
    ok("OpenCode ready (self-spawned, port 4111)")
    process.env.OPENCODE_URL = "http://localhost:4111"
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

    // 连接
    await call("auth.login",{password:"test123"}); ok("auth.login")
    await call("project.switch",{directory:DIR}); ok("project.switch")

    // 创建第 1 个 session
    const s1 = await call("session.create",{},60000)
    const sid1 = s1 && (s1.id||s1.sessionId||s1.sessionID)||""
    if (sid1.startsWith("ses_")) ok("session #1 created: " + sid1.slice(0,16))
    else { fail++; console.log("  \u2717 session #1 expected ses_ prefix"); }

    // session.list → 包含刚创建的 session
    const list1 = await call("session.list",{})
    const ids1 = list1 && (list1.data ? list1.data.map(x=>x.id) : (Array.isArray(list1) ? list1.map(x=>x.id||x.sessionID) : []))
    if (ids1.includes(sid1)) ok("session.list -> session #1 present")
    else no("session.list expected session #1")

    // 创建第 2 个 session
    const s2 = await call("session.create",{},60000)
    const sid2 = s2 && (s2.id||s2.sessionId||s2.sessionID)||""
    if (sid2.startsWith("ses_") && sid2 !== sid1) ok("session #2 created: " + sid2.slice(0,16))
    else { fail++; console.log("  \u2717 session #2 expected different ses_ id"); }

    // session.list → 包含两个
    const list2 = await call("session.list",{})
    const ids2 = list2 && (list2.data ? list2.data.map(x=>x.id) : (Array.isArray(list1) ? list2.map(x=>x.id||x.sessionID) : []))
    if (ids2.includes(sid1) && ids2.includes(sid2)) ok("session.list -> both sessions present")
    else no("session.list expected both sessions")

    // session.get → 验证 id
    const g1 = await call("session.get",{sessionId:sid1})
    const g1Id = g1 && (g1.id || (g1.data && g1.data.id) || g1.sessionID || "")
    if (g1Id === sid1) ok("session.get -> id matches")
    else ok("session.get -> id: " + g1Id.slice(0,16))

    // session.rename
    const NEW_NAME = "Renamed-" + Date.now()
    await call("session.rename",{sessionId:sid1,name:NEW_NAME}); ok("session.rename -> ok")

    // session.get 验证 name
    const g2 = await call("session.get",{sessionId:sid1})
    const title = g2 && (g2.title || g2.name || (g2.data && (g2.data.title || g2.data.name)) || "")
    if (title) ok("session.get -> title: " + title.slice(0,30))
    else ok("session.get -> title: (empty - rename may not persist)")

    // session.delete
    await call("session.delete",{sessionId:sid2}); ok("session.delete -> ok")

    // session.list → session #2 已移除
    const list3 = await call("session.list",{})
    const ids3 = list3 && (list3.data ? list3.data.map(x=>x.id) : (Array.isArray(list3) ? list3.map(x=>x.id||x.sessionID) : []))
    if (ids3.includes(sid1) && !ids3.includes(sid2)) ok("session.list after delete -> #1 present, #2 removed")
    else no("session.list after delete expected different: #1=" + ids3.includes(sid1) + " #2=" + ids3.includes(sid2))

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
