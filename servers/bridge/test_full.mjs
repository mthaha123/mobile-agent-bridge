import { spawn } from "child_process"
import WebSocket from "ws"

const BRIDGE_PORT = "19995"

function connectWithToken(token = "") {
  const url = token ? `ws://localhost:${BRIDGE_PORT}?token=${token}` : `ws://localhost:${BRIDGE_PORT}`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })
}

function makeMessenger(ws) {
  let msgId = 0
  const pending = new Map()
  ws.on("message", (raw) => {
    const resp = JSON.parse(raw.toString())
    const p = pending.get(resp.id)
    if (!p) { return }
    clearTimeout(p.timer)
    pending.delete(resp.id)
    p.resolve(resp)
  })
  return function send(method, params = {}) {
    const id = String(++msgId)
    ws.send(JSON.stringify({ type: "req", id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TIMEOUT: ${method}`)), 20000)
      pending.set(id, { resolve, timer, method })
    })
  }
}

async function main() {
  console.log("=== Starting bridge server ===")
  const bridge = spawn("cmd.exe", ["/c", "tsx.cmd", "src/index.ts"], {
    cwd: "D:\\code\\mobile-agent-bridge\\servers\\bridge",
    env: { ...process.env, BRIDGE_PORT, BRIDGE_PASSWORD: "test123", PATH: process.env.PATH + ";D:\\code\\mobile-agent-bridge\\servers\\bridge\\node_modules\\.bin" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  bridge.stdout.on("data", (d) => process.stdout.write("[BRIDGE] " + d))
  bridge.stderr.on("data", (d) => process.stderr.write("[BRIDGE-ERR] " + d))

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Bridge start timeout")), 15000)
    bridge.stdout.on("data", (d) => {
      if (d.toString().includes("服务器启动于端口")) { clearTimeout(timeout); setTimeout(resolve, 500) }
    })
  })

  console.log("=== Step 1: Get token via unauthenticated connection ===")
  let ws = await connectWithToken()
  let send = makeMessenger(ws)
  let r = await send("auth.login", { password: "test123" })
  if (!r.ok) throw new Error(`Login failed: ${r.error}`)
  const token = r.payload.token
  console.log("  token obtained:", token.slice(0, 20) + "...")
  ws.close()
  await new Promise(r => setTimeout(r, 200))

  console.log("=== Step 2: Reconnect with token ===")
  ws = await connectWithToken(token)
  send = makeMessenger(ws)

  console.log("=== Step 3: project.switch ===")
  r = await send("project.switch", { directory: "D:\\code\\mobile-agent-bridge\\servers\\bridge" })
  if (!r.ok) throw new Error(`Switch failed: ${r.error}`)
  console.log("  project:", r.payload?.directory)

  console.log("=== Step 4: session.create ===")
  console.time("  session.create")
  r = await send("session.create", { title: "test" })
  console.timeEnd("  session.create")
  if (!r.ok) throw new Error(`Session create failed: ${r.error}`)
  console.log("  session id:", r.payload?.id)

  console.log("=== ALL TESTS PASSED ===")
  ws.close()
  bridge.kill()
  setTimeout(() => process.exit(0), 1000)
}

main()
