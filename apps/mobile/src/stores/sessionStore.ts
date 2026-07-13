/**
 * sessionStore — 会话列表状态管理
 *
 * 管理与 OpenCode 的对话会话列表
 */
import { create } from 'zustand'

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
  updateSession: (id: string, title: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  renameSession: (id: string, name: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  getSessionTodo: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<any[]>
  getSessionDiff: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<any[]>
  forkSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<string | null>
  revertSession: (id: string, messageID: string, partID: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  unrevertSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
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
      const result = (await clientCall('session.list', {})) as
        | { sessions: Session[] }
        | Session[]
      // v2 返回数组，v1 返回 { sessions }
      const sessions = Array.isArray(result) ? result : (result as any).sessions ?? []
      set({ sessions, loading: false })
    } catch (e: any) {
      set({ loading: false, error: e.message || '获取会话列表失败' })
    }
  },

  createSession: async (clientCall) => {
    set({ error: null })
    try {
      const result = (await clientCall('session.create', {})) as
        | { session: Session }
        | Session
      // v2 直接返回 session 对象，v1 返回 { session }
      const session = (result as any).session ?? result
      if (session && (session as Session).id) {
        get().addSession(session as Session)
        return (session as Session).id
      }
      return null
    } catch (e: any) {
      set({ error: e.message || '创建会话失败' })
      return null
    }
  },

  deleteSession: async (id, clientCall) => {
    set({ error: null })
    try {
      await clientCall('session.delete', { sessionId: id })
      get().removeSession(id)
    } catch (e: any) {
      // v2 暂不支持 delete，静默忽略
      console.warn('session.delete not supported:', e.message)
    }
  },

  // ---------------------------------------------------------------------------
  // Advanced session operations
  // ---------------------------------------------------------------------------

  getSession: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = (await clientCall('session.get', { sessionId: id })) as
        | { session: Session }
        | Session
      const session = (result as any).session ?? result
      return (session as Session)?.id ? (session as Session) : null
    } catch (e: any) {
      set({ error: e.message || '获取会话失败' })
      return null
    }
  },

  getSessionMessages: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = (await clientCall('session.messages', { sessionId: id })) as
        | { messages: any[] }
        | any[]
      return Array.isArray(result) ? result : (result as any).messages ?? []
    } catch (e: any) {
      set({ error: e.message || '获取会话消息失败' })
      return []
    }
  },

  updateSession: async (id, title, clientCall) => {
    try {
      await clientCall('session.update', { sessionId: id, title })
    } catch (e: any) {
      console.warn('session.update failed:', e.message)
    }
  },

  renameSession: async (id, name, clientCall) => {
    try {
      await clientCall('session.rename', { sessionId: id, name })
    } catch (e: any) {
      console.warn('session.rename failed:', e.message)
    }
  },

  getSessionTodo: async (id, clientCall) => {
    try {
      const result = (await clientCall('session.todo', { sessionId: id })) as
        | { todos: any[] }
        | any[]
      return Array.isArray(result) ? result : (result as any).todos ?? []
    } catch (e: any) {
      console.warn('session.todo failed:', e.message)
      return []
    }
  },

  getSessionDiff: async (id, clientCall) => {
    try {
      const result = (await clientCall('session.diff', { sessionId: id })) as
        | { diffs: any[] }
        | any[]
      return Array.isArray(result) ? result : (result as any).diffs ?? []
    } catch (e: any) {
      console.warn('session.diff failed:', e.message)
      return []
    }
  },

  forkSession: async (id, clientCall) => {
    set({ error: null })
    try {
      const result = (await clientCall('session.fork', { sessionId: id })) as
        | { sessionId: string }
        | string
      const newId = typeof result === 'string' ? result : (result as any).sessionId ?? (result as any).sessionID ?? null
      return newId || null
    } catch (e: any) {
      set({ error: e.message || '复刻会话失败' })
      return null
    }
  },

  revertSession: async (id, messageID, partID, clientCall) => {
    try {
      await clientCall('session.revert', { sessionId: id, messageID, partID })
    } catch (e: any) {
      console.warn('session.revert failed:', e.message)
    }
  },

  unrevertSession: async (id, clientCall) => {
    try {
      await clientCall('session.unrevert', { sessionId: id })
    } catch (e: any) {
      console.warn('session.unrevert failed:', e.message)
    }
  },
}))
