# 手机端 BridgeClient 实现参考

## React Native（TypeScript）

```typescript
class BridgeClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve, reject, timeout }>()
  private handlers = new Map<string, (data: any) => void>()

  connect(url: string, token: string): void {
    this.ws = new WebSocket(`${url}?token=${token}`)

    this.ws.onopen = () => {
      console.log('Bridge 连接成功')
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'res') {
        const pending = this.pending.get(msg.id)
        if (pending) {
          pending.resolve(msg.payload)
          clearTimeout(pending.timeout)
          this.pending.delete(msg.id)
        }
      } else if (msg.type === 'event') {
        const handler = this.handlers.get(msg.event)
        if (handler) handler(msg.data)
      }
    }

    this.ws.onclose = () => {
      console.warn('Bridge 断开，5 秒后重连')
      setTimeout(() => this.connect(url, token), 5000)
    }
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('请求超时')), 30000)
      this.pending.set(id, { resolve, reject, timeout })
      this.ws?.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  on(event: string, handler: (data: any) => void): void {
    this.handlers.set(event, handler)
  }

  // === 认证（直接实现） ===
  login(password?: string) { return this.call('auth.login', { password }) }
  refreshToken() { return this.call('auth.refresh') }
  logout() { return this.call('auth.logout') }

  // === 会话（代理） ===
  createSession(title: string) { return this.call('session.create', { title }) }
  listSessions() { return this.call('session.list') }
  getSession(id: string) { return this.call('session.get', { sessionID: id }) }
  deleteSession(id: string) { return this.call('session.delete', { sessionID: id }) }
  getSessionMessages(id: string) { return this.call('session.messages', { sessionID: id }) }

  // === 消息（代理） ===
  sendMessage(sessionID: string, text: string) { return this.call('message.send', { sessionID, text }) }
  sendShell(sessionID: string, command: string) { return this.call('message.shell', { sessionID, command }) }
  sendCommand(sessionID: string, command: string, args?: string[]) { return this.call('message.command', { sessionID, command, args }) }
  abortSession(sessionID: string) { return this.call('message.abort', { sessionID }) }

  // === 权限（代理） ===
  replyPermission(requestID: string, reply: string, message?: string) {
    return this.call('permission.reply', { requestID, reply, message })
  }

  // === 文件（直接实现） ===
  listFiles(path: string) { return this.call('file.list', { path }) }
  readFile(path: string) { return this.call('file.read', { path }) }
  searchFiles(query: string) { return this.call('file.search', { query }) }

  // === 启动信息（代理） ===
  getConfig() { return this.call('config.get') }
  getProviders() { return this.call('config.providers') }
  getAgents() { return this.call('config.agents') }

  // === 健康检查（直接实现） ===
  ping() { return this.call('health.ping') }
}

// 使用示例
const bridge = new BridgeClient()
await bridge.login('password123')  // 获取 JWT
bridge.connect('wss://bridge.example.com/ws', token)

bridge.on('message.part.updated', (data) => {
  useMessageStore.getState().appendDelta(data.sessionID, data.messageID, data.delta)
})

bridge.on('permission.asked', (data) => {
  usePermissionStore.getState().addRequest(data)
})
```

## HarmonyOS ArkTS

```typescript
import webSocket from '@ohos.net.webSocket'

class HarmonyBridgeClient {
  private ws: webSocket.WebSocket
  private pending: Map<string, { resolve: Function, reject: Function }> = new Map()

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
        // 分发事件
      }
    })
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = `req_${Date.now()}`
    this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error('超时')), 30000)
    })
  }
}
```
