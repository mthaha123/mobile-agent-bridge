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
          const statusCode = res.statusCode || 200
          if (statusCode === 204) {
            resolve(new Response(null, { status: 204, statusText: "No Content" }))
            return
          }
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
            status: statusCode,
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
    const apiBaseUrl = `${this.baseUrl.replace(/\/+$/, "")}`
    const newSdk = createOpencodeClient({
      baseUrl: apiBaseUrl,
      fetch: this.createNodeFetch(),
      directory,
    })
    // 新 client 就绪后才销毁旧的（防回滚丢失）
    this.sdk?.global.dispose().catch(() => {})
    this.sdk = newSdk
  }

  /** 销毁当前 client */
  dispose(): void {
    if (this.sdk) {
      this.sdk.global.dispose().catch(() => {})
      this.sdk = null
    }
  }

  /**
   * 读取 session 消息（v2 优先，v1 回退）。
   *
   * 背景：opencode serve 有两条独立路由，读不同数据表：
   *   - `/api/session/{id}/message`（v2）：读 session_message 投影表，返回 {data, cursor}。
   *     对旧版本创建的「历史 session」，消息只在 message/part（v1）表，session_message 为空 → {data:[]}。
   *   - `/session/{id}/message`（旧版）：读 message/part 表，返回裸数组，分页在 Link/X-Next-Cursor 头。
   *
   * 因此这里双通道：先 v2，若 data 非空用之（含 body cursor 分页）；否则回退 v1（解析 header 分页）。
   * 两条路由消息项结构一致（{info, parts}），统一输出 { messages, cursor }。
   */
  async rawSessionMessages(sessionID: string, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): Promise<{ messages: unknown[]; cursor?: unknown }> {
    const base = this.baseUrl.replace(/\/+$/, "")

    // 优先 v2 路由
    const v2 = await this.httpGetJson(`${base}/api/session/${encodeURIComponent(sessionID)}/message`, opts)
    const v2Data = (v2 as any)?.data
    if (Array.isArray(v2Data) && v2Data.length > 0) {
      // v2 默认降序（最新在前），统一输出升序（旧→新）供 App 直接渲染
      const messages = (opts?.order === 'asc' || !Array.isArray(v2Data)) ? v2Data : [...v2Data].reverse()
      return { messages, cursor: (v2 as any)?.cursor }
    }

    // 回退 v1 路由：裸数组（已升序）+ header 分页
    const v1 = await this.httpGetWithHeaders(`${base}/session/${encodeURIComponent(sessionID)}/message`, opts)
    const arr = Array.isArray(v1.body) ? v1.body : ((v1.body as any)?.messages ?? [])
    // v1 分页：X-Next-Cursor 头 或 Link 头中 rel="next" 的 before 参数
    let cursor: unknown
    const nextHeader = v1.headers?.["x-next-cursor"]
    if (nextHeader) {
      cursor = nextHeader
    } else if (v1.headers?.link) {
      const m = /<[^>]*before=([^&>]+)[^>]*>;\s*rel="?next"?/.exec(String(v1.headers.link))
      if (m) cursor = decodeURIComponent(m[1])
    }
    return { messages: arr, cursor }
  }

  /** http GET 返回 JSON body（v2 结构） */
  private async httpGetJson(urlStr: string, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): Promise<unknown> {
    const body = await this.httpGetBody(urlStr, opts)
    return JSON.parse(body)
  }

  /** http GET 返回 { body, headers } */
  private async httpGetWithHeaders(urlStr: string, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): Promise<{ body: unknown; headers: Record<string, string | string[] | undefined> }> {
    const qs = this.buildQuery(opts)
    const url = new URL(urlStr + qs)
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        timeout: 120000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => resolve({ body: b, headers: res.headers as Record<string, string | string[] | undefined> }))
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")) })
      req.on("error", reject)
      req.end()
    }).then(({ body, headers }) => {
      let parsed: unknown
      try { parsed = JSON.parse(String(body)) } catch { parsed = String(body) }
      return { body: parsed, headers }
    })
  }

  /** http GET 返回 body 字符串 */
  private async httpGetBody(urlStr: string, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): Promise<string> {
    const qs = this.buildQuery(opts)
    const url = new URL(urlStr + qs)
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        timeout: 120000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => resolve(b))
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")) })
      req.on("error", reject)
      req.end()
    })
  }

  private buildQuery(opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }): string {
    const qs: string[] = []
    if (opts?.limit !== undefined) qs.push(`limit=${opts.limit}`)
    if (opts?.order) qs.push(`order=${opts.order}`)
    if (opts?.cursor) qs.push(`cursor=${encodeURIComponent(opts.cursor)}`)
    return qs.length ? '?' + qs.join('&') : ''
  }

  /** 惰性初始化：SDK 未初始化时创建一个无 directory 的全局 client。
   *  用于 config.agents/providers/model.list/command.list 等只读全局配置查询，
   *  它们不依赖 project.switch。已初始化时复用当前 client。 */
  ensureClient(): OpencodeClient {
    if (this.sdk) return this.sdk
    this.createClient("")
    return this.sdk!
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
