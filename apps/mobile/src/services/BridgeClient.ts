/**
 * BridgeClient — React Native → Bridge 的 WebSocket 客户端
 *
 * 职责：
 * - 管理 WebSocket 生命周期（连接、重连、断开）
 * - 发送 RPC 请求并等待响应（request/response 匹配）
 * - 处理服务端推送的通知帧（onNotification 回调）
 * - 自动处理 token 过期（401 时触发 onAuthExpired）
 *
 * 遵循 SDD 03-architecture-design.md 中的 WS 协议定义
 */
import EventEmitter from 'events'

// ─── 类型定义 ───────────────────────────────────────────

type WSMsgEvent = { data?: string }

export interface BridgeWsFrame {
  type: 'req' | 'res' | 'notify'
  id?: string
  method?: string
  params?: unknown
  ok?: boolean
  error?: string
  payload?: unknown
}

export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** call() 的单次调用选项 */
export interface BridgeCallOptions {
  /** 覆盖默认 requestTimeout 的本次请求超时 (ms)，用于验活等短超时探测 */
  timeoutMs?: number
}

export interface BridgeClientOptions {
  /** Bridge WS URL, 如 ws://192.168.1.100:8080/ws */
  url: string
  /** JWT token */
  token?: string
  /** 自动重连间隔 (ms), 0 表示不重连 */
  reconnectInterval?: number
  /** 请求超时 (ms) */
  requestTimeout?: number
  /** 日志 tag */
  tag?: string
}

export type BridgeClientEvent =
  | 'connected'
  | 'disconnected'
  | 'notification'
  | 'auth_expired'
  | 'error'

// ─── BridgeClient ───────────────────────────────────────

export class BridgeClient {
  private ws: WebSocket | null = null
  private url: string
  private _token: string | undefined
  private reconnectInterval: number
  private requestTimeout: number
  private tag: string

  private requestId = 0
  private pending = new Map<string, PendingRequest>()
  private emitter = new EventEmitter()
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private keepaliveFailures = 0
  /** verifyAlive 并发守卫：回前台事件可能短时间连发 */
  private verifying = false
  private readonly KEEPALIVE_INTERVAL = 30000
  private readonly KEEPALIVE_MAX_FAILURES = 3

