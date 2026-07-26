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
  deleteSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>

  // Advanced session operations
  getSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<Session | null>
  getSessionMessages: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<any[]>
  renameSession: (id: string, name: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  getSessionTodo: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<any[]>
  getSessionDiff: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<any[]>
  forkSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<string | null>
  revertSession: (id: string, messageID: string, partID: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  unrevertSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
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
      const sessions = normalizeArray<Session>(result, 'sessions')
      set({ sessions, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取会话列表失败' })
    }
  },

  createSession: async (clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.create', {})
      const session = normalizeItem<Session>(result, 'session')
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

  deleteSession: async (id, clientCall) => {
    set({ error: null })
    try {
      await clientCall('session.delete', { sessionId: id })
      get().removeSession(id)
    } catch (e: unknown) {
      console.warn('session.delete not supported:', e instanceof Error ? e.message : e)
    }
  },

  // ---------------------------------------------------------------------------
  // Advanced session operations
  // ---------------------------------------------------------------------------

  getSession: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.get', { sessionId: id })
      const session = normalizeItem<Session>(result, 'session')
      return session?.id ? session : null
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '获取会话失败' })
      return null
    }
  },

  getSessionMessages: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.messages', { sessionId: id })
      return normalizeArray<any>(result, 'messages')
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '获取会话消息失败' })
      return []
    }
  },

  renameSession: async (id, name, clientCall) => {
    try {
      await clientCall('session.rename', { sessionId: id, name })
    } catch (e: unknown) {
      console.warn('session.rename failed:', e instanceof Error ? e.message : e)
    }
  },

  getSessionTodo: async (id, clientCall) => {
    try {
      const result = await clientCall('session.todo', { sessionId: id })
      return normalizeArray<any>(result, 'todos')
    } catch (e: unknown) {
      console.warn('session.todo failed:', e instanceof Error ? e.message : e)
      return []
    }
  },

  getSessionDiff: async (id, clientCall) => {
    try {
      const result = await clientCall('session.diff', { sessionId: id })
      return normalizeArray<any>(result, 'diffs')
    } catch (e: unknown) {
      console.warn('session.diff failed:', e instanceof Error ? e.message : e)
      return []
    }
  },

  forkSession: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = await clientCall('session.fork', { sessionId: id })
      if (typeof result === 'string') return result || null
      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>
        return (obj.sessionId as string) ?? (obj.sessionID as string) ?? null
      }
      return null
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '复刻会话失败' })
      return null
    }
  },

  revertSession: async (id, messageID, partID, clientCall) => {
    try {
      await clientCall('session.revert', { sessionId: id, messageID, partID })
    } catch (e: unknown) {
      console.warn('session.revert failed:', e instanceof Error ? e.message : e)
    }
  },

  unrevertSession: async (id, clientCall) => {
    try {
      await clientCall('session.unrevert', { sessionId: id })
    } catch (e: unknown) {
      console.warn('session.unrevert failed:', e instanceof Error ? e.message : e)
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
