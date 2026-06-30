# 手机端 BridgeClient 实现参考

## React Native（TypeScript）

```typescript
let uuidCounter = 0
function genId(): string {
  return `req_${++uuidCounter}_${Date.now()}`
}

export class BridgeClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve: Function; reject: Function; timeout: ReturnType<typeof setTimeout> }>()
  private handlers = new Map<string, (data: any) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url = ""
  private token = ""

  connect(url: string, token: string): void {
    this.url = url
    this.token = token
    this.ws = new WebSocket(`${url}?token=${token}`)

    this.ws.onopen = () => {
      console.log("Bridge 连接成功")
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === "res") {
        const pending = this.pending.get(msg.id)
        if (pending) {
          pending.resolve(msg.payload)
          clearTimeout(pending.timeout)
          this.pending.delete(msg.id)
        }
      } else if (msg.type === "event") {
        const handler = this.handlers.get(msg.event)
        if (handler) handler(msg.data)
      }
    }

    this.ws.onclose = () => {
      console.warn("Bridge 断开，5 秒后重连")
      this.reconnectTimer = setTimeout(() => this.connect(this.url, this.token), 5000)
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = genId()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("请求超时"))
      }, 30000)
      this.pending.set(id, { resolve, reject, timeout })
      this.ws?.send(JSON.stringify({ type: "req", id, method, params }))
    })
  }

  on(event: string, handler: (data: any) => void): void {
    this.handlers.set(event, handler)
  }

  // === 认证（直接实现） ===
  login(password?: string) { return this.call("auth.login", { password }) }
  refreshToken() { return this.call("auth.refresh") }
  logout() { return this.call("auth.logout") }

  // === 会话（代理） ===
  createSession(params?: { title?: string; agent?: string }) {
    return this.call("session.create", params)
  }
  listSessions(params?: { scope?: string; search?: string; limit?: number }) {
    return this.call("session.list", params)
  }
  getSession(sessionID: string) { return this.call("session.get", { sessionID }) }
  deleteSession(sessionID: string) { return this.call("session.delete", { sessionID }) }
  renameSession(sessionID: string, title: string) {
    return this.call("session.rename", { sessionID, title })
  }
  getSessionMessages(sessionID: string, params?: { limit?: number; before?: string }) {
    return this.call("session.messages", { sessionID, ...params })
  }

  // === 消息（代理） ===
  sendMessage(sessionID: string, parts: any[]) {
    return this.call("message.send", { sessionID, parts })
  }
  sendShell(sessionID: string, command: string, params?: { agent?: string; model?: any }) {
    return this.call("message.shell", { sessionID, command, ...params })
  }
  sendCommand(sessionID: string, command: string, params?: { arguments?: string; agent?: string }) {
    return this.call("message.command", { sessionID, command, ...params })
  }
  abortSession(sessionID: string) { return this.call("message.abort", { sessionID }) }

  // === 权限（代理） ===
  replyPermission(requestID: string, reply?: "once" | "always" | "reject", message?: string) {
    return this.call("permission.reply", { requestID, reply, message })
  }

  // === 文件（直接实现，Bridge 走 fs） ===
  listFiles(path: string) { return this.call("file.list", { path }) }
  readFile(path: string) { return this.call("file.read", { path }) }
  searchFiles(query: string, params?: { pattern?: string; dirs?: string[]; limit?: number }) {
    return this.call("file.search", { query, ...params })
  }

  // === 配置（代理） ===
  getConfig() { return this.call("config.get") }
  getProviders() { return this.call("config.providers") }
  getAgents() { return this.call("config.agents") }

  // === 项目切换（Bridge 直接实现） ===
  switchProject(directory: string) { return this.call("project.switch", { directory }) }
  getCurrentProject() { return this.call("project.current") }

  // === 会话进阶（代理） ===
  getDiff(sessionID: string, messageID?: string) {
    return this.call("session.diff", { sessionID, messageID })
  }
  revertMessage(sessionID: string, messageID?: string) {
    return this.call("session.revert", { sessionID, messageID })
  }
  unrevertSession(sessionID: string) { return this.call("session.unrevert", { sessionID }) }
  getTodo(sessionID: string) { return this.call("session.todo", { sessionID }) }

  // === 健康检查（直接实现） ===
  ping() { return this.call("health.ping") }
}

// 使用示例
const bridge = new BridgeClient()
const { token } = await bridge.login("password123")
bridge.connect("wss://bridge.example.com/ws", token)

bridge.on("message.part.updated", (data) => {
  useMessageStore.getState().appendDelta(data.sessionID, data.messageID, data.delta)
})

bridge.on("permission.asked", (data) => {
  usePermissionStore.getState().addRequest(data)
})

bridge.on("project.changed", (data) => {
  useSessionStore.getState().clear()
  bridge.listSessions().then(sessions => useSessionStore.getState().setList(sessions))
})
```

## HarmonyOS ArkTS

```typescript
import webSocket from '@ohos.net.webSocket'

class HarmonyBridgeClient {
  private ws: webSocket.WebSocket
  private pending: Map<string, { resolve: Function, reject: Function }> = new Map()
  private handlers: Map<string, Function> = new Map()
  private seq = 0

  connect(url: string, token: string): void {
    this.ws = webSocket.createWebSocket()
    this.ws.connect(`${url}?token=${token}`, (err) => {
      if (err) { console.error('连接失败', err); return }
      this.listen()
    })
  }

  private listen(): void {
    this.ws.on('message', (data: string) => {
      const msg = JSON.parse(data)
      if (msg.type === 'res') {
        this.pending.get(msg.id)?.resolve(msg.payload)
        this.pending.delete(msg.id)
      } else if (msg.type === 'event') {
        this.handlers.get(msg.event)?.(msg.data)
      }
    })
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = `req_${++this.seq}`
    this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error('超时')), 30000)
    })
  }

  on(event: string, handler: Function): void {
    this.handlers.set(event, handler)
  }

  // 方法签名与 React Native 版本一致（省略具体实现）
}
```
