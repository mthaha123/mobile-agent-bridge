import { create } from 'zustand'
import type { Part } from '../types/message'

// ─── 新数据模型 ────────────────────────────────────────────

export interface ChatMessage {
  id: string
  messageID?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 流式进行中 / 已完结 */
  status?: 'streaming' | 'complete'
  /** 文本流缓冲内聚到消息本身（替代旧全局 streamStates） */
  deltaBuffer?: Record<number, string>
  lastAppliedDeltaId?: number
  parts?: Part[]
  timestamp: number
  created?: number
  agent?: string
  /** @deprecated 旧版消息 partID，保留兼容 */
  partID?: string
}

export type ToolStatus = 'called' | 'progress' | 'success' | 'failed' | 'rejected' | 'cancelled'

/** 工具 part 的 data 形态（Part.data 是 Record<string, unknown>，读取时按此断言） */
export interface ToolPartData {
  tool: string
  input: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
  outputPaths?: string[]
}

/** addMessage 接受宽松消息草稿：role 必填，其余可选 */
export type NewChatMessage = Pick<ChatMessage, 'role'> & Partial<Omit<ChatMessage, 'id' | 'timestamp' | 'role'>>

type ClientCall = (method: string, params?: unknown) => Promise<unknown>

/** 事件静默兜底：超过该时长无任何事件，强制回到 idle */
const ACTIVITY_TTL = 5 * 60 * 1000

let msgCounter = 0

