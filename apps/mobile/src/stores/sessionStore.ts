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

  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  updateSession: (id: string, updates: Partial<Session>) => void
  setLoading: (l: boolean) => void
  fetchSessions: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  createSession: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<string | null>
  deleteSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),
  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
    })),
  setLoading: (loading) => set({ loading }),

  fetchSessions: async (clientCall) => {
    set({ loading: true })
    try {
      const result = (await clientCall('session.list', {})) as {
        sessions: Session[]
      }
      set({ sessions: result.sessions ?? [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createSession: async (clientCall) => {
    try {
      const result = (await clientCall('session.create', {})) as {
        session: Session
      }
      if (result.session) {
        get().addSession(result.session)
        return result.session.id
      }
      return null
    } catch {
      return null
    }
  },

  deleteSession: async (id, clientCall) => {
    try {
      await clientCall('session.delete', { sessionID: id })
      get().removeSession(id)
    } catch {
      // ignore
    }
  },
}))
