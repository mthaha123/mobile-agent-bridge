import { createRequire } from "module"
const require = createRequire(import.meta.url)
const WebSocket = require("ws")

// 默认连【测试桥 19985】，避免误连生产 8080（本脚本会删除/新增 serve 项目，属破坏性操作）
const BRIDGE_URL = process.env.BRIDGE_URL || "ws://localhost:19985/ws"
if (BRIDGE_URL.includes(":8080")) {
  console.error("[守卫] 禁止对生产 8080 执行破坏性的端口池测试；请指向测试桥 19985")
  process.exit(2)
}
const ws = new WebSocket(BRIDGE_URL)
function send(method, params = {}) {
  return new Promise((r) => {
    const id = "t" + Math.random()
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.id === id) { ws.off("message", h); r(m) } }
    ws.on("message", h)
    ws.send(JSON.stringify({ type: "req", id, method, params }))
  })
}

ws.on("open", async () => {
  await send("auth.login", { password: "test123" })
  const dirs = [
    "D:\\code\\mobile-agent-bridge",
    "D:\\code\\mobile-agent-bridge\\apps",
    "D:\\code\\mobile-agent-bridge\\servers",
    "D:\\code\\mobile-agent-bridge\\packages",
    "D:\\code\\mobile-agent-bridge\\scripts",
  ]
  console.log("=== 端口池测试 ===")
  const ports = []
  for (let i = 0; i < 5; i++) {
    const r = await send("serve.add", { name: "S" + i, directory: dirs[i] })
    if (r.ok) { ports.push(r.payload.port); console.log("add S" + i + ": port=" + r.payload.port) }
    else console.log("add S" + i + ": ERROR " + r.error)
  }
  const poolOk = JSON.stringify(ports) === "[4100,4101,4102,4103,4104]"
  console.log("端口:", ports.join(","), "| PASS:", poolOk)

  const r5 = await send("serve.add", { name: "S5", directory: "D:\\code\\mobile-agent-bridge\\docs" })
  console.log("第6个:", r5.ok ? "BUG 应该失败" : "正确拒绝: " + r5.error)

  const list = await send("serve.list", {})
  const target = list.payload.find((p) => p.port === 4102)
  await send("serve.remove", { id: target.id })
  console.log("删除 port 4102")

  const r6 = await send("serve.add", { name: "S6", directory: "D:\\code\\mobile-agent-bridge\\docs" })
  const reuse = r6.ok && r6.payload.port === 4102
  console.log("再次添加:", r6.ok ? "port=" + r6.payload.port + " 复用4102=" + reuse : "ERROR " + r6.error)

  const final = await send("serve.list", {})
  for (const s of final.payload) await send("serve.remove", { id: s.id })
  console.log("清理完成")
  ws.close()
  process.exit(poolOk && !r5.ok && reuse ? 0 : 1)
})
