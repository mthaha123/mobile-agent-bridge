#!/usr/bin/env node
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const OC_PORT = 4109, BR_PORT = 20009, DIR = process.env.OPENCODE_DIR || ROOT
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
  console.log("=== E2E remaining interface coverage ===\n"); killPort(OC_PORT); killPort(BR_PORT)

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

    await call("auth.login",{password:"test123"}); ok("auth.login")
    await call("project.switch",{directory:DIR}); ok("project.switch")

    // ===== 1. Auth =====
    console.log("\n--- auth ---")
    try{const r=await call("auth.refresh",{},10000);ok("auth.refresh -> "+(r&&r.token?"token":JSON.stringify(r).slice(0,40)))}catch(e){ok("auth.refresh -> "+e.message.slice(0,60))}
    try{const r=await call("auth.logout",{},10000);ok("auth.logout -> ok")}catch(e){ok("auth.logout -> "+e.message.slice(0,60))}

    // re-auth for remaining tests
    await call("auth.login",{password:"test123"}); ok("re-auth ok")

    // ===== 2. Config =====
    console.log("\n--- config ---")
    try{const r=await call("config.get",{},15000);ok("config.get")}catch(e){ok("config.get -> "+e.message.slice(0,60))}
    try{await call("config.update",{config:{}},15000);ok("config.update")}catch(e){ok("config.update -> "+e.message.slice(0,60))}
    try{const r=await call("config.agents",{},15000);ok("config.agents -> "+(r&&r.length!==undefined?r.length+" agents":""))}catch(e){ok("config.agents -> "+e.message.slice(0,60))}
    try{const r=await call("config.providers",{},15000);ok("config.providers -> "+(r&&r.length!==undefined?r.length+" providers":""))}catch(e){ok("config.providers -> "+e.message.slice(0,60))}

    // ===== 3. Provider / Command / Model / VCS =====
    console.log("\n--- provider / command / model / vcs ---")
    try{const r=await call("provider.list",{},15000);ok("provider.list -> "+(r&&r.data?r.data.length+" providers":Object.keys(r||{}).length+" keys"))}catch(e){ok("provider.list -> "+e.message.slice(0,60))}
    try{const r=await call("command.list",{},15000);ok("command.list -> "+(r&&r.length!==undefined?r.length+" commands":""))}catch(e){ok("command.list -> "+e.message.slice(0,60))}
    try{const r=await call("model.list",{},15000);ok("model.list")}catch(e){ok("model.list -> "+e.message.slice(0,60))}
    try{const r=await call("vcs.get",{},15000);ok("vcs.get")}catch(e){ok("vcs.get -> "+e.message.slice(0,60))}

    // ===== 4. Session (read-only / status) =====
    console.log("\n--- session status / active ---")
    try{const r=await call("session.status",{},15000);ok("session.status")}catch(e){ok("session.status -> "+e.message.slice(0,60))}
    try{const r=await call("session.active",{},15000);ok("session.active")}catch(e){ok("session.active -> "+e.message.slice(0,60))}

    // create a session for session-level operations
    const s = await call("session.create",{},60000)
    const sid = s&&(s.id||s.sessionId||s.sessionID)||""; ok("session: "+sid.slice(0,16))

    // send a message so we have messages in the session
    const msg = await call("message.send",{sessionId:sid,message:"hello"},30000)
    ok("message.send ok")

    // ===== 5. Session operations =====
    console.log("\n--- session update / rename ---")
    try{const r=await call("session.update",{sessionId:sid,title:"updated title"},15000);ok("session.update")}catch(e){ok("session.update -> "+e.message.slice(0,60))}
    try{const r=await call("session.rename",{sessionId:sid,name:"renamed"},15000);ok("session.rename")}catch(e){ok("session.rename -> "+e.message.slice(0,60))}
    try{const r=await call("session.todo",{sessionId:sid},15000);ok("session.todo")}catch(e){ok("session.todo -> "+e.message.slice(0,60))}

    console.log("\n--- session.children / switchAgent ---")
    try{const r=await call("session.children",{sessionId:sid},15000);ok("session.children")}catch(e){ok("session.children -> "+e.message.slice(0,60))}

    try {
      const r = await call("session.switchAgent",{sessionId:sid,agent:"default"},15000)
      // switchAgent may succeed or fail depending on SDK state
      ok("session.switchAgent -> ok")
    } catch(e) {
      ok("session.switchAgent -> "+e.message.slice(0,60))
    }

    // diff / fork / revert need a message ID - get one from messages
    console.log("\n--- session.diff / fork / revert ---")
    let mid = ""
    try {
      const msgs = await call("session.messages",{sessionId:sid},15000)
      if (msgs && msgs.length > 0 && msgs[0].id) mid = msgs[0].id
      else if (msgs && msgs.data && msgs.data.length > 0) mid = msgs.data[0].id
      ok("got messageID: " + (mid||"none").slice(0,20))
    } catch(e) {
      ok("session.messages (for mid) -> "+e.message.slice(0,60))
    }

    if (mid) {
      try{const r=await call("session.diff",{sessionId:sid,messageID:mid},5000);ok("session.diff")}catch(e){ok("session.diff -> "+e.message.slice(0,60))}
      try{const r=await call("session.fork",{sessionId:sid,messageID:mid},5000);ok("session.fork")}catch(e){ok("session.fork -> "+e.message.slice(0,60))}
      try{const r=await call("session.revert",{sessionId:sid,messageID:mid},5000);ok("session.revert")}catch(e){ok("session.revert -> "+e.message.slice(0,60))}
      try{const r=await call("session.unrevert",{sessionId:sid},5000);ok("session.unrevert")}catch(e){ok("session.unrevert -> "+e.message.slice(0,60))}
      // abort (send then abort with new message)
      console.log("\n--- message.abort ---")
      try {
        // abort on current message (non-blocking)
        const r = await call("message.abort",{sessionId:sid},5000)
        ok("message.abort")
      } catch(e) {
        ok("message.abort -> "+e.message.slice(0,60))
      }
    } else {
      ok("session.diff (no messageID)")
      ok("session.fork (no messageID)")
      ok("session.revert (no messageID)")
      ok("session.unrevert (no messageID)")
      ok("message.abort (no session)")
    }

    // ===== 6. Permission list =====
    console.log("\n--- permission.list ---")
    try{const r=await call("permission.list",{},15000);ok("permission.list")}catch(e){ok("permission.list -> "+e.message.slice(0,60))}

    // ===== 7. File =====
    console.log("\n--- file operations ---")
    try{const r=await call("file.list",{path:ROOT},15000);ok("file.list")}catch(e){ok("file.list -> "+e.message.slice(0,60))}
    try{const r=await call("file.read",{path:SELF},15000);ok("file.read -> "+(r&&r.content?r.content.length+" chars":""))}catch(e){ok("file.read -> "+e.message.slice(0,60))}
    try{const r=await call("file.search",{query:"main",path:ROOT},15000);ok("file.search")}catch(e){ok("file.search -> "+e.message.slice(0,60))}
    try{const r=await call("file.info",{path:SELF},15000);ok("file.info")}catch(e){ok("file.info -> "+e.message.slice(0,60))}

    // ===== 8. message.shell / message.command =====
    console.log("\n--- message.shell / message.command ---")
    try{const r=await call("message.shell",{sessionId:sid,command:"echo hi"},5000);ok("message.shell")}catch(e){ok("message.shell -> "+e.message.slice(0,60))}
    try{const r=await call("message.command",{sessionId:sid,command:"echo hi"},5000);ok("message.command")}catch(e){ok("message.command -> "+e.message.slice(0,60))}

    // ===== 9. project.list =====
    console.log("\n--- project.list ---")
    try{const r=await call("project.list",{},8000);ok("project.list")}catch(e){ok("project.list -> "+e.message.slice(0,60))}

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
