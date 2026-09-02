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

  getBaseUrl(): string {
    return this.baseUrl
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
          // SSE 长连接（/event）必须禁用 socket 空闲超时：长 bash 执行期间事件静默 >120s
          // 会触发空闲超时被强制断流，断口内产生的事件（含 tool.success 终态）永久丢失。
          timeout: resolveHttpIdleTimeoutMs(url.pathname),
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
   * 读取 session 消息（双通道取全量，归一化输出）。
   *
   * 背景：opencode serve 有两条独立路由，读不同数据表：
   *   - `/api/session/{id}/message`（v2）：读 session_message 投影表，返回 {data, cursor}。
   *     投影可能滞后（缺最新消息）甚至整体缺失，但部分会话的数据只存在于投影表。
   *     内部固定 order=desc 取"最新窗口"（该参数不对客户端暴露）。
   *   - `/session/{id}/message`（v1）：读 message/part 原始表，返回裸数组，完整且新鲜；
   *     服务端忽略 order 参数（页内恒升序、恒返回最新页），分页 token 在 Link/X-Next-Cursor 头。
   *
   * 对客户端的 WS 契约（客户端无感底层通道与排序策略）：
   *   - messages 恒定升序（旧→新），按 info.time.created 排序（缺失时按 message id 兜底）；
   *   - cursor 为不透明 token，内部绑定来源通道（`v1:`/`v2:` 前缀），
   *     翻页时只路由到对应通道，杜绝跨通道 cursor 污染；
   *   - 初始加载选边策略：新鲜度（max time.created）优先 → 数量多者优先 → v1（原始表权威源兜底）。
   *
   * 两条路由消息项结构一致（{info, parts}），统一输出 { messages, cursor }。
   */
  async rawSessionMessages(sessionID: string, opts?: { limit?: number; cursor?: string }): Promise<{ messages: unknown[]; cursor?: unknown }> {
    const base = this.baseUrl.replace(/\/+$/, "")
    const enc = encodeURIComponent(sessionID)

    // 翻页：cursor 已绑定来源通道 → 只查对应通道（杜绝跨通道 cursor 污染）
    const tagged = parseTaggedCursor(opts?.cursor)
    if (tagged?.channel === "v2") {
      const page = await this.fetchV2Page(base, enc, { limit: opts?.limit, cursor: tagged.token })
      return { messages: sortMessagesAsc(page.messages.map(normalizeMessageRecord)), cursor: tagCursor("v2", page.cursor) }
    }
    if (tagged?.channel === "v1") {
      const page = await this.fetchV1Page(base, enc, { limit: opts?.limit, before: tagged.token })
      return { messages: sortMessagesAsc(page.messages.map(normalizeMessageRecord)), cursor: tagCursor("v1", page.cursor) }
    }

    // 初始加载 / 遗留无前缀 cursor（向后兼容）：双通道都取，按新鲜度选边后归一化输出
    const [v1, v2] = await Promise.all([
      this.fetchV1Page(base, enc, { limit: opts?.limit }),
      this.fetchV2Page(base, enc, { limit: opts?.limit }),
    ])
    const winner = pickChannel(v1.messages, v2.messages)
    const page = winner === "v1" ? v1 : v2
    return { messages: sortMessagesAsc(page.messages.map(normalizeMessageRecord)), cursor: tagCursor(winner, page.cursor) }
  }

  /** v2 投影表分页：内部恒用 order=desc 取"最新窗口"，输出前由调用方统一升序归一化 */
  private async fetchV2Page(base: string, encSessionID: string, q: { limit?: number; cursor?: string }): Promise<ChannelPage> {
    const qs: string[] = []
    if (q.limit !== undefined) qs.push(`limit=${q.limit}`)
    if (q.cursor) {
      // cursor 为自描述 token（内部编码了 order/direction），再拼 order 会导致 400
      qs.push(`cursor=${encodeURIComponent(q.cursor)}`)
    } else {
      // 仅首屏取"最新窗口"
      qs.push("order=desc")
    }
    const body = await this.httpGetJson(`${base}/api/session/${encSessionID}/message?${qs.join("&")}`) as any
    const data = body?.data
    return {
      messages: Array.isArray(data) ? data : [],
      // serve 的 v2 cursor 是 { previous, next } 对象：next 指向更早消息（翻历史用）。
      // 必须取字符串，绝不能 String(对象) 变 "[object Object]"。
      cursor: typeof body?.cursor === "string"
        ? body.cursor
        : typeof body?.cursor?.next === "string"
          ? body.cursor.next
          : body?.cursor != null
            ? JSON.stringify(body.cursor)
            : undefined,
    }
  }

  /** v1 原始表分页：服务端忽略 order、页内恒升序；分页 token 从 X-Next-Cursor / Link 头提取 */
  private async fetchV1Page(base: string, encSessionID: string, q: { limit?: number; before?: string }): Promise<ChannelPage> {
    const qs: string[] = []
    if (q.limit !== undefined) qs.push(`limit=${q.limit}`)
    if (q.before) qs.push(`before=${encodeURIComponent(q.before)}`)
    const { body, headers } = await this.httpGetWithHeaders(`${base}/session/${encSessionID}/message${qs.length ? "?" + qs.join("&") : ""}`)
    const arr = Array.isArray(body) ? body : ((body as any)?.messages ?? [])
    let cursor: string | undefined
    const next = headers["x-next-cursor"]
    if (typeof next === "string" && next) cursor = next
    else if (Array.isArray(next) && next.length > 0) cursor = String(next[0])
    else if (headers.link) {
      const m = /<[^>]*before=([^&>]+)[^>]*>;\s*rel="?next"?/.exec(String(headers.link))
      if (m) cursor = decodeURIComponent(m[1])
    }
    return { messages: arr, cursor }
  }

  /** http GET 返回解析后的 JSON body（解析失败时回退原始字符串） */
  private async httpGetJson(urlStr: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr)
      const req = http.request({
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          method: "GET",
          timeout: 120000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => {
          try { resolve(JSON.parse(b)) } catch { resolve(b) }
        })
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")) })
      req.on("error", reject)
      req.end()
    })
  }

  /** http GET 返回 { body, headers } */
  private async httpGetWithHeaders(urlStr: string): Promise<{ body: unknown; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr)
      const req = http.request({
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          method: "GET",
          timeout: 120000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => {
          let parsed: unknown
          try { parsed = JSON.parse(b) } catch { parsed = b }
          resolve({ body: parsed, headers: res.headers as Record<string, string | string[] | undefined> })
        })
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")) })
      req.on("error", reject)
      req.end()
    })
  }

  /**
   * 重命名会话：转发到 serve 的 PATCH /session/{id} body {title}。
   *
   * 改名本身由 opencode serve 完成（持久化 + 广播 session.updated 事件），
   * Bridge 仅转发。之所以不直接调 sdk().v2.session.update：
   * @opencode-ai/sdk 1.18.x 包装层未暴露该方法（生成类型有、运行时原型缺失），
   * 且其生成式调用存在路径占位符 {sessionID} 不被替换的问题（服务端收到
   * 字面量 %7BsessionID%7D 报错）。此处复用 SDK 已配置的 client 直发字面量 URL，
   * 升级 SDK 修复后可换回 sdk().v2.session.update。
   */
  async renameSession(sessionID: string, title: string): Promise<Record<string, unknown>> {
    const result: any = await this.ensureClient().v2.client.patch({
      url: `/session/${encodeURIComponent(sessionID)}`,
      body: { title },
    })
    if (result?.error) {
      throw new Error(result.error.data?.message ?? result.error.message ?? JSON.stringify(result.error))
    }
    return (result?.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>
  }

  /**
   * 新会话自动命名（完整链路）：
   * 在【隔离的临时会话】上用真实会话自己的模型生成标题，避免污染真实会话：
   *   1. 仅当真实会话标题仍为 serve 默认值（未手动命名）时继续；
   *   2. 读取真实会话自身的模型 —— 它刚被用户成功使用过，可用性有保证。
   *      ⚠️ 不能依赖全局 small_model / 默认模型：当其指向的 provider 欠费或失效时
   *      （实测 deepseek 返回 402 Insufficient Balance），serve 的 summarize 与
   *      默认模型回合都会静默产出空回复，标题永远生成不了且无任何错误暴露
   *      （2026-08-25 事故根因）；显式向 summarize 传 model 也被端点忽略。
   *   3. 创建带显式模型的临时会话，经 v1 路由写入标题生成提示词
   *      （该接口会触发一次 agent 回合，assistant 回复即标题）；
   *   4. 轮询读回 assistant 回复并清洗（去引号/前缀/截断）；
   *   5. PATCH 到真实会话（renameSession 同款接口）。
   * 全程 fire-and-forget；失败路径 console.warn 留痕；临时会话在 finally 清理。
   */
  async autoNameNewSession(
    sessionID: string,
    firstMessageText: string,
    directory?: string,
    opts?: { readTimeoutMs?: number },
  ): Promise<boolean> {
    let tempSessionID: string | null = null
    try {
      if (!sessionID || !firstMessageText) return false
      const s = await this.httpGetJson(`${this.baseUrl.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}`) as any
      const title = String(s?.data?.title ?? s?.title ?? "")
      if (!title.startsWith("New session -")) return false

      const model = (s?.data?.model ?? s?.model) as { providerID?: string; id?: string } | undefined
      if (!model?.providerID || !model?.id) {
        console.warn(`[autoName] ${sessionID} 跳过：真实会话缺少模型信息`)
        return false
      }

      tempSessionID = await this.createSessionV2(directory ?? "", { providerID: model.providerID, id: model.id })
      const topic = firstMessageText.replace(/\s+/g, " ").slice(0, 120)
      await this.messageV1(
        tempSessionID,
        `为下面的对话主题生成一个简短标题。要求：不超过16个字，只输出标题本身，不要引号、不要句号、不要任何解释。\n主题：${topic}`,
      )

      const raw = await this.readAssistantReply(tempSessionID, opts?.readTimeoutMs ?? 30000)
      const cleaned = cleanGeneratedTitle(raw)
      if (!cleaned) {
        console.warn(`[autoName] ${sessionID} 失败：临时会话模型无有效输出（model=${model.providerID}/${model.id}）`)
        return false
      }
      await this.renameSession(sessionID, cleaned)
      return true
    } catch (e: any) {
      console.warn(`[autoName] ${sessionID} 失败:`, e?.message ?? e)
      return false
    } finally {
      if (tempSessionID) this.deleteSession(tempSessionID).catch(() => {})
    }
  }

  /** 创建临时会话（用于命名隔离）；可携带显式模型，避免回落到可能欠费的全局默认模型 */
  private async createSessionV2(directory: string, model?: { providerID: string; id: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload: Record<string, unknown> = {}
      if (directory) payload.location = { directory }
      if (model) payload.model = model
      const body = JSON.stringify(payload)
      const url = new URL(this.baseUrl.replace(/\/+$/, "") + "/api/session")
      const req = http.request({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 80,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 30000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => {
          try {
            const j = JSON.parse(b)
            const id = j?.data?.id ?? j?.id
            if (id) resolve(id)
            else reject(new Error("create temp session: no id"))
          } catch { reject(new Error("create temp session: bad response")) }
        })
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("create temp session timeout")) })
      req.on("error", reject)
      req.end(body)
    })
  }

  /** v1 路由写入一条消息（触发一次 agent 回合，assistant 回复即标题来源） */
  private async messageV1(sessionID: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ type: "user", parts: [{ type: "text", text }] })
      const url = new URL(this.baseUrl.replace(/\/+$/, "") + `/session/${encodeURIComponent(sessionID)}/message`)
      const req = http.request({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 80,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 30000,
      }, (res) => {
        res.resume()
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) reject(new Error(`mirror v1 message failed (${res.statusCode})`))
          else resolve()
        })
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("mirror v1 message timeout")) })
      req.on("error", reject)
      req.end(body)
    })
  }

  /** 轮询读取临时会话的 assistant 回复文本（标题生成结果）。
   *  v1 写入触发的 agent 回合是异步完成的，需轮询直到 assistant 出现非空文本或超时。 */
  private async readAssistantReply(sessionID: string, timeoutMs = 30000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const msgs = await this.httpGetJson(`${this.baseUrl.replace(/\/+$/, "")}/session/${encodeURIComponent(sessionID)}/message?limit=10`) as any
        const list: any[] = Array.isArray(msgs) ? msgs : []
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i]
          if ((m?.info?.role ?? m?.role) !== "assistant") continue
          const parts: any[] = m?.parts ?? []
          const text = parts
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
          if (text.trim()) return text
        }
      } catch {
        // 单次轮询失败忽略，继续到超时为止
      }
    }
    return ""
  }

  /** 删除会话（隔离命名用的临时会话清理） */
  private async deleteSession(sessionID: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl.replace(/\/+$/, "") + `/session/${encodeURIComponent(sessionID)}`)
      const req = http.request({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 80,
        path: url.pathname + url.search,
        method: "DELETE",
        timeout: 30000,
      }, (res) => {
        res.resume()
        res.on("end", () => res.statusCode! >= 400 ? reject(new Error(`delete session ${res.statusCode}`)) : resolve())
        res.on("error", reject)
      })
      req.on("timeout", () => { req.destroy(); reject(new Error("delete session timeout")) })
      req.on("error", reject)
      req.end()
    })
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

