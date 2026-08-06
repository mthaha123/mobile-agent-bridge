/**
 * sessionStore — 会话列表状态管理
 *
 * 管理与 OpenCode 的对话会话列表
 */
import { create } from 'zustand'

function normalizeArray<T>(result: unknown, key: string): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object') {
    const v = (result as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v as T[]
  }
  return []
}

function normalizeItem<T>(result: unknown, key: string): T | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>
    if (key in obj) return obj[key] as T
    return result as T
  }
  return result as T ?? null
}

/** 将 SDK Session（title / time.created / time.updated）映射为 App Session（name / createdAt / updatedAt） */
function mapSession(raw: any): Session {
  if (!raw || typeof raw !== 'object') {
    return { id: '', name: '', createdAt: '', updatedAt: '', messageCount: 0 }
  }
  const time = raw.time || {}
  return {
    id: raw.id || '',
    name: raw.name || raw.title || `Session ${String(raw.id || '').slice(0, 8)}`,
    createdAt: raw.createdAt || (time.created ? new Date(time.created).toISOString() : ''),
    updatedAt: raw.updatedAt || (time.updated ? new Date(time.updated).toISOString() : ''),
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
  }
}

/** 从 SDK 消息事件对象提取纯文本：content 数组取 text part，否则用 text/content 字符串 */
function extractMessageText(m: any): string {
  if (Array.isArray(m.content)) {
    return m.content
      .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('')
  }
  if (typeof m.text === 'string') return m.text
  if (typeof m.content === 'string') return m.content
  return ''
}

export interface Session {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionState {
  sessions: Session[]
  loading: boolean
  error: string | null

  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  patchSession: (id: string, updates: Partial<Session>) => void
  setLoading: (l: boolean) => void
  setError: (e: string | null) => void
  clearError: () => void
  fetchSessions: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  createSession: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<string | null>

  // Advanced session operations
  getSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<Session | null>
  getSessionMessages: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }) => Promise<any>
  revertSession: (id: string, messageID: string, partID: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  switchAgent: (id: string, agent: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  switchModel: (id: string, model: string | { id: string; providerID: string; variant?: string }, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),
  patchSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),

  fetchSessions: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('session.list', {})
      const sessions = normalizeArray<Session>(result, 'sessions').map(mapSession)
      set({ sessions, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取会话列表失败' })
    }
  },

  createSession: async (clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.create', {})
      const session = mapSession(normalizeItem<Session>(result, 'session'))
      if (session?.id) {
        get().addSession(session)
        return session.id
      }
      return null
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '创建会话失败' })
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // Advanced session operations
  // ---------------------------------------------------------------------------

  getSession: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.get', { sessionId: id })
      const session = mapSession(normalizeItem<Session>(result, 'session'))
      return session?.id ? session : null
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '获取会话失败' })
      return null
    }
  },

  getSessionMessages: async (id, clientCall, opts?: { limit?: number; order?: 'asc' | 'desc'; cursor?: string }) => {
    set({ error: null })
    try {
      const params: Record<string, unknown> = { sessionId: id }
      if (opts?.limit !== undefined) params.limit = opts.limit
      if (opts?.order) params.order = opts.order
      if (opts?.cursor) params.cursor = opts.cursor
      const result = await clientCall('session.messages', params)
      // 兼容两种响应：数组 或 { messages/data, cursor }
      const raw = normalizeArray<any>(result, 'messages')
      const mapped = raw
        .filter((m) => m && typeof m === 'object')
        .map((m) => {
          const role = m.role || m.type
          const content = extractMessageText(m)
          return { id: m.id, role, content, text: content, rawContent: Array.isArray(m.content) ? m.content : (typeof m.content === 'string' ? m.content : (typeof m.text === 'string' ? m.text : content)) }
        })
        .filter((m) => m.role === 'user' || m.role === 'assistant')
      // 真实 SDK 默认返回最新在前（desc）的事件对象（带 type 字段）。
      // 显式 asc 时返回时间正序；仅非 asc（desc/默认）且为 SDK 事件格式时才反转成正序。
      const isSdkEventFormat = raw.some((m) => m && typeof m.type === 'string')
      const list = (opts?.order !== 'asc' && isSdkEventFormat) ? mapped.reverse() : mapped
      const cursor = result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>).cursor
        : undefined
      return { messages: list, cursor }
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '获取会话消息失败' })
      return { messages: [], cursor: undefined }
    }
  },

  revertSession: async (id, messageID, partID, clientCall) => {
    try {
      await clientCall('session.revert', { sessionId: id, messageID, partID })
    } catch (e: unknown) {
      console.warn('session.revert failed:', e instanceof Error ? e.message : e)
    }
  },

  switchAgent: async (id, agent, clientCall) => {
    set({ error: null })
    try {
      await clientCall('session.switchAgent', { sessionId: id, agent })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '切换 Agent 失败' })
    }
  },

  switchModel: async (id, model, clientCall) => {
    set({ error: null })
    try {
      await clientCall('session.switchModel', { sessionId: id, model })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '切换模型失败' })
    }
  },
}))
