# Bridge 适配器实现参考

## AgentBackend 接口

```typescript
interface AgentBackend {
  connect(config: any): Promise<void>
  sendMessage(sessionID: string, text: string): Promise<void>
  sendShell(sessionID: string, command: string): Promise<void>
  sendCommand(sessionID: string, command: string, args?: string[]): Promise<void>
  abortSession(sessionID: string): Promise<void>
  replyPermission(sessionID: string, requestID: string, action: string, message?: string): Promise<void>
  replyQuestion(requestID: string, answers: any[]): Promise<void>
  rejectQuestion(requestID: string): Promise<void>
  subscribeEvents(): AsyncIterable<AgentEvent>
}
```

## OpenCode 适配器

使用 `@opencode-ai/sdk` v2。

```typescript
class OpenCodeBackend implements AgentBackend {
  private sdk = createOpencodeClient({ baseUrl: 'http://localhost:4096' })

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.sdk.client.session.prompt({
      path: { id: sessionID },
      body: { noReply: true, parts: [{ type: 'text', text }] },
    })
  }

  async sendShell(sessionID: string, command: string): Promise<void> {
    await this.sdk.client.session.shell({
      path: { id: sessionID },
      body: { command },
    })
  }

  async sendCommand(sessionID: string, command: string, args?: string[]): Promise<void> {
    await this.sdk.client.session.command({
      path: { id: sessionID },
      body: { command, arguments: args },
    })
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.sdk.client.session.abort({ path: { id: sessionID } })
  }

  async replyPermission(requestID: string, reply: string, message?: string): Promise<void> {
    await this.sdk.client.permission.reply({ requestID, reply, message })
  }

  async replyQuestion(requestID: string, answers: any[]): Promise<void> {
    await this.sdk.client.question.reply({ requestID, answers })
  }

  async rejectQuestion(requestID: string): Promise<void> {
    await this.sdk.client.question.reject({ requestID })
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    const events = await this.sdk.global.event()
    return events.stream
  }
}
```

## Hermes 适配器

通过 JSON-RPC over stdio 与 Hermes Python 进程通信。

```typescript
class HermesBackend implements AgentBackend {
  private proc: ChildProcess
  private requestId = 0
  private pending = new Map<number, { resolve, reject }>()

  async connect(): Promise<void> {
    this.proc = spawn('python', ['-m', 'tui_gateway.entry'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const reader = readline.createInterface({ input: this.proc.stdout })
    reader.on('line', (line) => {
      const msg = JSON.parse(line)
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        p.resolve(msg.result)
        this.pending.delete(msg.id)
      }
    })
  }

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.rpcCall('chat.send', { sessionId: sessionID, content: text })
  }

  private rpcCall(method: string, params: any): Promise<any> {
    const id = ++this.requestId
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error('RPC 超时')), 30000)
    })
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    // 从 stdout 行过滤 events
    throw new Error('Not implemented')
  }
}
```

## OpenClaw 适配器

通过 WebSocket 原生协议连接 OpenClaw Gateway。

```typescript
class OpenClawBackend implements AgentBackend {
  private ws: WebSocket

  async connect(config: OpenClawConfig): Promise<void> {
    this.ws = new WebSocket(`wss://${config.host}:18789`)
    await this.sendFrame({
      type: 'req', method: 'connect',
      params: { role: 'operator', auth: { token: config.token } },
    })
  }

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.sendFrame({
      type: 'req', method: 'agent',
      params: { sessionId: sessionID, message: text },
    })
  }

  private async sendFrame(frame: any): Promise<void> {
    this.ws.send(JSON.stringify(frame))
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    // 从 ws.onmessage 过滤 type === 'event'
    throw new Error('Not implemented')
  }
}
```
