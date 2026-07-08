import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import http from "http"
import { URL } from "url"

/**
 * OpenCode SDK 适配器
 *
 * 封装 @opencode-ai/sdk v2，管理 OpencodeClient 生命周期。
 * Bridge 持有唯一活跃 client，通过 setupProject 创建。
 */
export class OpenCodeBackend {
  public sdk: OpencodeClient | null = null
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
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

      const defaultPort = url.protocol === "https:" ? 443 : 80
      return new Promise((resolve, reject) => {
        const nodeReq = http.request({
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : defaultPort,
          path: url.pathname + url.search,
          method,
          headers: bodyStr ? { ...reqHeaders, "Content-Length": Buffer.byteLength(bodyStr).toString() } : reqHeaders,
          timeout: 120000,
        }, (res) => {
          let streamCancelled = false
          const body = new ReadableStream({
            start(controller) {
              res.on("data", (chunk: Buffer) => {
                if (!streamCancelled) controller.enqueue(chunk)
              })
              res.on("end", () => {
                if (!streamCancelled) controller.close()
              })
              res.on("error", (err) => {
                if (!streamCancelled) controller.error(err)
              })
            },
            cancel() {
              streamCancelled = true
              res.destroy()
            },
          })
          resolve(new Response(body, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || "",
            headers: { "content-type": res.headers["content-type"] || "application/json" },
          }))
        })
        nodeReq.on("error", (err) => reject(err))
        nodeReq.on("timeout", () => { nodeReq.destroy(); reject(new Error("Request timeout")) })
        if (bodyStr) nodeReq.write(bodyStr)
        nodeReq.end()
      })
    }
  }

  /** 创建 SDK client（绑定 directory） */
  createClient(directory: string): void {
    this.sdk?.global.dispose().catch(() => {})
    // SDK v2 内部已在路径中添加 /api/ 前缀，baseUrl 用裸地址即可
    const apiBaseUrl = `${this.baseUrl.replace(/\/+$/, "")}`
    this.sdk = createOpencodeClient({
      baseUrl: apiBaseUrl,
      fetch: this.createNodeFetch(),
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
}

let _backend: OpenCodeBackend | null = null

export function initBackend(baseUrl: string): OpenCodeBackend {
  _backend = new OpenCodeBackend(baseUrl)
  return _backend
}

export function getBackend(): OpenCodeBackend {
  if (!_backend) throw new Error("OpenCodeBackend not initialized")
  return _backend
}
