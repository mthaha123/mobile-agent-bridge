import WebSocket from "ws"

const WS_URL = "ws://localhost:19995"
let msgId = 0
const pending = new Map()

function send(ws, method, params = {}) {
  const id = String(++msgId)
  const msg = JSON.stringify({ type: "req", id, method, params })
  console.log(`[SEND] ${method}`)
  ws.send(msg)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT: ${method}`)), 15000)
    pending.set(id, { resolve, timer, method })
  })
}

async function main() {
  const ws = new WebSocket(WS_URL)
  await new Promise((r) => ws.once("open", r))
  console.log("=== Connected ===")

  ws.on("message", (raw) => {
    const resp = JSON.parse(raw.toString())
    const p = pending.get(resp.id)
    if (!p) { console.log("[UNEXPECTED]", raw.toString().slice(0, 100)); return }
    clearTimeout(p.timer)
    pending.delete(resp.id)
    console.log(`[RECV] ${p.method}`, resp.ok ? "OK" : "FAIL", resp.error || "")
    p.resolve(resp)
  })

  // 1. auth.login
  let r = await send(ws, "auth.login", { password: "test123" })
  if (!r.ok) { console.log("LOGIN FAILED", r.error); ws.close(); return }
  console.log("  token:", r.payload?.token?.slice(0, 20) + "...")

  // 2. project.switch
  r = await send(ws, "project.switch", { directory: "D:\\code\\mobile-agent-bridge\\servers\\bridge" })
  if (!r.ok) { console.log("SETUP FAILED", r.error); ws.close(); return }
  console.log("  project:", r.payload?.directory)

  // 3. session.create
  console.time("  session.create")
  r = await send(ws, "session.create", { title: "test" })
  console.timeEnd("  session.create")
  if (!r.ok) { console.log("SESSION CREATE FAILED:", r.error) }
  else { console.log("  session id:", r.payload?.id) }

  ws.close()
  console.log("=== Done ===")
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1) })
