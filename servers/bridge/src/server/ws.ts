import { WebSocketServer, WebSocket } from "ws"
import { IncomingMessage } from "http"
import { verifyToken } from "./auth.js"
import { handleFrame } from "./router.js"

const connections = new Map<string, WebSocket>()

export function broadcastToAll(frame: unknown): void {
  const msg = JSON.stringify(frame)
  for (const [id, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg)
    }
  }
}

export function createWSServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const token = url.searchParams.get("token") || ""

    // JWT 验证
    const payload = verifyToken(token)
    if (!payload) {
      ws.send(JSON.stringify({ type: "res", id: "0", ok: false, error: "unauthorized" }))
      ws.close(4001, "unauthorized")
      return
    }

    const connID = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    connections.set(connID, ws)

    console.log(`[WS] 新连接: ${connID}, user: ${payload.sub}`)

    ws.on("message", (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString())
        handleFrame(connID, ws, frame, payload)
      } catch (err) {
        ws.send(JSON.stringify({ type: "res", id: "0", ok: false, error: "invalid json" }))
      }
    })

    ws.on("close", () => {
      connections.delete(connID)
      console.log(`[WS] 断开: ${connID}`)
    })

    ws.on("error", (err) => {
      console.error(`[WS] 错误: ${connID}`, err.message)
      connections.delete(connID)
    })
  })

  console.log(`[WS] 服务器启动于端口 ${port}`)
  return wss
}
