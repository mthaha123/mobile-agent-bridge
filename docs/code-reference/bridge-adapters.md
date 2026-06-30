# Bridge 适配器实现参考

## AgentBackend 接口

```typescript
interface AgentBackend {
  connect(config: any): Promise<void>
  sendMessage(sessionID: string, parts: PartInput[]): Promise<void>
  sendShell(sessionID: string, command: string, agent?: string, model?: ModelRef): Promise<void>
  sendCommand(sessionID: string, command: string, args?: string, agent?: string): Promise<void>
  abortSession(sessionID: string): Promise<void>
  replyPermission(requestID: string, reply?: "once" | "always" | "reject", message?: string): Promise<void>
  replyQuestion(requestID: string, answers?: QuestionAnswer[]): Promise<void>
  rejectQuestion(requestID: string): Promise<void>
  startSSE(signal: AbortSignal): Promise<void>
}
```

## OpenCode 适配器

使用 `@opencode-ai/sdk` v2。Bridge 持有唯一活跃的 `OpencodeClient` 实例。

```typescript
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/v2"
import type { PartInput, ModelRef, QuestionAnswer } from "@opencode-ai/sdk/v2"

class OpenCodeBackend {
  private sdk: OpencodeClient | null = null
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /** 创建 SDK client（绑定 directory） */
  createClient(directory: string): void {
    // 销毁旧 client（GC 回收纯 JS 对象）
    this.sdk = null
    this.sdk = createOpencodeClient({
      baseUrl: this.baseUrl,
      directory,
    })
  }

  async sendMessage(sessionID: string, parts: PartInput[]): Promise<void> {
    await this.sdk!.session.prompt({ sessionID, parts })
  }

  async sendShell(sessionID: string, command: string, agent?: string, model?: ModelRef): Promise<void> {
    await this.sdk!.session.shell({ sessionID, command, agent, model })
  }

  async sendCommand(sessionID: string, command: string, args?: string, agent?: string): Promise<void> {
    await this.sdk!.session.command({ sessionID, command, arguments: args, agent })
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.sdk!.session.abort({ sessionID })
  }

  async replyPermission(requestID: string, reply?: "once" | "always" | "reject", message?: string): Promise<void> {
    await this.sdk!.permission.reply({ requestID, reply, message })
  }

  async replyQuestion(requestID: string, answers?: QuestionAnswer[]): Promise<void> {
    await this.sdk!.question.reply({ requestID, answers })
  }

  async rejectQuestion(requestID: string): Promise<void> {
    await this.sdk!.question.reject({ requestID })
  }

  /** 订阅 SSE，事件由调用方通过 signal 管理生命周期 */
  async startSSE(signal: AbortSignal, onEvent: (event: any) => void): Promise<void> {
    while (true) {
      if (signal.aborted) break
      const events = await this.sdk!.global.event({
        signal,
        sseMaxRetryAttempts: 0,
      })
      for await (const event of events.stream) {
        if (signal.aborted) break
        onEvent(event)
      }
      // 断线后等待重试
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}
```

## Hermes 适配器

通过 JSON-RPC over stdio 与 Hermes Python 进程通信。

```typescript
import { spawn, ChildProcess } from "child_process"
import * as readline from "readline"

class HermesBackend {
  private proc: ChildProcess | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: Function; reject: Function }>()

  async connect(): Promise<void> {
    this.proc = spawn("python", ["-m", "tui_gateway.entry"], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    const reader = readline.createInterface({ input: this.proc.stdout! })
    reader.on("line", (line) => {
      const msg = JSON.parse(line)
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        p.resolve(msg.result)
        this.pending.delete(msg.id)
      }
    })
  }

  async sendMessage(sessionID: string, parts: any[]): Promise<void> {
    await this.rpcCall("chat.send", { sessionId: sessionID, content: parts })
  }

  private rpcCall(method: string, params: any): Promise<any> {
    const id = ++this.requestId
    this.proc!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error("RPC 超时")), 30000)
    })
  }

  async startSSE(signal: AbortSignal, onEvent: (event: any) => void): Promise<void> {
    // Hermes 的事件通过 stdout 行推送，过滤 method 为 "event" 的行
    // 具体实现取决于 Hermes 网关协议
    throw new Error("待实现")
  }
}
```

## OpenClaw 适配器

通过 WebSocket 原生协议连接 OpenClaw Gateway。

```typescript
import WebSocket from "ws"

class OpenClawBackend {
  private ws: WebSocket | null = null

  async connect(config: { host: string; token: string }): Promise<void> {
    this.ws = new WebSocket(`wss://${config.host}:18789`)
    await this.sendFrame({
      type: "req",
      method: "connect",
      params: { role: "operator", auth: { token: config.token } },
    })
  }

  async sendMessage(sessionID: string, parts: any[]): Promise<void> {
    await this.sendFrame({
      type: "req",
      method: "agent",
      params: { sessionId: sessionID, message: parts },
    })
  }

  private async sendFrame(frame: any): Promise<void> {
    this.ws!.send(JSON.stringify(frame))
  }

  async startSSE(signal: AbortSignal, onEvent: (event: any) => void): Promise<void> {
    // 从 ws.onmessage 过滤 type === "event"
    // 具体实现取决于 OpenClaw 网关协议
    throw new Error("待实现")
  }
}
```
