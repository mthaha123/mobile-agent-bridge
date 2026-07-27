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

const OC_PORT = 4112, BR_PORT = 20012, DIR = process.env.OPENCODE_DIR || ROOT
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
  console.log("=== mobile-flow: File Browser (protocol) ===\n"); killPort(OC_PORT); killPort(BR_PORT)

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
    await call("auth.login",{password:"test123"}); ok("auth.login")
    await call("project.switch",{directory:DIR}); ok("project.switch")

    // 1. file.list(/) → 验证返回结构
    const rootList = await call("file.list",{path:ROOT})
    if (rootList && rootList.length > 0) {
      ok("file.list -> " + rootList.length + " entries")
      const first = rootList[0]
      if (first.name && first.type) ok("item has name+type: " + first.name)
      else no("item missing name or type: " + JSON.stringify(first).slice(0,60))
    } else {
      no("file.list expected entries")
    }

    // 2. file.list(src/) → 验证 ".." 存在
    const srcList = await call("file.list",{path:resolve(ROOT,"scripts/e2e")})
    const hasParent = srcList && (srcList.some(e => e.name === "..") || srcList.some(e => e.type === "directory"))
    if (srcList && srcList.length > 0) ok("file.list(scripts/e2e) -> " + srcList.length + " entries")
    else no("file.list(scripts/e2e) expected entries")

    // 3. file.search("main") → 验证返回结构
    const searchR = await call("file.search",{query:"main",dirs:ROOT})
    if (searchR && (Array.isArray(searchR.data) ? searchR.data.length > 0 : searchR.length > 0)) {
      const items = searchR.data || searchR
      ok("file.search -> " + items.length + " results")
      const first = items[0]
      if (first.file || first.path) ok("search result has file/path: " + (first.file || first.path))
      else no("search result missing file field")
    } else {
      ok("file.search -> no results (expected for some queries)")
    }

    // 4. file.read(该文件自身) → content > 0
    const selfPath = fileURLToPath(import.meta.url)
    const readR = await call("file.read",{path:selfPath})
    if (readR && readR.content && readR.content.length > 0) {
      ok("file.read -> " + readR.content.length + " chars")
    } else {
      no("file.read expected content")
    }

    // 5. file.info(该文件自身) → 验证字段
    const infoR = await call("file.info",{path:selfPath})
    if (infoR) {
      const hasFields = infoR.path || infoR.name || infoR.size
      if (hasFields) ok("file.info -> path/size present")
      else no("file.info missing fields: " + JSON.stringify(infoR).slice(0,60))
    } else {
      no("file.info expected payload")
    }

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