// ===== 消息归一化 / 选边 / cursor 工具（导出供单元测试） =====

/**
 * HTTP socket 空闲超时判定（导出供单元测试）。
 *
 * SSE 订阅端点（GET /event、GET /global/event）是长连接，事件到达节奏完全
 * 由服务端活动决定——agent 执行长 bash 命令期间可能数分钟无任何事件流过。
 * 若套用普通 RPC 的空闲超时，连接会在静默期被强制断开重连（实测 120s），
 * 断口内产生的事件（如工具终态 tool.success/failed）永久丢失，
 * 手机端对应工具就会永远显示"运行中"。因此流式端点返回 0（禁用空闲超时），
 * 其余端点维持 120s 兜底。
 */
export function resolveHttpIdleTimeoutMs(pathname: string): number {
  const p = pathname.replace(/\/+$/, "").toLowerCase()
  if (p === "/event" || p === "/global/event") return 0
  return 120000
}

type RawMessage = Record<string, any>

/**
 * 清洗模型生成的标题：去"标题："类前缀、首尾引号/句号、取首行、限长。
 * 导出供单元测试。
 */
export function cleanGeneratedTitle(raw: string): string {
  let t = String(raw ?? "").trim()
  if (!t) return ""
  t = t.replace(/^(标题|title)\s*[:：]\s*/i, "")
  t = t.split("\n")[0].trim()
  t = t.replace(/^[「『"'“‘]+/, "").replace(/[」』"'”’。.]+$/g, "").trim()
  if (t.length > 30) t = t.slice(0, 30)
  return t
}

interface ChannelPage { messages: unknown[]; cursor?: string }

function createdOf(m: RawMessage): number {
  const t = m?.info?.time?.created ?? m?.time?.created ?? m?.created
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

function idOf(m: RawMessage): string {
  return String(m?.info?.id ?? m?.id ?? "")
}

/** 升序归一化：按 created 排序；缺失/并列时按 message id 兜底，保证确定性输出 */
export function sortMessagesAsc(messages: unknown[]): unknown[] {
  return [...messages].sort((a, b) => {
    const d = createdOf(a as RawMessage) - createdOf(b as RawMessage)
    if (d !== 0) return d
    return idOf(a as RawMessage).localeCompare(idOf(b as RawMessage))
  })
}

/** 选边：新鲜度(max created)优先 → 数量多者优先 → v1（原始表为权威源兜底） */
export function pickChannel(v1Msgs: unknown[], v2Msgs: unknown[]): "v1" | "v2" {
  const maxCreated = (arr: unknown[]) => arr.reduce((acc, m) => Math.max(acc, createdOf(m as RawMessage)), 0)
  const v1Max = maxCreated(v1Msgs)
  const v2Max = maxCreated(v2Msgs)
  if (v1Max !== v2Max) return v1Max > v2Max ? "v1" : "v2"
  if (v1Msgs.length !== v2Msgs.length) return v1Msgs.length > v2Msgs.length ? "v1" : "v2"
  return "v1"
}

const CURSOR_TAG_V1 = "v1:"
const CURSOR_TAG_V2 = "v2:"

/** cursor 编码来源通道前缀；空 token 不编码（无更多历史） */
export function tagCursor(channel: "v1" | "v2", token?: string): string | undefined {
  return token ? `${channel}:${token}` : undefined
}

/** 解析带通道前缀的 cursor；无前缀/为空返回 null（遗留格式走兼容路径） */
export function parseTaggedCursor(cursor?: string): { channel: "v1" | "v2"; token: string } | null {
  if (typeof cursor !== "string" || !cursor) return null
  if (cursor.startsWith(CURSOR_TAG_V1)) return { channel: "v1", token: cursor.slice(CURSOR_TAG_V1.length) }
  if (cursor.startsWith(CURSOR_TAG_V2)) return { channel: "v2", token: cursor.slice(CURSOR_TAG_V2.length) }
  return null
}

/**
 * 消息记录形态归一化（Bridge 隔离职责的一部分）：
 *   - v1 原始表: { info: {id, role, time}, parts: [...] }（已是规范形态）
 *   - v2 投影表: { id, time:{created}, type, content:[{type,...}], text? }
 *     （字段名不同：type≈role、content≈parts，user 消息还可能只有顶层 text）
 * 统一输出 {info:{id, role, time, ...}, parts:[...]}，客户端无需感知来源通道。
 */
export function normalizeMessageRecord(m: any): any {
  if (!m || typeof m !== "object") return m
  if (m.info && typeof m.info === "object") {
    return { ...m, parts: Array.isArray(m.parts) ? m.parts : [] }
  }
  const role = String(m.type ?? m.role ?? "assistant")
  const time = m.time && typeof m.time === "object" ? m.time : { created: Number(m.created ?? 0) || 0 }
  let parts: any[] = []
  if (Array.isArray(m.content)) {
    parts = m.content.map((c: any) => {
      if (!c || typeof c !== "object") return { type: "text", text: "" }
      const t = String(c.type ?? "text")
      if (t === "text") return { type: "text", text: String(c.text ?? "") }
      // tool / reasoning 等：保留关键结构字段
      return {
        type: t,
        ...(c.id ? { id: c.id } : {}),
        ...(c.name ? { name: c.name } : {}),
        ...(c.state ? { state: c.state } : {}),
        ...(typeof c.text === "string" ? { text: c.text } : {}),
      }
    })
  } else if (typeof m.text === "string" && m.text) {
    parts = [{ type: "text", text: m.text }]
  }
  const info: any = { id: m.id, role, time }
  if (m.agent) info.agent = m.agent
  if (m.model) info.model = m.model
  if (m.sessionID) info.sessionID = m.sessionID
  return { info, parts }
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
