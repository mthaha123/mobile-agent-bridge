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
import { EventEmitter } from 'events'

// ─── 类型定义 ───────────────────────────────────────────

export interface BridgeWsFrame {
  type: 'req' | 'res' | 'notify'
  id?: string
  method?: string
  ok?: boolean
  error?: string
  payload?: unknown
}

export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
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

  constructor(options: BridgeClientOptions) {
    this.url = options.url
    this._token = options.token
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

    if (!this._token) {
      throw new Error('BridgeClient: token 未设置，请先 login')
    }

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.url}?token=${encodeURIComponent(this._token!)}`
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log(`[${this.tag}] 已连接`)
          this.emit('connected')
          resolve()
        }

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const frame: BridgeWsFrame = JSON.parse(event.data as string)
            this.handleFrame(frame)
          } catch (e) {
            console.error(`[${this.tag}] 消息解析失败:`, e)
          }
        }

        this.ws.onclose = (event: WebSocketCloseEvent) => {
          console.log(`[${this.tag}] 断开 (code=${event.code})`)
          this.ws = null
          this.emit('disconnected', event.code)

          // 401 → token 过期
          if (event.code === 4001) {
            this.emit('auth_expired')
          }

          // 自动重连
          if (!this.destroyed && this.reconnectInterval > 0) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (err: Event) => {
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  // ─── RPC 调用 ─────────────────────────────────────────

  async call(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('BridgeClient: 未连接')
    }

    const id = String(++this.requestId)
    const frame: BridgeWsFrame = { type: 'req', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`BridgeClient: 请求超时 (${method})`))
      }, this.requestTimeout)

      this.pending.set(id, {
        resolve,
        reject,
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
}
