import { WebSocketServer, WebSocket } from "ws"
import { IncomingMessage } from "http"
import { verifyToken } from "./auth.js"
import { handleFrame } from "./router.js"

const connections = new Map<string, WebSocket>()
const connTokens = new Map<string, string>()

export function broadcastToAll(frame: unknown): void {
  const msg = JSON.stringify(frame)
  for (const [id, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg) } catch {}
    }
  }
}

export function createWSServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

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

  console.log(`[WS] 服务器启动于端口 ${port}`)
  return wss
}
