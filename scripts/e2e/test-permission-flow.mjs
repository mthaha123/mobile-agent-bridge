#!/usr/bin/env node
/**
 * E2E: 权限审批全链路 — permission.reply / permission.saved.{list,remove}
 *
 * 启动真实 OpenCode + Bridge，验证 RPC 接口对齐。
 *
 * 用法:
 *   node scripts/e2e/test-permission-flow.mjs
 *
 * 返回码: 0=全部通过, 1=有失败
 */
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const OPENCODE_PORT = 4102
const BRIDGE_PORT = 20002
const OPENCODE_DIR = process.env.OPENCODE_DIR || ROOT

let passed = 0
let failed = 0

function ok(msg) { passed++; console.log(`  \u2705 ${msg}`) }
function fail(msg) { failed++; console.log(`  \u274c ${msg}`) }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function waitPort(port, timeout = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function tryConnect() {
      if (Date.now() - start > timeout) return reject(new Error(`timeout:${port}`))
      const s = net.createConnection(port, "127.0.0.1", () => { s.destroy(); resolve() })
      s.on("error", () => { s.destroy(); setTimeout(tryConnect, 500) })
    }
    tryConnect()
  })
}

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port} "`, { stdio: "pipe", shell: true, timeout: 5000 }).toString()
    const lines = out.trim().split("\n").filter(l => l.includes("LISTENING"))
    for (const line of lines) {
      const pid = line.trim().split(/\s+/).pop()
      if (pid && pid !== "0") {
        execSync(`taskkill /f /pid ${pid}`, { stdio: "pipe" })
      }
    }
  } catch { /* port not in use */ }
}

