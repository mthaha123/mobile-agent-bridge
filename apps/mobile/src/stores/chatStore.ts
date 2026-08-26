import { create } from 'zustand'
import type { Part } from '../types/message'
import { buildToolPartFromRaw, isTerminalToolStatus, isOpenToolStatus } from '../utils/toolParts'

// ─── 新数据模型 ────────────────────────────────────────────

export interface ChatMessage {
  id: string
  messageID?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 流式进行中 / 已完结 */
  status?: 'streaming' | 'complete'
  /** 文本流缓冲内聚到消息本身 */
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
  /** 服务端 state.title（如 bash 命令摘要），渲染层可选展示 */
  title?: string
}

/** addMessage 接受宽松消息草稿：role 必填，其余可选 */
export type NewChatMessage = Pick<ChatMessage, 'role'> & Partial<Omit<ChatMessage, 'id' | 'timestamp' | 'role'>>

type ClientCall = (method: string, params?: unknown) => Promise<unknown>

/** 事件静默兜底：超过该时长无任何事件，强制回到 idle */
const ACTIVITY_TTL = 5 * 60 * 1000

// ─── busy 闩锁解锁：回合完成去抖验证 ────────────────────────
//
// 权威覆盖逻辑会把 waiting 锁在 busy 上，其解锁依赖服务端广播
// session.status(idle)/session.idle —— 但本项目对接的 opencode serve
// 实测根本不广播这两个事件（4.2MB 真实事件流中 0 次）。一旦被快照
// 标记 busy，事件流内不存在任何解锁信号：每个后续事件都会把 waiting
// 重新锁回 true → 转圈不停、输入框永久锁定（"一直占用"）。
// 解法：本地判定回合已完（步骤归零 + 无未完结工具）时，去抖 2.5s
// 向服务器要一次权威快照，用 RPC 结果解除闩锁。

const IDLE_VERIFY_DELAY = 2500
let idleVerifyTimer: ReturnType<typeof setTimeout> | null = null

function cancelIdleVerify(): void {
  if (idleVerifyTimer) {
    clearTimeout(idleVerifyTimer)
    idleVerifyTimer = null
  }
}

function hasOpenToolParts(messages: ChatMessage[]): boolean {
  return messages.some((m) =>
    m.parts?.some((p) => p.type === 'tool' && isOpenToolStatus(normalizeToolPartData(p).status)),
  )
}

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
  return p.data as unknown as ToolPartData
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

function markAllOpenTools(messages: ChatMessage[], status: ToolStatus, extra?: Partial<ToolPartData>): ChatMessage[] {
  let changed = false
  const result = messages.map((m) => {
    if (!m.parts || m.parts.length === 0) return m
    const newParts = m.parts.map((p) => {
      if (p.type !== 'tool') return p
      const d = normalizeToolPartData(p)
      if (d.status !== 'called' && d.status !== 'progress') return p
      changed = true
      return { ...p, data: { ...p.data, status, ...(extra ?? {}) } }
    })
    return newParts === m.parts ? m : { ...m, parts: newParts }
  })
  return changed ? result : messages
}

/** 服务端下发的 tool part 合并进本地（带终态保护）：
 *  本地已终态而服务端为非终态（乱序/陈旧投影重放）时拒绝降级，防止成功卡片被打回"运行中"。 */
function upsertServerToolPart(messages: ChatMessage[], part: Part): ChatMessage[] {
  if (!part || !part.id) return messages
  const incoming = normalizeToolPartData(part)
  for (const m of messages) {
    const cur = m.parts?.find((p) => p.id === part.id)
    if (cur && isTerminalToolStatus(normalizeToolPartData(cur).status) && !isTerminalToolStatus(incoming.status)) {
      return messages
    }
  }
  return upsertToolPart(messages, part)
}

/**
 * 历史加载对账：服务端权威数据合入本地已有消息的 parts。
 *   - 本地工具非终态（called/progress）→ 以服务端为准（服务端可能已终结该调用，
 *     本地因断线/事件丢失停留在运行中——本 bug 的核心修复点之一）
 *   - 服务端工具已终态 → 无论本地什么状态都采信服务端（结果可能更完整）
 *   - 本地缺失的工具 part → 补插
 *   - text/reasoning 不在此处理（文本由 content 权威覆盖逻辑负责）
 */