function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`
}

/** 把新消息插入正确的时序位置（按 timestamp 查找第一个比其更新的消息，插到它前面） */
function insertChronologically(messages: ChatMessage[], newMsg: ChatMessage): ChatMessage[] {
  if (messages.length === 0) return [newMsg]
  const ts = newMsg.timestamp
  const idx = messages.findIndex((m) => m.timestamp > ts)
  const result = [...messages]
  if (idx < 0) result.push(newMsg)
  else result.splice(idx, 0, newMsg)
  return result
}

/** 仅重建受影响索引处的消息引用，其余引用原样保留（保住 memo 收益） */
function replaceAt(messages: ChatMessage[], idx: number, msg: ChatMessage): ChatMessage[] {
  const copy = [...messages]
  copy[idx] = msg
  return copy
}

function normalizeToolPartData(p: Part): ToolPartData {
  return p.data as ToolPartData
}

// ─── 文本流 reducer ────────────────────────────────────────

function ensureAssistant(messages: ChatMessage[], messageID?: string): ChatMessage[] {
  if (!messageID) return messages
  if (messages.some((m) => m.messageID === messageID)) return messages
  return [...messages, {
    id: nextId(),
    role: 'assistant',
    content: '',
    status: 'streaming',
    parts: [],
    timestamp: Date.now(),
    messageID,
  }]
}

/** 按 messageID 追加文本增量；eventId 为数字时走 deltaBuffer/lastAppliedDeltaId 乱序缓冲 */
function applyTextDelta(messages: ChatMessage[], messageID: string, delta: string, eventId: number | string): ChatMessage[] {
  if (!messageID) return messages
  let idx = messages.findIndex((m) => m.messageID === messageID)
  let base: ChatMessage[]
  if (idx < 0) {
    base = [...messages, {
      id: nextId(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      parts: [],
      timestamp: Date.now(),
      messageID,
    }]
    idx = base.length - 1
  } else {
    base = messages
  }
  const msg = base[idx]
  const applied = (m: ChatMessage) => ({ ...m, status: 'streaming' as const })

  if (typeof eventId === 'number') {
    const lastApplied = msg.lastAppliedDeltaId ?? -1
    if (eventId <= lastApplied) return base === messages ? messages : base
    const buffer = msg.deltaBuffer ?? {}
    if (lastApplied === -1 || eventId === lastApplied + 1) {
      let content = msg.content + delta
      let appliedId = eventId
      while (buffer[appliedId + 1] !== undefined) {
        content += buffer[appliedId + 1]
        appliedId++
      }
      const leftover: Record<number, string> = {}
      for (const k of Object.keys(buffer)) {
        const n = Number(k)
        if (n > appliedId) leftover[n] = buffer[n]
      }
      return replaceAt(base, idx, {
        ...applied(msg),
        content,
        lastAppliedDeltaId: appliedId,
        deltaBuffer: Object.keys(leftover).length > 0 ? leftover : undefined,
      })
    }
    return replaceAt(base, idx, {
      ...msg,
      deltaBuffer: { ...buffer, [eventId]: delta },
    })
  }
  // 字符串/缺失 eventId（SDK v3 evt_）→ 按到达顺序追加
  return replaceAt(base, idx, { ...applied(msg), content: msg.content + delta })
}

/** text.ended 权威全文覆盖；找不到 messageID 时回退到最后一条 assistant */
function finalizeText(messages: ChatMessage[], messageID: string, fullText: string): ChatMessage[] {
  let idx = messages.findIndex((m) => m.messageID === messageID)
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        idx = i
        break
      }
    }
  }
  if (idx >= 0) {
    const cur = messages[idx]
    if (cur.content === fullText && cur.status === 'complete' && !cur.deltaBuffer) return messages
    return replaceAt(messages, idx, {
      ...cur,
      content: fullText,
      status: 'complete',
      messageID: messageID || cur.messageID,
      timestamp: Date.now(),
      deltaBuffer: undefined,
      lastAppliedDeltaId: undefined,
    })
  }
  return [...messages, {
    id: nextId(),
    role: 'assistant',
    content: fullText,
    status: 'complete',
    parts: [],
    timestamp: Date.now(),
    messageID,
  }]
}

// ─── 用户消息 / 权威消息 reducer ───────────────────────────

function upsertUserMessageIn(messages: ChatMessage[], messageID: string, content: string, created?: number): ChatMessage[] {
  if (!messageID) return messages
  const idx = messages.findIndex((m) => m.messageID === messageID)
  if (idx >= 0) {
    const cur = messages[idx]
    if (cur.content === content && cur.created === (created ?? cur.created)) return messages
    return replaceAt(messages, idx, { ...cur, content, created: created ?? cur.created, timestamp: Date.now() })
  }
  // 本地乐观插入的用户消息没有 messageID：用 role+content 匹配后补上 messageID，避免重复
  const localIdx = messages.findIndex((m) => m.role === 'user' && !m.messageID && m.content === content)
  if (localIdx >= 0) {
    const cur = messages[localIdx]
    return replaceAt(messages, localIdx, { ...cur, messageID, created: created ?? cur.created, timestamp: Date.now() })
  }
  return insertChronologically(messages, {
    id: nextId(),
    role: 'user',
    content,
    status: 'complete',
    parts: [],
    timestamp: created ?? Date.now(),
    created,
    messageID,
  })
}

/** 权威全文覆盖：assistant 仅当全文不短于当前累积时覆盖（防打断进行中流式） */
function upsertAuthoritativeMessage(messages: ChatMessage[], role: ChatMessage['role'], messageID: string, content: string, created?: number): ChatMessage[] {
  if (!messageID) return messages
  const idx = messages.findIndex((m) => m.messageID === messageID)
  if (idx >= 0) {
    const cur = messages[idx]
    if (role === 'assistant' && content.length < cur.content.length) return messages
    if (cur.content === content && cur.role === role && cur.created === (created ?? cur.created)) return messages
    return replaceAt(messages, idx, {
      ...cur,
      role,
      content,
      status: 'complete',
      timestamp: Date.now(),
      created: created ?? cur.created,
      deltaBuffer: undefined,
      lastAppliedDeltaId: undefined,
    })
  }
  return insertChronologically(messages, {
    id: nextId(),
    role,
    content,
    status: 'complete',
    parts: [],
    timestamp: created ?? Date.now(),
    created,
    messageID,
  })
}

// ─── 工具 part reducer ─────────────────────────────────────

/** 工具 part 的 id 一律 = callID；按 id 去重合并 */
function upsertToolPart(messages: ChatMessage[], part: Part, assistantMessageId?: string): ChatMessage[] {
  if (!part || !part.id) return messages
  let idx = -1
  if (assistantMessageId) idx = messages.findIndex((m) => m.messageID === assistantMessageId)
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        idx = i
        break
      }
    }
  }
  if (idx < 0) {
    return [...messages, {
      id: nextId(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      parts: [part],
      timestamp: Date.now(),
      messageID: assistantMessageId,
    }]
  }
  const target = messages[idx]
  const parts = target.parts ?? []
  const foundIdx = parts.findIndex((p) => p.id === part.id)
  if (foundIdx >= 0) {
    const merged = { ...parts[foundIdx], data: { ...parts[foundIdx].data, ...part.data } }
    if (JSON.stringify(parts[foundIdx]) === JSON.stringify(merged)) return messages
    const newParts = [...parts]
    newParts[foundIdx] = merged
    return replaceAt(messages, idx, { ...target, parts: newParts })
  }
  return replaceAt(messages, idx, { ...target, parts: [...parts, part] })
}

/** 只重建受影响消息的引用 */
function updateToolPartStatus(messages: ChatMessage[], callID: string, updates: Partial<ToolPartData>): ChatMessage[] {
  if (!callID) return messages
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi]
    const parts = m.parts
    if (!parts || parts.length === 0) continue
    const pi = parts.findIndex((p) => p.id === callID)
    if (pi < 0) continue
    const cur = parts[pi]
    const mergedData = { ...cur.data, ...updates }
    if (JSON.stringify(cur.data) === JSON.stringify(mergedData)) return messages
    const newParts = [...parts]
    newParts[pi] = { ...cur, data: mergedData }
    return replaceAt(messages, mi, { ...m, parts: newParts })
  }
  return messages
}

/** 把某条 assistant 消息下仍未终结（called/progress）的工具 part 标为终结态 */
function markOpenToolsInMessage(messages: ChatMessage[], assistantMessageID: string, status: ToolStatus, extra?: Partial<ToolPartData>): ChatMessage[] {
  if (!assistantMessageID) return messages
  const idx = messages.findIndex((m) => m.messageID === assistantMessageID)
  if (idx < 0) return messages
  const m = messages[idx]
  const parts = m.parts
  if (!parts || parts.length === 0) return messages
  let changed = false
  const newParts = parts.map((p) => {
    if (p.type !== 'tool') return p
    const d = normalizeToolPartData(p)
    if (d.status !== 'called' && d.status !== 'progress') return p
    changed = true
    return { ...p, data: { ...p.data, status, ...(extra ?? {}) } }
  })
  if (!changed) return messages
  return replaceAt(messages, idx, { ...m, parts: newParts })
}

function markAllOpenTools(messages: ChatMessage[], status: ToolStatus): ChatMessage[] {
  let changed = false
  const result = messages.map((m) => {
    if (!m.parts || m.parts.length === 0) return m
    const newParts = m.parts.map((p) => {
      if (p.type !== 'tool') return p
      const d = normalizeToolPartData(p)
      if (d.status !== 'called' && d.status !== 'progress') return p
      changed = true
      return { ...p, data: { ...p.data, status } }
    })
    return newParts === m.parts ? m : { ...m, parts: newParts }
  })
  return changed ? result : messages
}

// ─── 加载消息归一化 ────────────────────────────────────────

interface LoadedMessage {
  role?: string
  messageID?: string
  id?: string
  content?: string
  text?: string
  timestamp?: number
  created?: number
  parts?: Part[]
  info?: Record<string, unknown>
  [key: string]: unknown
}

function extractPartsText(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('')
}

function buildPartsFromLoaded(parts: unknown): Part[] {
  if (!Array.isArray(parts)) return []
  const out: Part[] = []
  parts.forEach((p: any) => {
    if (!p || typeof p !== 'object') return
    if (p.type === 'text') {
      const t = p.text || ''
      out.push({ id: p.id || `t_${Date.now()}_${out.length}`, type: 'text', data: { content: t } })
    } else if (p.type === 'tool') {
      const state = p.state ?? {}
      const st = state.status === 'error' ? 'failed'
        : state.status === 'completed' ? 'success'
        : (state.status || 'called')
      const result = Array.isArray(state.content)
        ? state.content.filter((c: any) => c && typeof c.text === 'string').map((c: any) => c.text).join('')
        : (typeof state.output === 'string' ? state.output
          : (state.output && typeof state.output === 'object' ? JSON.stringify(state.output) : ''))
      out.push({
        id: p.id || p.callID || `tool_${Date.now()}_${out.length}`,
        type: 'tool',
        data: {
          tool: p.name || p.tool || p.state?.title || '',
          input: p.state?.input ?? p.input ?? {},
          status: st,
          result,
          error: p.state?.error ?? undefined,
        },
      })
    } else if (p.type === 'reasoning') {
      out.push({ id: p.id || `r_${Date.now()}_${out.length}`, type: 'reasoning', data: { content: p.text || '' } })
    }
  })
  return out
}

/** 兼容 v2 {info, parts} 与旧 {id, role, content} 两种消息结构 */
function normalizeLoadedMessage(raw: LoadedMessage): LoadedMessage {
  const m = raw
  if (m && typeof m === 'object' && m.info && typeof m.info === 'object' && !Array.isArray(m.info)) {
    const info = m.info as Record<string, any>
    const text = extractPartsText(m.parts)
    const parts = buildPartsFromLoaded(m.parts)
    return {
      role: info.role ?? m.role,
      messageID: info.id ?? m.id ?? '',
      content: text,
      text,
      created: info.time?.created ?? m.time?.created,
      parts: parts.length > 0 ? parts : undefined,
    }
  }
  let content: string
  if (typeof m.content === 'string') content = m.content
  else if (Array.isArray(m.content)) content = extractPartsText(m.content)
  else if (typeof m.text === 'string') content = m.text
  else content = ''
  const parts = (m as any).parts
  const builtParts = Array.isArray(parts) && parts.length > 0 ? parts as Part[] : undefined
  return {
    role: m.role ?? m.type,
    messageID: m.messageID ?? m.id ?? '',
    content,
    created: m.created ?? (m as any).time?.created ?? m.timestamp,
    timestamp: m.timestamp,
    parts: builtParts,
  }
}

// ─── 事件载荷工具 ──────────────────────────────────────────

function normalizeError(e: unknown): string | null {
  if (typeof e !== 'string') return null
  return e.trim() ? e : null
}

function stringifyError(e: unknown): string {
  return typeof e === 'string' ? e : JSON.stringify(e)
}

/** 从 SSE tool.success 载荷提取可展示输出文本（content 数组 → 拼接 text → result → structured） */
function extractToolResult(payload: any): string {
  if (Array.isArray(payload?.content)) {
    return payload.content
      .filter((c: any) => c && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
  }
  if (typeof payload?.result === 'string') return payload.result
  if (payload?.structured != null) return JSON.stringify(payload.structured)
  return ''
}

function extractInfoText(info: any): string {
  if (Array.isArray(info?.content)) {
    return info.content
      .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
  }
  if (typeof info?.content === 'string') return info.content
  if (typeof info?.text === 'string') return info.text
  return ''
}

// ─── Store ─────────────────────────────────────────────────

export interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  inputText: string
  waiting: boolean
  runError: string | null
  pendingSteps: number
  lastActivityAt: number

  // ── 新 API ──
  setActiveSession(id: string | null): void
  setInputText(t: string): void
  setWaiting(w: boolean): void
  setRunError(e: string | null): void
  clearRunError(): void
  addMessage(m: NewChatMessage): void
  prependMessages(msgs: ChatMessage[]): void
  addToolPart(part: Part, assistantMessageId?: string): void
  updateToolPart(callID: string, updates: Partial<ToolPartData>): void
  applyLoadedMessages(msgs: LoadedMessage[]): void
  ingestEvent(method: string, payload: any): void
  resetForSession(): void
  markToolsCancelled(): void
  sendMessage(sessionId: string, text: string, clientCall: ClientCall): Promise<void>
  syncSessionMessages(sessionId: string, clientCall: ClientCall): Promise<void>
  abortMessage(sessionId: string, clientCall: ClientCall): Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  inputText: '',
  waiting: false,
  runError: null,
  pendingSteps: 0,
  lastActivityAt: 0,

  setActiveSession: (sessionId) => {
    const prev = get().activeSessionId
    if (prev === sessionId) {
      set({ activeSessionId: sessionId })
      return
    }
    set({
      activeSessionId: sessionId,
      messages: [],
      waiting: false,
      runError: null,
      pendingSteps: 0,
      lastActivityAt: Date.now(),
    })
  },

  resetForSession: () => {
    set({
      messages: [],
      waiting: false,
      runError: null,
      pendingSteps: 0,
      lastActivityAt: Date.now(),
    })
  },

  setInputText: (text) => set({ inputText: text }),

  setWaiting: (w) => set({ waiting: w }),

  setRunError: (err) => {
    const runError = normalizeError(err)
    // 设置 runError 时强制 waiting=false（错误即终态）
    set((state) => ({ runError, waiting: runError ? false : state.waiting }))
  },

  clearRunError: () => set({ runError: null }),

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      id: nextId(),
      timestamp: Date.now(),
      role: msg.role,
      content: msg.content ?? '',
      status: msg.status ?? 'complete',
      parts: msg.parts,
      messageID: msg.messageID,
      created: msg.created,
      agent: msg.agent,
      partID: msg.partID,
      deltaBuffer: msg.deltaBuffer,
      lastAppliedDeltaId: msg.lastAppliedDeltaId,
    }
    set((state) => {
      if (msg.messageID) {
        const existing = state.messages.find((m) => m.messageID === msg.messageID)
        if (existing) {
          // 已存在：若新消息带 parts（工具/推理等）而现有消息缺失，则合并补全
          if (Array.isArray(msg.parts) && msg.parts.length > 0 && (!existing.parts || existing.parts.length === 0)) {
            const copy = [...state.messages]
            const idx = copy.findIndex((m) => m.messageID === msg.messageID)
            copy[idx] = { ...copy[idx], parts: msg.parts, content: msg.content || copy[idx].content }
            return { messages: copy }
          }
          return state
        }
      } else if (state.messages.some((m) => m.role === msg.role && m.content === msg.content)) {
        return state
      }
      return { messages: [...state.messages, newMsg] }
    })
  },

  prependMessages: (msgs) => {
    set((state) => {
      const known = new Set(state.messages.map((m) => m.messageID || m.id))
      const fresh = msgs.filter((m) => !known.has(m.messageID || m.id))
      if (fresh.length === 0) return state
      return { messages: [...fresh, ...state.messages] }
    })
  },

  // ── 工具 part ──
  addToolPart: (part, assistantMessageId) => {
    set((state) => {
      const messages = upsertToolPart(state.messages, part, assistantMessageId)
      if (messages === state.messages) return state
      return { messages }
    })
  },

  updateToolPart: (callID, updates) => {
    set((state) => {
      const messages = updateToolPartStatus(state.messages, callID, updates)
      if (messages === state.messages) return state
      return { messages }
    })
  },

  markToolsCancelled: () => {
    set((state) => {
      const messages = markAllOpenTools(state.messages, 'cancelled')
      if (messages === state.messages) return state
      return { messages }
    })
  },

  // ── 加载 / 同步 ──
  applyLoadedMessages: (msgs) => {
    set((state) => {
      let messages = state.messages
      let changed = false
      for (const raw of msgs) {
        if (!raw || typeof raw !== 'object') continue
        const norm = normalizeLoadedMessage(raw)
        if (!norm.messageID) continue
        const role = (norm.role === 'user' || norm.role === 'assistant' || norm.role === 'system')
          ? norm.role
          : 'assistant'
        const idx = messages.findIndex((m) => m.messageID === norm.messageID)
        if (idx >= 0) {
          const cur = messages[idx]
          const newParts = norm.parts && norm.parts.length > 0 ? norm.parts : undefined
          const contentChanged = cur.content !== (norm.content ?? '')
          const partsMissing = !!newParts && (!cur.parts || cur.parts.length === 0)
          if (contentChanged || partsMissing) {
            const copy = [...messages]
            copy[idx] = {
              ...cur,
              content: contentChanged ? (norm.content ?? '') : cur.content,
              role,
              timestamp: Date.now(),
              created: norm.created ?? cur.created,
              parts: partsMissing ? newParts : cur.parts,
              status: 'complete',
            }
            messages = copy
            changed = true
          }
        } else {
          messages = insertChronologically(messages, {
            id: nextId(),
            role,
            content: norm.content ?? '',
            timestamp: norm.created ?? norm.timestamp ?? Date.now(),
            created: norm.created ?? norm.timestamp,
            status: 'complete',
            parts: norm.parts && norm.parts.length > 0 ? norm.parts : [],
            messageID: norm.messageID,
          })
          changed = true
        }
      }
      if (!changed) return state
      return { messages }
    })
  },

  // ── 事件入口：会话过滤 → 路由纯函数 reducer → set 增量 ──
  ingestEvent: (method, payload) => {
    const state = get()
    const p = payload ?? {}
    const sid = p.sessionID ?? p.sessionId
    if (sid && state.activeSessionId && sid !== state.activeSessionId) return

    const now = Date.now()
    let messages = state.messages
    let pendingSteps = state.pendingSteps
    let waiting = state.waiting
    let runError = state.runError
    const drained = now - state.lastActivityAt > ACTIVITY_TTL
    if (drained) {
      pendingSteps = 0
      waiting = false
    }
    const m = method

    // ── prompt（新一轮对话）──
    if (m === 'session.next.prompt.admitted' || m === 'session.next.prompted') {
      waiting = true
      runError = null
      const messageID = p.messageID ?? ''
      const text = typeof p.prompt === 'string' ? p.prompt : (p.prompt?.text ?? '')
      if (messageID && text) messages = upsertUserMessageIn(messages, messageID, text, p.timestamp)
    }
    // ── 文本流 ──
    else if (m === 'session.next.text.started') {
      const msgId = p.assistantMessageID ?? ''
      if (msgId) messages = ensureAssistant(messages, msgId)
      if (pendingSteps === 0) waiting = true
    } else if (m === 'session.next.text.delta' || m === 'message.part.delta') {
      const delta = typeof p.delta === 'string'
        ? p.delta
        : (typeof p.data?.delta === 'string' ? p.data.delta : (typeof p.data?.text === 'string' ? p.data.text : ''))
      const msgId = p.assistantMessageID ?? p.messageID ?? p.data?.assistantMessageID ?? p.data?.messageID ?? ''
      const eventId = p.eventId ?? p.data?.eventId
      if (delta && msgId) messages = applyTextDelta(messages, msgId, delta, eventId)
    } else if (m === 'session.next.text.ended') {
      const msgId = p.assistantMessageID ?? ''
      const text = typeof p.text === 'string' ? p.text : ''
      if (msgId) messages = finalizeText(messages, msgId, text)
      if (pendingSteps === 0) waiting = false
    }
    // ── 推理流（与文本流同管道）──
    else if (m === 'session.next.reasoning.delta') {
      const delta = typeof p.delta === 'string' ? p.delta : ''
      const msgId = p.assistantMessageID ?? ''
      const eventId = p.eventId
      if (delta && msgId) messages = applyTextDelta(messages, msgId, delta, eventId)
    } else if (m === 'session.next.reasoning.ended') {
      const msgId = p.assistantMessageID ?? ''
      const eventId = p.eventId
      if (msgId && typeof eventId === 'number') messages = applyTextDelta(messages, msgId, '', eventId)
      if (pendingSteps === 0) waiting = false
    }
    // ── 权威消息 ──
    else if (m === 'message.updated') {
      const info = p.info ?? p.message ?? {}
      const messageID = info.id ?? ''
      const role = info.role === 'user' ? 'user' : 'assistant'
      const text = extractInfoText(info)
      const created = info.time?.created ?? p.timestamp
      if (messageID && text) messages = upsertAuthoritativeMessage(messages, role, messageID, text, typeof created === 'number' ? created : undefined)
    } else if (m === 'message.part.updated') {
      const part = p.part ?? {}
      if (part?.type === 'text' && typeof part?.text === 'string' && part?.messageID) {
        const created = part.time?.created ?? p.timestamp
        messages = upsertAuthoritativeMessage(messages, 'assistant', part.messageID, part.text, typeof created === 'number' ? created : undefined)
      }
    }
    // ── 工具流 ──
    else if (m === 'session.next.tool.input.started' || m === 'session.next.tool.called') {
      const callID = p.callID ?? ''
      if (callID) {
        messages = upsertToolPart(messages, {
          id: callID,
          type: 'tool',
          data: {
            tool: p.tool ?? p.name ?? p.input?.tool ?? '',
            input: p.input ?? {},
            status: 'called',
          },
        }, p.assistantMessageID ?? p.messageID)
      }
    } else if (m === 'session.next.tool.progress') {
      if (p.callID) messages = updateToolPartStatus(messages, p.callID, { status: 'progress' })
    } else if (m === 'session.next.tool.success') {
      if (p.callID) {
        const updates: Partial<ToolPartData> = { status: 'success', result: extractToolResult(p) }
        if (Array.isArray(p.outputPaths)) updates.outputPaths = p.outputPaths
        messages = updateToolPartStatus(messages, p.callID, updates)
      }
    } else if (m === 'session.next.tool.failed') {
      if (p.callID) messages = updateToolPartStatus(messages, p.callID, { status: 'failed', error: p.error ?? '' })
    }
    // ── 步骤 ──
    else if (m === 'session.next.step.started') {
      pendingSteps += 1
      waiting = true
    } else if (m === 'session.next.step.ended') {
      pendingSteps = Math.max(0, pendingSteps - 1)
      if (pendingSteps === 0) waiting = false
    } else if (m === 'session.next.step.failed') {
      pendingSteps = 0
      waiting = false
      const errText = p.error?.message ?? p.error ?? p.message
      const errStr = errText != null ? stringifyError(errText) : 'Unknown error'
      runError = normalizeError(errStr)
      if (p.assistantMessageID) messages = markOpenToolsInMessage(messages, p.assistantMessageID, 'failed', { error: errStr })
    }
    // ── session 状态 ──
    else if (m === 'session.status') {
      const statusType = p.status?.type
      if (statusType === 'idle') {
        pendingSteps = 0
        waiting = false
      } else if (statusType === 'busy') {
        waiting = true
      }
    } else if (m === 'session.idle') {
      pendingSteps = 0
      waiting = false
    } else if (m === 'session.error') {
      pendingSteps = 0
      waiting = false
      runError = normalizeError(stringifyError(p.error ?? 'unknown error'))
    }
    // ── 审批终结态 ──
    else if (m === 'permission.v2.replied') {
      if (p.reply === 'reject' && p.sourceCallID) {
        messages = updateToolPartStatus(messages, p.sourceCallID, { status: 'rejected', error: 'rejected' })
      }
    }
    // ── 通用 fallback ──
    else if (m.endsWith('.failed') || m.endsWith('.error')) {
      pendingSteps = 0
      waiting = false
      const err = p.error?.message ?? p.error ?? p.message ?? `${m} (no details)`
      runError = normalizeError(`${m}: ${stringifyError(err)}`)
    }

    set({ messages, pendingSteps, waiting, runError, lastActivityAt: now })
  },

  // ── 发送 / 中止 ──
  sendMessage: async (sessionId, text, clientCall) => {
    get().addMessage({ role: 'user', content: text })
    get().setWaiting(true)
    try {
      await clientCall('message.send', { sessionId, message: text })
    } catch (e) {
      get().addMessage({
        role: 'system',
        content: `发送失败: ${e instanceof Error ? e.message : String(e) || '未知错误'}`,
      })
      set({ pendingSteps: 0, waiting: false })
    }
  },

  abortMessage: async (sessionId, clientCall) => {
    try {
      await clientCall('message.abort', { sessionId })
    } finally {
      get().markToolsCancelled()
      set({ waiting: false, pendingSteps: 0 })
    }
  },

  syncSessionMessages: async (sessionId, clientCall) => {
    const result = await clientCall('session.messages', { sessionId, order: 'desc', limit: 50 })
    const list = Array.isArray(result) ? result : ((result as any)?.messages ?? [])
    const asc = [...list].reverse()
    get().applyLoadedMessages(asc as any)
  },
}))