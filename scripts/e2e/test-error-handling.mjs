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

const OC_PORT = 4106, BR_PORT = 20006
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

async function main() {
  console.log("=== E2E error scenarios ===\n"); killPort(OC_PORT); killPort(BR_PORT)

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

    console.log("\n--- auth (no password) ---")
    try{await call("auth.login",{},5000);no("auth.login without password should fail")}catch(e){ok("auth.login no password -> "+e.message.slice(0,50))}

    console.log("\n--- auth (wrong password) ---")
    try{await call("auth.login",{password:"wrong"},5000);no("auth.login wrong password should fail")}catch(e){ok("auth.login wrong password -> "+e.message.slice(0,50))}

    console.log("\n--- unauthorized call ---")
    for(const m of["health.ping","project.switch","session.create"]){
      try{await call(m,{},5000);no(m+" without auth should fail")}catch(e){ok(m+" without auth -> "+e.message.slice(0,50))}
    }

    // login for subsequent tests
    await call("auth.login",{password:"test123"}); ok("auth.login ok")

    console.log("\n--- unknown method ---")
    try{await call("nonexistent.method",{},5000);no("unknown method should fail")}catch(e){ok("unknown method -> "+e.message.slice(0,50))}

    console.log("\n--- project.switch invalid directory ---")
    try{await call("project.switch",{directory:"Z:\\nonexistent"},5000);no("invalid dir should fail")}catch(e){ok("invalid dir -> "+e.message.slice(0,50))}

    console.log("\n--- project.switch missing directory ---")
    try{await call("project.switch",{},5000);no("missing dir should fail")}catch(e){ok("missing dir -> "+e.message.slice(0,50))}

    // switch to real dir for subsequent tests
    await call("project.switch",{directory:DIR}); ok("project.switch ok")
    const s = await call("session.create",{},60000)
    const sid = s && (s.id||s.sessionId||s.sessionID)||""

    console.log("\n--- message.send missing sessionId ---")
    try{await call("message.send",{message:"hi"},5000);no("missing sessionId should fail")}catch(e){ok("missing sessionId -> "+e.message.slice(0,50))}

    console.log("\n--- message.send missing message ---")
    try{await call("message.send",{sessionId:sid},5000);no("missing message should fail")}catch(e){ok("missing message -> "+e.message.slice(0,50))}

    console.log("\n--- session.get missing id ---")
    try{await call("session.get",{},5000);no("missing id should fail")}catch(e){ok("missing id -> "+e.message.slice(0,50))}

    console.log("\n--- permission.reply missing id ---")
    try{await call("permission.reply",{sessionId:sid},5000);no("missing id should fail")}catch(e){ok("missing id -> "+e.message.slice(0,50))}

    console.log("\n--- question.reply missing params ---")
    try{await call("question.reply",{sessionId:sid,answer:"y"},5000);no("missing id should fail")}catch(e){ok("missing id -> "+e.message.slice(0,50))}

    console.log("\n--- permission.saved.remove missing id ---")
    try{await call("permission.saved.remove",{},5000);no("missing id should fail")}catch(e){ok("missing id -> "+e.message.slice(0,50))}

    ws.close()
    console.log("\n=== "+pass+" pass, "+fail+" fail ===")
  } catch(e){console.error("\nERROR: "+e.message);console.log("\n=== "+pass+" pass, "+fail+" fail ===")}

  oc.kill("SIGTERM");br.kill("SIGTERM");await slp(2000)
  oc.kill("SIGKILL");br.kill("SIGKILL")
  process.exit(fail>0?1:0)
}
main()
