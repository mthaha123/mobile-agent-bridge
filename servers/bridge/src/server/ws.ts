import { WebSocketServer, WebSocket } from "ws"
import { createServer, IncomingMessage } from "http"
import { verifyToken } from "./auth.js"
import { handleFrame } from "./router.js"

const connections = new Map<string, WebSocket>()
/** @internal 测试用 */
export function _testGetConnections(): Map<string, WebSocket> { return connections }
const connTokens = new Map<string, string>()

export function broadcastToAll(frame: unknown): void {
  const msg = JSON.stringify(frame)
  for (const [id, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg) } catch {}
    }
  }
}

/** 健康检查响应体 */
export interface HealthInfo {
  ok: boolean
  service: string
  port: number
  uptime: number
  dataDir?: string
  servePortPool?: number[]
}

/**
 * @param healthExtra 可选：附加健康信息（如数据目录 / serve 端口池），用于确认生效的生产配置
 */
export function createWSServer(port: number, healthExtra?: () => Record<string, unknown>): WebSocketServer {
  // 显式 HTTP server：/health 探活 + 承载 WS upgrade（生产服务守护/负载均衡探活依赖它）
  const httpServer = createServer((req, res) => {
    const pathname = (req.url || "/").split("?")[0]
    if (pathname === "/health" || pathname === "/healthz") {
      const body: HealthInfo = {
        ok: true,
        service: "mobile-agent-bridge",
        port,
        uptime: Math.round(process.uptime()),
        ...(healthExtra ? healthExtra() : {}),
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ ok: false, error: "not found" }))
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const token = url.searchParams.get("token") || ""

    const connID = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    connections.set(connID, ws)
    connTokens.set(connID, token)

    let wasAuthed = false

    function safeSend(data: string): void {
      try { ws.send(data) } catch {}
    }

    ws.on("message", (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString())
        console.log(`[WS] 收到 ${connID}: type=${frame.type} method=${frame.method || ""}`)
        const currentToken = connTokens.get(connID) || ""

        const currentPayload = verifyToken(currentToken) || null

        if (wasAuthed && !currentPayload) {
          safeSend(JSON.stringify({ type: "res", id: frame.id || "0", ok: false, error: "unauthorized" }))
          ws.close(4001, "token expired")
          connTokens.delete(connID)
          return
        }

        wasAuthed = !!currentPayload

        const onTokenRefreshed = (newToken: string) => {
          connTokens.set(connID, newToken)
          wasAuthed = true
        }

        handleFrame(connID, ws, frame, currentPayload, onTokenRefreshed).catch((err) => {
          console.error(`[WS] handleFrame 未捕获错误:`, err)
        })
      } catch {
        safeSend(JSON.stringify({ type: "res", id: "0", ok: false, error: "invalid json" }))
      }
    })

    ws.on("close", () => {
      connections.delete(connID)
      connTokens.delete(connID)
      console.log(`[WS] 断开: ${connID}`)
    })

    ws.on("error", (err) => {
      console.error(`[WS] 错误: ${connID}`, err.message)
      connections.delete(connID)
      connTokens.delete(connID)
    })
  })

  // wss 关闭时同步释放底层 HTTP server（否则端口不释放）
  wss.on("close", () => httpServer.close())

  httpServer.listen(port, () => {
    console.log(`[WS] 服务器启动于端口 ${port}（/health 就绪）`)
  })

  return wss
}