function mergePartsOnLoad(localParts: Part[] | undefined, incoming: Part[]): Part[] {
  if (!incoming || incoming.length === 0) return localParts ?? []
  // 本地为空：整体采用服务端 parts（含 text/reasoning/tool，等价原 partsMissing 语义）
  if (!localParts || localParts.length === 0) return incoming
  const byId = new Map(incoming.map((p) => [p.id, p]))
  let changed = false
  const out = localParts.map((p) => {
    if (p.type !== 'tool') return p
    const inc = byId.get(p.id)
    if (!inc || inc.type !== 'tool') return p
    const localOpen = !isTerminalToolStatus(normalizeToolPartData(p).status)
    if (localOpen || isTerminalToolStatus(normalizeToolPartData(inc).status)) {
      if (JSON.stringify(p.data) !== JSON.stringify(inc.data)) changed = true
      return inc
    }
    return p
  })
  const known = new Set(out.map((p) => p.id))
  for (const ip of incoming) {
    if (ip.type === 'tool' && !known.has(ip.id)) {
      out.push(ip)
      changed = true
    }
  }
  return changed ? out : localParts
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
      // 统一走共享归一化：callID 优先作为 id、metadata.output 提取、
      // pending/running/completed/error → called/progress/success/failed
      const built = buildToolPartFromRaw(p)
      if (built) out.push(built)
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
      created: (info.time as any)?.created ?? (m.time as any)?.created,
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
    role: m.role ?? (m.type as string),
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

export type SessionRunStatus = 'idle' | 'busy' | 'retry'

/**
 * 从 bridge 的 session.status RPC 响应提取「运行中会话」映射。
 * 兼容两种形态：
 *   - 双层包裹: { data: { [sessionID]: { type: 'running' } } }
 *   - 平铺:     { [sessionID]: { type: 'running' } }
 */
function normalizeRunningMap(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const obj = result as Record<string, unknown>
  const inner = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? obj.data as Record<string, unknown>
    : obj
  return inner
}

/** 判断会话是否在运行中：值为对象时看 type==='running'，否则 truthy 兜底 */
function isRunningEntry(entry: unknown): boolean {
  if (!entry) return false
  if (typeof entry === 'object') {
    const e = entry as Record<string, unknown>
    return e.type === 'running' || e.type === 'busy'
  }
  return !!entry
}

export interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  inputText: string
  waiting: boolean
  runError: string | null
  pendingSteps: number
  lastActivityAt: number
  /** 服务端权威的每会话运行状态（session.status / session.idle 通知 + session.status RPC 快照） */
  sessionRunStatus: Record<string, SessionRunStatus>

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
  setSessionRunStatus(sessionId: string, status: SessionRunStatus): void
  fetchSessionRunStatus(sessionId: string, clientCall: ClientCall): Promise<void>
  syncSessionRunStatus(clientCall: ClientCall): Promise<void>
  /** 对账：权威信号显示会话已空闲时，终结本地仍处于 called/progress 的工具 part。
   *  服务端（opencode）存在工具 part 永不结算的缺陷（bash 挂起/回合中断后
   *  state.status 停留在 running，终态事件永不发出），必须由客户端自愈。 */
  reconcileStaleTools(): void
  /** 回合完成去抖验证的调度入口（ingest 内部使用）：busy 闩锁 + 步骤归零 + 无未完结工具时调用 */
  scheduleIdleVerify(): void
  /** 立即向服务器请求一次权威运行快照以解除 busy 闩锁（内部由调度器触发） */
  verifySessionIdle(sessionId?: string): void

  // ── 旧版兼容 shim ──
  appendAssistantDelta(assistantMessageId: string, delta: string, eventId: number | string): void
  updateLastAssistant(text: string): void
  advanceStreamId(assistantMessageId: string, eventId: number | string): void
  finalizeAssistantContent(assistantMessageId: string, fullText: string): void
  ensureAssistantMessage(messageID: string): void
  upsertUserMessage(messageID: string, content: string, timestamp?: number): void
  applyServerMessage(role: 'user' | 'assistant', messageID: string, content: string, timestamp?: number): void
  applyServerMessages(msgs: Array<{ role: 'user' | 'assistant'; messageID: string; content: string; timestamp?: number; parts?: Part[] }>, opts?: { limit?: number }): void
  clearMessages(): void
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  inputText: '',
  waiting: false,
  runError: null,
  pendingSteps: 0,
  lastActivityAt: 0,
  sessionRunStatus: {},

  setActiveSession: (sessionId) => {
    const prev = get().activeSessionId
    if (prev === sessionId) {
      set({ activeSessionId: sessionId })
      return
    }
    cancelIdleVerify() // 切换会话：撤销旧会话的空闲验证（verify 内部也按 sid 隔离）
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
    cancelIdleVerify()
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

  reconcileStaleTools: () => {
    const { waiting, pendingSteps } = get()
    // 正在等待回合输出时不动：工具可能真的在跑（长 bash），权威 busy 覆盖也依赖 waiting
    if (waiting || pendingSteps > 0) return
    set((state) => {
      const messages = markAllOpenTools(state.messages, 'failed', {
        error: '未收到执行结果（会话已结束或连接中断）',
      })
      if (messages === state.messages) return state
      return { messages }
    })
  },

  scheduleIdleVerify: () => {
    cancelIdleVerify()
    const sid = get().activeSessionId
    if (!sid) return
    idleVerifyTimer = setTimeout(() => {
      idleVerifyTimer = null
      get().verifySessionIdle(sid)
    }, IDLE_VERIFY_DELAY)
  },

  verifySessionIdle: (sessionId) => {
    cancelIdleVerify()
    const sid = sessionId ?? get().activeSessionId
    if (!sid) return
    void (async () => {
      try {
        // 惰性引入避免 store 间静态循环依赖；client 由 AppProvider 登录后注入
        const { useAuthStore } = await import('../stores/authStore')
        const client = useAuthStore.getState().client
        if (!client) return
        const call = client.call.bind(client)
        // ① 先拉权威消息：终态事件可能只是丢了，服务端持久化里已有真实结果
        //    （mergePartsOnLoad 以服务端终态覆盖本地非终态，幂等防回退）
        try {
          await get().syncSessionMessages(sid, call)
        } catch {
          // 消息拉取失败不影响后续状态核查
        }
        // ② 再核状态：快照空闲 → 解除等待态 + reconcileStaleTools 终结仍残留的 ⏳
        await get().fetchSessionRunStatus(sid, call)
      } catch {
        // 静默：验证失败保持现状，下一个完成事件会再次调度
      }
    })()
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
          // 流式防回退：本地正在流式累积且服务端全文更短时（陈旧投影）不覆盖文本
          const shrinkGuard = role === 'assistant'
            && cur.status === 'streaming'
            && (norm.content ?? '').length < cur.content.length
          // part 级对账：本地非终态工具被服务端终态覆盖 / 补插缺失工具
          const mergedParts = newParts ? mergePartsOnLoad(cur.parts, newParts) : cur.parts
          const partsChanged = mergedParts !== cur.parts
          const partsMissing = !!newParts && (!cur.parts || cur.parts.length === 0)
          if ((contentChanged && !shrinkGuard) || partsMissing || partsChanged) {
            const copy = [...messages]
            copy[idx] = {
              ...cur,
              content: (contentChanged && !shrinkGuard) ? (norm.content ?? '') : cur.content,
              role,
              timestamp: Date.now(),
              created: norm.created ?? cur.created,
              parts: partsChanged ? mergedParts : (partsMissing ? newParts : cur.parts),
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

    // ── 会话运行状态（全局订阅，先于会话过滤）──
    // session.status / session.idle 是服务端权威的 busy/idle 信号，
    // 无论事件属于哪个会话都记录到 sessionRunStatus（供会话列表红点/红方块），
    // 再按 activeSessionId 过滤决定是否驱动 waiting 状态机。
    if (method === 'session.status') {
      const st = p.status?.type
      if (sid && (st === 'idle' || st === 'busy' || st === 'retry')) {
        get().setSessionRunStatus(sid, st)
      }
    } else if (method === 'session.idle') {
      if (sid) get().setSessionRunStatus(sid, 'idle')
    }

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
      cancelIdleVerify() // 新回合开始：撤销上一回合遗留的空闲验证
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
      } else if (part?.type === 'tool') {
        // SDK v2 的 part 状态权威通道：tool part 的 state.status 变更（running→completed/error）
        // 也可能走此事件（session.next.tool.* 缺失时是唯一的结算路径）。
        // 共享归一化保证 callID 身份一致；终态保护防止乱序重放把成功卡片打回运行中。
        const built = buildToolPartFromRaw(part)
        if (built) messages = upsertServerToolPart(messages, built)
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
      cancelIdleVerify() // 新步骤开始：撤销空闲验证（多步回合的步间间隙不触发快照）
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
      } else if (statusType === 'busy' || statusType === 'retry') {
        waiting = true
      }
    } else if (m === 'session.idle') {
      pendingSteps = 0
      waiting = false
    } else if (m === 'session.error') {
      pendingSteps = 0
      waiting = false
      // 会话级致命错误：视为不再运行，清掉权威 busy 状态防止红方块残留
      if (sid) get().setSessionRunStatus(sid, 'idle')
      runError = normalizeError(stringifyError(p.error ?? 'unknown error'))
      // 回合已致命失败：终结所有未决工具 part（否则永久显示运行中）
      messages = markAllOpenTools(messages, 'failed', { error: '回合异常终止' })
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

    // ── 权威状态覆盖 ──
    // 服务端确认当前会话仍在运行（busy/retry）时，等待态/红方块持续显示，
    // 不因 text.ended / reasoning.ended / step.ended 等瞬时事件而闪烁熄灭。
    // ⚠️ 解锁依赖 session.status(idle)/session.idle 广播，但本项目对接的 serve
    // 实测不广播这两个事件（见文件头 IDLE_VERIFY_DELAY 注释），因此 busy 一旦
    // 闩上，事件流内无解锁信号 —— 由下方"回合完成去抖验证"主动向服务器核实。
    const activeId = get().activeSessionId
    const activeStatus = activeId ? get().sessionRunStatus[activeId] : undefined
    if (activeStatus === 'busy' || activeStatus === 'retry') {
      waiting = true
      // 本地已判定回合完成（步骤归零 + 无未完结工具）却仍被闩在 busy
      // → 去抖请求权威快照解除（服务器真忙则保持，不误杀长任务）
      if (pendingSteps === 0 && !hasOpenToolParts(messages)) {
        get().scheduleIdleVerify()
      }
    }

    // ── 回合完成但有工具终态缺失 → 主动核查 ──
    // 上游缺陷：opencode serve 偶发漏发单条 tool.success/failed（bash 挂起/
    // 回合中断），且从不广播 session.status/session.idle。若只依赖重连/
    // busy 闩锁触发自愈，纯 live 回合里丢一条终态事件 = 红方块永久卡住。
    // 此处在「回合已收尾（waiting/steps 归零）但仍有 open 工具」时去抖核查：
    // 快照 idle → reconcile 终结残留；顺带拉权威消息找回真实结果。
    // （服务器真在跑则快照 busy → 不动，不误杀长任务；step.started 会撤销本定时器）
    if (!waiting && pendingSteps === 0 && hasOpenToolParts(messages)) {
      get().scheduleIdleVerify()
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
      // 本地乐观：中断后该会话不再运行（服务端随后会广播 session.status idle 兜底）
      get().setSessionRunStatus(sessionId, 'idle')
      set({ waiting: false, pendingSteps: 0 })
    }
  },

  // ── 会话运行状态（全局订阅）──
  setSessionRunStatus: (sessionId, status) => {
    if (!sessionId) return
    set((state) => {
      if (state.sessionRunStatus[sessionId] === status) return state
      return { sessionRunStatus: { ...state.sessionRunStatus, [sessionId]: status } }
    })
  },

  /** 拉取单个会话的权威运行状态（session.status RPC 返回运行中会话快照） */
  fetchSessionRunStatus: async (sessionId, clientCall) => {
    if (!sessionId) return
    try {
      const result = await clientCall('session.status', {})
      const map = normalizeRunningMap(result)
      const running = isRunningEntry(map[sessionId])
      get().setSessionRunStatus(sessionId, running ? 'busy' : 'idle')
      if (!running) {
        // 权威快照确认空闲 → 先解除本地可能因错过结束广播而残留的等待态
        // （转圈 + 输入框锁定）。必须先于 reconcileStaleTools：后者的保守守卫
        // 在 waiting=true 时会跳过，导致卡住的 ⏳ 得不到终结。
        const s = get()
        if (s.activeSessionId === sessionId && (s.waiting || s.pendingSteps > 0)) {
          set({ waiting: false, pendingSteps: 0 })
        }
        // 再终结残留的"运行中"工具卡片
        get().reconcileStaleTools()
      }
    } catch {
      // 静默：查询失败保持现状，SSE 通知会在后续事件中兜底
    }
  },

  /** 同步全部会话运行状态（会话列表进入/刷新时调用，校正重连后错过的 idle 事件） */
  syncSessionRunStatus: async (clientCall) => {
    try {
      const result = await clientCall('session.status', {})
      const map = normalizeRunningMap(result)
      set((state) => {
        const next: Record<string, SessionRunStatus> = { ...state.sessionRunStatus }
        let changed = false
        // 快照中出现的会话 → 运行中
        for (const sid of Object.keys(map)) {
          const st: SessionRunStatus = isRunningEntry(map[sid]) ? 'busy' : 'idle'
          if (next[sid] !== st) {
            next[sid] = st
            changed = true
          }
        }
        // 快照中缺席 → 服务端视为 inactive（运行中集合之外的会话都非运行态），
        // 把此前标记 busy 的会话校正回 idle，避免重连后红点/红方块残留
        for (const [sid, prev] of Object.entries(state.sessionRunStatus)) {
          if ((prev === 'busy' || prev === 'retry') && !(sid in map) && next[sid] !== 'idle') {
            next[sid] = 'idle'
            changed = true
          }
        }
        return changed ? { sessionRunStatus: next } : state
      })
      // 当前打开的会话被权威快照判定为空闲时：解除残留等待态 + 终结"运行中"工具
      // （以本次快照 map 为准，而非本地缓存）
      const activeId = get().activeSessionId
      if (activeId && !isRunningEntry(map[activeId])) {
        const s = get()
        if (s.waiting || s.pendingSteps > 0) {
          set({ waiting: false, pendingSteps: 0 })
        }
        get().reconcileStaleTools()
      }
    } catch {
      // 静默：失败保持现状
    }
  },

  syncSessionMessages: async (sessionId, clientCall) => {
    // bridge 契约：恒定输出升序（旧→新，最新窗口）+ 不透明 cursor；客户端不传排序参数
    const result = await clientCall('session.messages', { sessionId, limit: 50 })
    const list = Array.isArray(result) ? result : ((result as any)?.messages ?? [])
    get().applyLoadedMessages(list as any)
  },

  // ── 兼容 shim：转发到新逻辑 ──
  appendAssistantDelta: (assistantMessageId, delta, eventId) => {
    get().ingestEvent('session.next.text.delta', { assistantMessageID: assistantMessageId, delta, eventId })
  },

  updateLastAssistant: (text) => {
    set((state) => {
      const copy = [...state.messages]
      const lastIdx = copy.length - 1
      if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
        copy[lastIdx] = { ...copy[lastIdx], content: copy[lastIdx].content + text, timestamp: Date.now() }
      } else {
        copy.push({
          id: nextId(),
          role: 'assistant',
          content: text,
          status: 'streaming',
          parts: [],
          timestamp: Date.now(),
        })
      }
      return { messages: copy }
    })
  },

  advanceStreamId: (assistantMessageId, eventId) => {
    if (typeof eventId !== 'number' || !assistantMessageId) return
    set((state) => {
      const messages = applyTextDelta(state.messages, assistantMessageId, '', eventId)
      if (messages === state.messages) return state
      return { messages }
    })
  },

  finalizeAssistantContent: (assistantMessageId, fullText) => {
    get().ingestEvent('session.next.text.ended', { assistantMessageID: assistantMessageId, text: fullText })
  },

  ensureAssistantMessage: (messageID) => {
    get().ingestEvent('session.next.text.started', { assistantMessageID: messageID })
  },

  upsertUserMessage: (messageID, content, timestamp) => {
    set((state) => {
      if (!messageID) return state
      const messages = upsertUserMessageIn(state.messages, messageID, content, timestamp)
      if (messages === state.messages) return state
      return { messages }
    })
  },

  applyServerMessage: (role, messageID, content, timestamp) => {
    set((state) => {
      if (!messageID) return state
      const messages = upsertAuthoritativeMessage(state.messages, role, messageID, content, timestamp)
      if (messages === state.messages) return state
      return { messages }
    })
  },

  applyServerMessages: (msgs, opts) => {
    get().applyLoadedMessages(msgs as any)
  },

  clearMessages: () => {
    set({ messages: [], waiting: false, pendingSteps: 0, runError: null, lastActivityAt: Date.now() })
  },
}))
