# Bridge 适配器实现参考

## OpenCode 适配器

使用 `@opencode-ai/sdk` v2。Bridge 持有唯一活跃的 `OpencodeClient` 实例。

```typescript
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import http from "http"
import { URL } from "url"

class OpenCodeBackend {
  public sdk: OpencodeClient | null = null
  private baseUrl: string

  constructor(baseUrl: string) {
    // baseUrl 不带 /api 后缀——v2 路径已内嵌 /api/ 前缀
    this.baseUrl = baseUrl
  }

  /** 创建 SDK client（绑定 directory） */
  createClient(directory: string): void {
    // dispose 清理旧 client（SSE、HTTP 连接）
    this.sdk?.global.dispose().catch(() => {})
    this.sdk = createOpencodeClient({
      baseUrl: this.baseUrl,
      fetch: this.createNodeFetch(), // 自定义 fetch 避免 tsx hang 问题
      directory,
    })
  }

  /** 销毁当前 client */
  dispose(): void {
    if (this.sdk) {
      this.sdk.global.dispose().catch(() => {})
      this.sdk = null
    }
  }

  /** 基于 http 模块的 fetch，避免 tsx/undici 下 req.timeout=false 导致 hang */
  private createNodeFetch(): typeof globalThis.fetch {
    const baseUrl = this.baseUrl
    return async (input: any, init?: any): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(String(input), init)
      const urlStr = req.url
      const absUrl = urlStr.startsWith("http") ? urlStr : `${baseUrl.replace(/\/+$/, "")}/${urlStr.replace(/^\/+/, "")}`
      const url = new URL(absUrl)
      const method = req.method
      const reqHeaders: Record<string, string> = {}
      req.headers.forEach((v, k) => { reqHeaders[k] = v })
      const bodyStr = method !== "GET" && method !== "HEAD" ? await req.text() : undefined

      return new Promise((resolve, reject) => {
        const nodeReq = http.request({
          hostname: url.hostname,
          port: parseInt(url.port || "80"),
          path: url.pathname + url.search,
          method,
          headers: bodyStr ? { ...reqHeaders, "Content-Length": Buffer.byteLength(bodyStr).toString() } : reqHeaders,
          timeout: 15000,
        }, (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString()
            resolve(new Response(responseBody, {
              status: res.statusCode || 200,
              statusText: res.statusMessage || "",
              headers: { "content-type": res.headers["content-type"] || "application/json" },
            }))
          })
        })
        nodeReq.on("error", (err) => reject(err))
        nodeReq.on("timeout", () => { nodeReq.destroy(); reject(new Error("Request timeout")) })
        if (bodyStr) nodeReq.write(bodyStr)
        nodeReq.end()
      })
    }
  }
}
```

**注记：** Phase 1 的 OpenCodeAdapter 职责已简化——仅管理 SDK client 生命周期。具体的 SDK 方法调用（`createSession`、`sendMessage`、`replyPermission` 等）在 Router handler 中内联完成，不在 adapter 中二次封装。这样做的好处是每个方法可以独立处理参数转换和错误格式。

完整的方法调用映射见 `docs/03-architecture-design.md §1.6`。

## SSE 事件订阅

SSE 订阅使用 `v2.event.subscribe()`（路径 `/api/event`），不直接使用 `global.event()`。事件格式为 `V2Event`（`{ id, type, data }`），非 `GlobalEvent` 格式。

```typescript
async function startSSE(sdk: OpencodeClient, signal: AbortSignal, onEvent: (type: string, data: unknown) => void): Promise<void> {
  while (true) {
    if (signal.aborted) break
    try {
      const events = await sdk.v2.event.subscribe({ signal, sseMaxRetryAttempts: 0 } as any)
      for await (const event of events.stream) {
        if (signal.aborted) break
        // V2Event 格式: { id, type, data, metadata?, durable?, location? }
        const ev = event as any
        onEvent(ev.type || "unknown", ev.data || ev)
      }
    } catch (err: any) {
      if (signal.aborted) break
      // 服务端不支持 event 端点时停止重试
      if (err.message?.includes("text/html") || err.message?.includes("HTML")) break
    }
    await new Promise(r => setTimeout(r, 3000))
  }
}
```

## Hermes 适配器（待 Phase 3）

通过 JSON-RPC over stdio 与 Hermes Python 进程通信。见 `docs/03-architecture-design.md §1.7`。

## OpenClaw 适配器（待 Phase 3）

通过 WebSocket 原生协议连接 OpenClaw Gateway。见 `docs/03-architecture-design.md §1.7`。
