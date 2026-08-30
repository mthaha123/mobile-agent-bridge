/**
 * sessionStore — 会话列表状态管理
 *
 * 管理与 OpenCode 的对话会话列表
 */
import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'
import { useQuestionStore } from './questionStore'

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

/** 将 SDK Session（title / time.created / time.updated / model）映射为 App Session（name / createdAt / updatedAt / model） */
function mapSession(raw: any): Session {
  if (!raw || typeof raw !== 'object') {
    return { id: '', name: '', createdAt: '', updatedAt: '', messageCount: 0 }
  }
  const time = raw.time || {}
  const rawModel = raw.model
  let model: Session['model']
  if (rawModel && typeof rawModel === 'object') {
    model = {
      id: String(rawModel.id || ''),
      providerID: String(rawModel.providerID || ''),
      name: typeof rawModel.name === 'string' ? rawModel.name : '',
      variant: typeof rawModel.variant === 'string' ? rawModel.variant : undefined,
    }
  }
  return {
    id: raw.id || '',
    name: raw.title || raw.name || `Session ${String(raw.id || '').slice(0, 8)}`,
    createdAt: raw.createdAt || (time.created ? new Date(time.created).toISOString() : ''),
    updatedAt: raw.updatedAt || (time.updated ? new Date(time.updated).toISOString() : ''),
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
    model,
    // 会话当前 agent（服务端权威；未显式指定时服务端不返回该字段 → undefined）
    agent: typeof raw.agent === 'string' && raw.agent ? raw.agent : undefined,
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

/**
 * 从 SDK v2 message 记录（{ info, parts }）提取文本与角色。
 * v2 结构: { info: { id, sessionID, role, time }, parts: [{ type:'text', text }] }
 */
function extractV2MessageText(m: any): string {
  const parts = Array.isArray(m.parts) ? m.parts : []
  return parts
    .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('')
}

export interface Session {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model?: { id: string; providerID?: string; name?: string; variant?: string }
  /** 会话当前 agent（服务端权威值）；会话未显式指定 agent 时为空 */
  agent?: string
}

/**
 * 按 id 或名称对会话列表做不区分大小写的子串模糊匹配。
 * 空查询返回原列表（同一引用，便于调用方判断是否处于搜索态）。
 * 多关键词可用空格分隔，全部命中才算匹配（AND 语义）。
 */
export function filterSessions(sessions: Session[], query: string): Session[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  const keywords = q.split(/\s+/)
  return sessions.filter((s) => {
    const haystack = `${s.name || ''}\n${s.id || ''}`.toLowerCase()
    return keywords.every((k) => haystack.includes(k))
  })
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
  renameSession: (id: string, title: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<Session | null>

  // Advanced session operations
  getSession: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<Session | null>
  getSessionMessages: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>, opts?: { limit?: number; cursor?: string }) => Promise<any>
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
      // 清理"会话已不存在"的待回答提问残留（会话被删/换项目后，弹框无从回答）。
      // 误删是安全的：若服务端其实仍在等（如不在根列表里的 fork/子会话），
      // 下一次 question.list 对账会把它补回来。
      const ids = new Set(sessions.map((s) => s.id))
      const q = useQuestionStore.getState()
      if (ids.size > 0) {
        for (const item of q.pending) {
          if (!ids.has(item.sessionId)) q.removeQuestion(item.id)
        }
      }
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取会话列表失败' })
    }
  },

  createSession: async (clientCall) => {
    set({ error: null })
    try {
      // 新会话默认值：客户端本地偏好优先，未配置则空参由服务端兜底
      // （bridge session.create 原生支持 agent/model 参数）
      const { defaultAgent, defaultModel } = useSettingsStore.getState()
      const params: Record<string, unknown> = {}
      if (defaultAgent) params.agent = defaultAgent
      if (defaultModel?.id && defaultModel?.providerID) {
        params.model = defaultModel.variant
          ? { id: defaultModel.id, providerID: defaultModel.providerID, variant: defaultModel.variant }
          : { id: defaultModel.id, providerID: defaultModel.providerID }
      }
      const result = await clientCall('session.create', params)
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

  renameSession: async (id, title, clientCall) => {
    const trimmed = title.trim()
    if (!id || !trimmed) return null
    set({ error: null })
    try {
      // 服务端权威结果（bridge → SDK v2 PATCH /session/{id}），成功后本地即时更新标题；
      // 响应缺 title 时回退本地输入（mapSession 会生成占位名，不能直接用）
      const result = await clientCall('session.rename', { sessionId: id, title: trimmed })
      const raw = normalizeItem<any>(result, 'session')
      const newName = (typeof raw?.title === 'string' && raw.title) || (typeof raw?.name === 'string' && raw.name) || trimmed
      get().patchSession(id, { name: newName })
      return useSessionStore.getState().sessions.find((s) => s.id === id) ?? null
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '重命名失败' })
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

  getSessionMessages: async (id, clientCall, opts?: { limit?: number; cursor?: string }) => {
    set({ error: null })
    try {
      const params: Record<string, unknown> = { sessionId: id }
      if (opts?.limit !== undefined) params.limit = opts.limit
      if (opts?.cursor) params.cursor = opts.cursor
      const result = await clientCall('session.messages', params)
      // 兼容两种响应：数组 或 { messages/data, cursor }
      const raw = normalizeArray<any>(result, 'messages')
      const mapped = raw
        .filter((m) => m && typeof m === 'object')
        .map((m) => {
          // SDK v2 message 记录: { info: { id, role }, parts: [{ type:'text', text }] }
          if (m.info && typeof m.info === 'object') {
            const info = m.info as Record<string, unknown>
            const text = extractV2MessageText(m)
            const time = (info.time as Record<string, unknown>) ?? m.time
            // 拍平 created（ms）：日期分隔符与时间显示依赖此字段
            const created = time ? (time as { created?: number }).created : undefined
            return {
              id: (info.id as string) || m.id,
              role: info.role as string,
              content: text,
              text,
              rawContent: m.parts ?? text,
              time,
              created,
            }
          }
          const role = m.role || m.type
          const content = extractMessageText(m)
          const t = m.time as { created?: number } | undefined
          return { id: m.id, role, content, text: content, rawContent: Array.isArray(m.content) ? m.content : (typeof m.content === 'string' ? m.content : (typeof m.text === 'string' ? m.text : content)), time: m.time, created: t?.created }
        })
        .filter((m) => m.role === 'user' || m.role === 'assistant')
      // bridge 统一输出升序（旧→新）的 {info, parts} 消息，App 直接渲染，无需反转。
      const list = mapped
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
      // 服务端已生效 → 本地即时回写，UI（SlashSheet 当前项标记）无需等下次列表刷新
      get().patchSession(id, { agent })
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
