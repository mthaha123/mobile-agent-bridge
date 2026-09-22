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
  // 端口池 / 并发上限（与 bridge 配置对齐；默认池 4100-4109、并发 5）
  const POOL = (process.env.BRIDGE_SERVE_PORT_POOL || "4100,4101,4102,4103,4104,4105,4106,4107,4108,4109")
    .split(",").map((s) => parseInt(s.trim(), 10))
  const MAX = parseInt(process.env.BRIDGE_SERVE_MAX || "5", 10)

  const ports = []
  for (let i = 0; i < MAX; i++) {
    const r = await send("serve.add", { name: "S" + i, directory: dirs[i] })
    if (r.ok) { ports.push(r.payload.port); console.log("add S" + i + ": port=" + r.payload.port) }
    else console.log("add S" + i + ": ERROR " + r.error)
  }
  const distinct = new Set(ports).size === ports.length
  const inPool = ports.length === MAX && ports.every((p) => POOL.includes(p))
  console.log("端口:", ports.join(","), "| 去重:", distinct, "| 在池内:", inPool)

  // 第 MAX+1 个必须被并发上限拒绝
  const rExtra = await send("serve.add", { name: "SX", directory: "D:\\code\\mobile-agent-bridge\\docs" })
  const capOk = !rExtra.ok
  console.log("超并发上限:", capOk ? "正确拒绝: " + rExtra.error : "BUG 应该失败")

  // 删一个再添加：应拿到池内、且当前未被占用的端口
  const list = await send("serve.list", {})
  const target = list.payload[0]
  await send("serve.remove", { id: target.id })
  console.log("删除 port " + target.port)

  const stillUsed = new Set(ports.filter((p) => p !== target.port))
  const rAgain = await send("serve.add", { name: "SN", directory: "D:\\code\\mobile-agent-bridge\\docs" })
  const reuse = rAgain.ok && POOL.includes(rAgain.payload.port) && !stillUsed.has(rAgain.payload.port)
  console.log("再次添加:", rAgain.ok ? "port=" + rAgain.payload.port + " 池内空闲=" + reuse : "ERROR " + rAgain.error)

  const final = await send("serve.list", {})
  for (const s of final.payload) await send("serve.remove", { id: s.id })
  console.log("清理完成")
  ws.close()
  process.exit(distinct && inPool && capOk && reuse ? 0 : 1)
})