  constructor(options: BridgeClientOptions) {
    this.url = options.url
    // 确保 undefined 不变成 "undefined" 字符串
    this._token = options.token || undefined
    this.reconnectInterval = options.reconnectInterval ?? 3000
    this.requestTimeout = options.requestTimeout ?? 30000
    this.tag = options.tag ?? 'BridgeClient'
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get token(): string | undefined {
    return this._token
  }

  // ─── 事件监听 ─────────────────────────────────────────

  on(event: BridgeClientEvent, listener: (...args: any[]) => void): () => void {
    this.emitter.on(event, listener)
    return () => this.emitter.off(event, listener)
  }

  private emit(event: BridgeClientEvent, ...args: any[]): void {
    this.emitter.emit(event, ...args)
  }

  // ─── 连接管理 ─────────────────────────────────────────

  async connect(token?: string): Promise<void> {
    if (token) this._token = token

    // 允许无 token 连接（用于 auth.login），服务器会拒绝非 auth 方法
    const tokenParam = this._token ? `?token=${encodeURIComponent(this._token)}` : ''

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.url}${tokenParam}`
        this.ws = new WebSocket(wsUrl)

        // 连接超时（移动网络不稳定场景）
        const connectTimer = setTimeout(() => {
          this.ws?.close()
          this.ws = null
          reject(new Error(`BridgeClient: 连接超时 (${this.requestTimeout}ms)`))
        }, this.requestTimeout)

        this.ws.onopen = () => {
          clearTimeout(connectTimer)
          console.log(`[${this.tag}] 已连接`)
          this.emit('connected')
          this.startKeepalive()
          resolve()
        }

        this.ws.onmessage = (event: WSMsgEvent) => {
          try {
            const frame: BridgeWsFrame = JSON.parse(event.data as string)
            this.handleFrame(frame)
          } catch (e) {
            console.error(`[${this.tag}] 消息解析失败:`, e)
          }
        }

        this.ws.onclose = (event: WebSocketCloseEvent) => {
          console.log(`[${this.tag}] 断开 (code=${event.code})`)
          this.stopKeepalive()
          // 拒绝所有待处理请求（避免用户等待 30s 超时）
          for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer)
            pending.reject(new Error('BridgeClient: 连接已断开'))
          }
          this.pending.clear()
          this.ws = null
          this.emit('disconnected', event.code)

          // 4001 → token 过期，不自动重连（会死循环），由外部 auth_expired 处理
          if (event.code === 4001) {
            this.emit('auth_expired')
            return
          }

          // 自动重连（仅非认证失败场景）
          if (!this.destroyed && this.reconnectInterval > 0) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (err: Event) => {
          clearTimeout(connectTimer)
          console.error(`[${this.tag}] WS 错误:`, err)
          this.emit('error', err)
          reject(err)
        }
      } catch (e) {
        reject(e)
      }
    })
  }

  disconnect(): void {
    this.destroyed = true
    this.stopKeepalive()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  // ─── RPC 调用 ─────────────────────────────────────────

  async call<T = unknown>(method: string, params: unknown = {}, options?: BridgeCallOptions): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('BridgeClient: 未连接')
    }

    const id = String(++this.requestId)
    const frame: BridgeWsFrame = { type: 'req', id, method, params }
    const timeoutMs = options?.timeoutMs ?? this.requestTimeout

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`BridgeClient: 请求超时 (${method})`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject: reject as (reason: Error) => void,
        timer,
      })

      this.ws!.send(JSON.stringify(frame))
    })
  }

  // ─── 帧处理 ────────────────────────────────────────────

  private handleFrame(frame: BridgeWsFrame): void {
    if (frame.type === 'res' && frame.id) {
      const pending = this.pending.get(frame.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(frame.id)
        if (frame.ok) {
          pending.resolve(frame.payload)
        } else {
          pending.reject(new Error(frame.error ?? 'RPC 错误'))
        }
      }
    } else if (frame.type === 'notify') {
      this.emit('notification', frame.method, frame.payload)
    }
  }

  // ─── 保活 ──────────────────────────────────────────────

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveFailures = 0
    this.keepaliveTimer = setInterval(async () => {
      try {
        await this.call('health.ping', {})
        this.keepaliveFailures = 0
      } catch {
        this.keepaliveFailures++
        if (this.keepaliveFailures >= this.KEEPALIVE_MAX_FAILURES) {
          console.warn(`[${this.tag}] 保活失败 ${this.keepaliveFailures} 次，触发重连`)
          // 软重连：只关 socket、保留重连资格。
          // 绝不能走 disconnect()——它置 destroyed=true，而 scheduleReconnect
          // 与 onclose 的重连守卫都检查 !destroyed，会导致连接永久死亡、
          // App 静默失联（事件再也不达，工具永远显示运行中）。
          this.stopKeepalive()
          try { this.ws?.close() } catch {}
          this.ws = null
          this.scheduleReconnect()
        }
      }
    }, this.KEEPALIVE_INTERVAL)
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    this.keepaliveFailures = 0
  }

  // ─── 重连 ──────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    console.log(`[${this.tag}] ${this.reconnectInterval}ms 后重连...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.destroyed && this._token) {
        this.connect().catch((e) => {
          console.error(`[${this.tag}] 重连失败:`, e)
        })
      }
    }, this.reconnectInterval)
  }

  /**
   * 立即重连——跳过退避等待。
   *
   * 由 AppProvider 在 AppState 回到前台时调用：后台期间系统可能已掐断 socket，
   * 用户回前台时应立刻发起握手，而不是等 reconnectInterval 定时器到点（~3s）
   * 或保活连续失败验尸（最长 ~90s）。3s 退避机制保留，仅作为连不上时的重试节奏。
   */
  reconnectNow(): void {
    if (this.destroyed || this.connected) return
    // 已在握手中不重复开新 socket（CONNECTING 在测试 mock 中可能未定义，回退 0）
    const CONNECTING = (WebSocket as unknown as { CONNECTING?: number }).CONNECTING ?? 0
    if (this.ws && this.ws.readyState === CONNECTING) return
    // 作废挂起的退避定时器，避免稍后再重复拨号
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this._token) {
      this.connect().catch((e) => {
        console.warn(`[${this.tag}] 立即重连失败:`, e)
      })
    }
  }

  /**
   * 验活——探测"僵尸半开"socket。
   *
   * 回前台时 socket 可能处于半开状态：readyState 仍为 OPEN 但实际已死
   * （系统断网未挥手）。发一个短超时 ping 探测，失败立即走软重连，
   * 避免等待保活连续 3 次失败（最长 ~90s）才发现。
   */
  async verifyAlive(timeoutMs = 5000): Promise<void> {
    if (!this.connected || this.verifying || this.destroyed) return
    this.verifying = true
    try {
      await this.call('health.ping', {}, { timeoutMs })
      // 存活：无需处理
    } catch {
      if (!this.destroyed && !this.connected) return // 已被并发路径接管
      if (this.destroyed) return
      console.warn(`[${this.tag}] 验活失败，socket 半开，触发立即重连`)
      // 软重连：只关 socket、保留重连资格；reconnectNow 清掉 onclose 排的
      // 退避定时器并立即拨号
      this.stopKeepalive()
      try { this.ws?.close() } catch {}
      this.ws = null
      this.reconnectNow()
    } finally {
      this.verifying = false
    }
  }

  // ─── 销毁 ──────────────────────────────────────────────

  destroy(): void {
    this.disconnect()
    this.emitter.removeAllListeners()

    // 拒绝所有待处理请求
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('BridgeClient: 已销毁'))
    }
    this.pending.clear()
  }

  // ─── 文件操作 ─────────────────────────────────────────

  async listFiles(path: string): Promise<Array<{
    name: string
    type: 'file' | 'directory' | 'symlink'
    size: number
    modified: string
    permissions: string
  }>> {
    return this.call('file.list', { path })
  }

  async readFile(path: string, encoding?: string): Promise<{
    content: string
    encoding: string
    size: number
    path: string
    base64?: boolean
    mimeType?: string
  }> {
    return this.call('file.read', { path, encoding })
  }

  async searchFiles(
    query: string,
    options?: { pattern?: string; dirs?: string[]; limit?: number }
  ): Promise<Array<{
    file: string
    line: number
    content: string
    match?: string
  }>> {
    return this.call('file.search', { query, ...options })
  }

  async getFileInfo(path: string): Promise<{
    name: string
    type: 'file' | 'directory' | 'symlink'
    size: number
    modified: string
    permissions: string
  }> {
    return this.call('file.info', { path })
  }
}
