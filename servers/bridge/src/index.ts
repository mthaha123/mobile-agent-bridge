import { createWSServer } from "./server/ws.js"
import { initBackend } from "./adapters/OpenCodeAdapter.js"
import { initManager, getServePortPool } from "./state/serveManager.js"
import { resolve } from "path"
import { resolveBridgePort, resolveOpenCodeUrl, resolveDataDir } from "./config.js"

process.on("uncaughtException", (err) => {
  console.error("[Bridge] uncaughtException:", err)
  // crash 模式：不杀 serve，直接退出
  process.exit(1)
})
process.on("unhandledRejection", (err) => {
  console.error("[Bridge] unhandledRejection:", err)
})

const PORT = resolveBridgePort()
const OPENCODE_URL = resolveOpenCodeUrl()
const PROJECT_ROOT = resolve(import.meta.dirname || process.cwd(), "..", "..", "..")
const DATA_DIR = resolveDataDir(PROJECT_ROOT)

console.log("[Bridge] 启动中...")
console.log(`[Bridge] WS 端口: ${PORT}`)
console.log(`[Bridge] OpenCode URL: ${OPENCODE_URL}`)
console.log(`[Bridge] 数据目录: ${DATA_DIR}`)

// 初始化后端
initBackend(OPENCODE_URL)

// 初始化 serve 管理器（清理孤儿 + 注册退出清理）
await initManager(PROJECT_ROOT, DATA_DIR)

createWSServer(PORT, () => ({ dataDir: DATA_DIR, servePortPool: getServePortPool() }))
