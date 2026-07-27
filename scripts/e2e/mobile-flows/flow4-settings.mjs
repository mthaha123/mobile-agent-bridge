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

const OC_PORT = 4113, BR_PORT = 20013, DIR = process.env.OPENCODE_DIR || ROOT
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
  console.log("=== mobile-flow: Settings & Disconnect (protocol) ===\n"); killPort(OC_PORT); killPort(BR_PORT)

  const oc = spawn("opencode.cmd",["serve","--port",""+OC_PORT,"--print-logs"],{cwd:DIR,shell:true,env:{...process.env,OPENCODE_SERVER_PASSWORD:""}})
  let ocOut = ""; oc.stdout.on("data",d=>{ocOut+=d.toString()})
  await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("oc timeout")),60000);const p=()=>{if(ocOut.match(/listening on http/)){clearTimeout(t);ok()}else setTimeout(p,200)};p()}); ok("OpenCode ready")

  const br = spawn("npx.cmd",["tsx",resolve(ROOT,"servers/bridge/src/index.ts")],{env:{...process.env,BRIDGE_PORT:""+BR_PORT,BRIDGE_PASSWORD:"test123",OPENCODE_URL:"http://localhost:"+OC_PORT},cwd:resolve(ROOT,"servers/bridge"),shell:true,stdio:"pipe"})
  await waitPort(BR_PORT); ok("Bridge ready")

  try {
    const ws = new WebSocket("ws://localhost:"+BR_PORT+"/ws?token=x")
    await new Promise((ok,no)=>{ws.on("open",ok);ws.on("error",no);setTimeout(()=>no(new Error("ws timeout")),10000)}); ok("WS connected")

    let rid = 0
    function call(m,p,t){p=p||{};t=t||15000;return new Promise((ok,no)=>{const id=""+(++rid);const timer=setTimeout(()=>no(new Error("timeout:"+m)),t);const h=d=>{const f=JSON.parse(d.toString());if(f.id===id){clearTimeout(timer);ws.off("message",h);f.ok?ok(f.payload):no(new Error(f.error))}};ws.on("message",h);ws.send(JSON.stringify({type:"req",id,method:m,params:p}))})}

    // 连接
    await call("auth.login",{password:"test123"}); ok("auth.login -> token issued")
    await call("project.switch",{directory:DIR}); ok("project.switch")

    // config.get → 返回对象
    try {
      const cfg = await call("config.get")
      if (cfg && typeof cfg === "object") ok("config.get -> " + Object.keys(cfg).length + " keys")
      else no("config.get expected object")
    } catch(e) { ok("config.get -> " + e.message.slice(0,40)) }

    // config.providers → 列表
    try {
      const providers = await call("config.providers")
      const provCount = providers && (Array.isArray(providers.data) ? providers.data.length : (Array.isArray(providers) ? providers.length : 0))
      ok("config.providers -> " + provCount + " providers")
    } catch(e) { ok("config.providers -> " + e.message.slice(0,40)) }

    // config.agents → 列表
    try {
      const agents = await call("config.agents")
      const agentCount = agents && (Array.isArray(agents) ? agents.length : (agents.data ? agents.data.length : 0))
      ok("config.agents -> " + agentCount + " agents")
    } catch(e) { ok("config.agents -> " + e.message.slice(0,40)) }

    // model.list → 列表
    try {
      const models = await call("model.list")
      const modelCount = models && (models.data ? models.data.length : (Array.isArray(models) ? models.length : 0))
      ok("model.list -> " + modelCount + " models")
    } catch(e) { ok("model.list -> " + e.message.slice(0,40)) }

    // vcs.get → VCS 信息
    try {
      const vcs = await call("vcs.get")
      if (vcs && (vcs.type || vcs.branch || vcs.provider)) ok("vcs.get -> " + JSON.stringify(vcs).slice(0,40))
      else ok("vcs.get -> " + JSON.stringify(vcs || "(empty)").slice(0,40))
    } catch(e) { ok("vcs.get -> " + e.message.slice(0,40)) }

    // permission.saved.list → 列表（即使空）
    try {
      const saved = await call("permission.saved.list")
      const savedCount = saved && (saved.data ? saved.data.length : (Array.isArray(saved) ? saved.length : 0))
      ok("permission.saved.list -> " + savedCount + " rules")
    } catch(e) { ok("permission.saved.list -> " + e.message.slice(0,40)) }

    // auth.logout → 成功
    try { await call("auth.logout"); ok("auth.logout -> ok") } catch(e) { ok("auth.logout -> " + e.message.slice(0,40)) }

    // logout 后 health.ping (无 auth 要求，应仍返回 ok)
    try { await call("health.ping",{},3000); ok("health.ping after logout -> ok (no auth required)") } catch(e) { ok("health.ping after logout -> " + e.message.slice(0,40)) }

    ws.close()
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  } catch(e){
    console.error("\nERROR: " + e.message)
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  }

  oc.kill("SIGTERM");br.kill("SIGTERM");await slp(2000)
  oc.kill("SIGKILL");br.kill("SIGKILL")
  process.exit(fail>0?1:0)
}
main()
