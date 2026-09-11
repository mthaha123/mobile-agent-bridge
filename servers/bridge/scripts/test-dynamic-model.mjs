import { createRequire } from "module"
const require = createRequire(import.meta.url)
const WebSocket = require("ws")

const ws = new WebSocket("ws://localhost:8080/ws")
function send(method, params = {}) {
  return new Promise((r) => {
    const id = "t" + Math.random()
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.id === id) { ws.off("message", h); r(m) } }
    ws.on("message", h)
    ws.send(JSON.stringify({ type: "req", id, method, params }))
  })
}

const DIR = "D:\\code\\mobile-agent-bridge"

ws.on("open", async () => {
  await send("auth.login", { password: "test123" })

  // 清理
  let list = await send("serve.list", {})
  for (const s of list.payload) await send("serve.remove", { id: s.id })

  console.log("=== 阶段1: 无 serve 时登录 ===")
  const sw1 = await send("project.switch", { directory: DIR })
  console.log("project.switch:", sw1.ok ? "ok" : "error " + sw1.error)
  const m1 = await send("model.list", {})
  console.log("model.list:", m1.ok ? "count=" + m1.payload.length : "error " + m1.error)
  const a1 = await send("config.agents", {})
  console.log("config.agents:", a1.ok ? "count=" + (a1.payload?.length ?? "?") : "error " + a1.error)

  console.log("\n=== 阶段2: 添加 serve 后 ===")
  const add = await send("serve.add", { name: "Test", directory: DIR })
  console.log("serve.add:", add.ok ? "port=" + add.payload.port : "error " + add.error)
  // 等 serve 就绪
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const l = await send("serve.list", {})
    const me = l.payload.find((p) => p.id === add.payload?.id)
    if (me?.status === "running") { console.log("serve ready after", i + 1, "s"); break }
  }

  // 关键：再次 switch（模拟手机端切换项目）
  const sw2 = await send("project.switch", { directory: DIR })
  console.log("project.switch (2nd):", sw2.ok ? "ok" : "error " + sw2.error)
  const m2 = await send("model.list", {})
  console.log("model.list:", m2.ok ? "count=" + m2.payload.length : "error " + m2.error)
  const a2 = await send("config.agents", {})
  console.log("config.agents:", a2.ok ? "count=" + (a2.payload?.length ?? "?") : "error " + a2.error)
  const s2 = await send("session.list", {})
  console.log("session.list:", s2.ok ? "count=" + s2.payload.length : "error " + s2.error)

  // 清理
  list = await send("serve.list", {})
  for (const s of list.payload) await send("serve.remove", { id: s.id })
  console.log("\n清理完成")
  ws.close()
  process.exit(0)
})
