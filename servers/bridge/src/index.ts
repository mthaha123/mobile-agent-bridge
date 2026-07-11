import { createWSServer } from "./server/ws.js"
import { initBackend } from "./adapters/OpenCodeAdapter.js"

process.on("uncaughtException", (err) => {
  console.error("[Bridge] uncaughtException:", err)
})
process.on("unhandledRejection", (err) => {
  console.error("[Bridge] unhandledRejection:", err)
})

const PORT = parseInt(process.env.BRIDGE_PORT || "8080", 10)
const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096"

console.log("[Bridge] 启动中...")
console.log(`[Bridge] WS 端口: ${PORT}`)
console.log(`[Bridge] OpenCode URL: ${OPENCODE_URL}`)

// 初始化后端（但还不连接 — 等 project.switch）
initBackend(OPENCODE_URL)

createWSServer(PORT)