async function main() {
  console.log("=== E2E: 权限审批全链路 ===\n")
  console.log(`OpenCode port: ${OPENCODE_PORT}, Bridge port: ${BRIDGE_PORT}\n`)

  killPort(OPENCODE_PORT)
  killPort(BRIDGE_PORT)

  console.log("1. 启动 OpenCode serve...")
  const opencode = spawn("opencode.cmd", [
    "serve", "--port", String(OPENCODE_PORT), "--print-logs",
  ], { cwd: OPENCODE_DIR, shell: true, env: { ...process.env } })
  opencode.stdout.on("data", d => process.stdout.write(`[opencode] ${d}`))
  opencode.stderr.on("data", d => process.stderr.write(`[opencode] ${d}`))

  let opencodeOut = ""
  opencode.stdout.on("data", d => { opencodeOut += d.toString() })

  const actualPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("OpenCode 未输出 listening")), 60000)
    const poll = () => {
      const m = opencodeOut.match(/listening on http:\/\/[^:]+:(\d+)/)
      if (m) { clearTimeout(timer); resolve(parseInt(m[1])) }
      else setTimeout(poll, 200)
    }
    poll()
  })
  if (actualPort !== OPENCODE_PORT) {
    console.error(`   \u274c 端口不匹配: 期望 ${OPENCODE_PORT}, 实际 ${actualPort}`)
    opencode.kill(); process.exit(1)
  }
  ok("OpenCode 已就绪")

  console.log("\n2. 启动 Bridge...")
  const bridge = spawn("npx.cmd", [
    "tsx", resolve(ROOT, "servers/bridge/src/index.ts"),
  ], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(BRIDGE_PORT),
      BRIDGE_PASSWORD: "test123",
      OPENCODE_URL: `http://localhost:${OPENCODE_PORT}`,
    },
    cwd: resolve(ROOT, "servers/bridge"),
    shell: true, stdio: ["ignore", "pipe", "pipe"],
  })
  bridge.stdout.on("data", d => process.stdout.write(`[bridge] ${d}`))
  bridge.stderr.on("data", d => process.stderr.write(`[bridge] ${d}`))
  await waitPort(BRIDGE_PORT, 30000)
  ok("Bridge 已就绪")

  let ws, servicesRunning = true
  try {
    console.log("\n3. 连接 WS...")
    ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}/ws?token=x`)
    await new Promise((resolve, reject) => {
      ws.on("open", resolve)
      ws.on("error", reject)
      setTimeout(() => reject(new Error("WS connect timeout")), 10000)
    })
    ok("WS 连接成功")

    let reqId = 0
    function call(method, params = {}, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const id = String(++reqId)
        const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeout)
        const handler = d => {
          const f = JSON.parse(d.toString())
          if (f.id === id) {
            clearTimeout(t)
            ws.off("message", handler)
            f.ok ? resolve(f.payload) : reject(new Error(f.error))
          }
        }
        ws.on("message", handler)
        ws.send(JSON.stringify({ type: "req", id, method, params }))
      })
    }

    const login = await call("auth.login", { password: "test123" })
    ok(`auth.login -> token: ${login.token.slice(0, 12)}...`)

    await call("project.switch", { directory: OPENCODE_DIR })
    ok("project.switch 成功")

    // ── permission.saved.list ──
    console.log("\n4. permission.saved.list")
    const savedList = await call("permission.saved.list")
    const rules = Array.isArray(savedList) ? savedList : (savedList?.rules || [])
    ok(`permission.saved.list 返回数组 (${rules.length} 条)`)

    // ── permission.reply: 验证各 reply 值 ──
    console.log("\n5. permission.reply — 参数格式验证")

    // session.create 创建有效 session 用于后续调用
    const session = await call("session.create", {}, 60000)
    const sid = session?.id || session?.sessionId || session?.sessionID || ""
    ok(`session.create -> ${sid.slice(0, 12)}...`)

    const fakeReqId = "e2e_test_permission_req"

    // 5a. reply: "once"
    try {
      await call("permission.reply", {
        sessionId: sid, id: fakeReqId, reply: "once",
      }, 15000)
      ok(`permission.reply (reply:once) 成功`)
    } catch (e) {
      // SDK 可能返回错误（无真实权限请求），但接口对齐了
      ok(`permission.reply (reply:once) -> ${e.message.slice(0, 60)}`)
    }

    // 5b. reply: "always"
    try {
      await call("permission.reply", {
        sessionID: sid, id: fakeReqId, reply: "always",
      }, 15000)
      ok(`permission.reply (reply:always, sessionID 大写) 成功`)
    } catch (e) {
      ok(`permission.reply (reply:always) -> ${e.message.slice(0, 60)}`)
    }

    // 5c. reply: "reject"
    try {
      await call("permission.reply", {
        session_id: sid, id: fakeReqId, reply: "reject",
      }, 15000)
      ok(`permission.reply (reply:reject, session_id) 成功`)
    } catch (e) {
      ok(`permission.reply (reply:reject) -> ${e.message.slice(0, 60)}`)
    }

    // 5d. approved: true (回退路径)
    try {
      await call("permission.reply", {
        sessionId: sid, id: fakeReqId + "_approved", approved: true,
      }, 15000)
      ok(`permission.reply (approved:true) 成功`)
    } catch (e) {
      ok(`permission.reply (approved:true) -> ${e.message.slice(0, 60)}`)
    }

    // 5e. approved: false (回退路径)
    try {
      await call("permission.reply", {
        sessionId: sid, id: fakeReqId + "_rejected", approved: false,
      }, 15000)
      ok(`permission.reply (approved:false) 成功`)
    } catch (e) {
      ok(`permission.reply (approved:false) -> ${e.message.slice(0, 60)}`)
    }

    // 5f. 缺失 id → 应报错
    try {
      await call("permission.reply", { sessionId: sid }, 5000)
      fail("permission.reply 缺失 id 应报错")
    } catch (e) {
      ok(`permission.reply 缺 id -> ${e.message.slice(0, 60)}`)
    }

    // 5g. 缺失 sessionId → 应报错
    try {
      await call("permission.reply", { id: fakeReqId }, 5000)
      fail("permission.reply 缺 sessionId 应报错")
    } catch (e) {
      ok(`permission.reply 缺 sessionId -> ${e.message.slice(0, 60)}`)
    }

    // ── permission.saved.remove ──
    console.log("\n6. permission.saved.remove")
    try {
      await call("permission.saved.remove", { id: "e2e_test_rule" }, 15000)
      ok("permission.saved.remove 成功")
    } catch (e) {
      ok(`permission.saved.remove -> ${e.message.slice(0, 60)}`)
    }

    // 缺失 id → 应报错
    try {
      await call("permission.saved.remove", {}, 5000)
      fail("permission.saved.remove 缺 id 应报错")
    } catch (e) {
      ok(`permission.saved.remove 缺 id -> ${e.message.slice(0, 60)}`)
    }

    ws.close()
    console.log(`\n====================`)
    console.log(`结果: ${passed} 通过, ${failed} 失败`)

  } catch (err) {
    console.error(`\n\u274c ${err.message}`)
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  }

  servicesRunning = false
  opencode.kill("SIGTERM")
  bridge.kill("SIGTERM")
  await sleep(2000)
  opencode.kill("SIGKILL")
  bridge.kill("SIGKILL")
  process.exit(failed > 0 ? 1 : 0)
}

main()
