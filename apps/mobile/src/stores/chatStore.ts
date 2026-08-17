import { create } from 'zustand'
import type { Part } from '../types/message'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  messageID?: string
  partID?: string
  created?: number
  parts?: Part[]
  agent?: string
}

interface TextStreamState {
  lastAppliedId: number
  buffer: Record<number, string>
}

export interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  inputText: string
  waiting: boolean
  streamStates: Record<string, TextStreamState>

  setActiveSession: (sessionId: string | null) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  prependMessages: (msgs: ChatMessage[]) => void
  updateLastAssistant: (text: string) => void
  appendAssistantDelta: (assistantMessageId: string, delta: string, eventId: number | string) => void
  advanceStreamId: (assistantMessageId: string, eventId: number | string) => void
  finalizeAssistantContent: (assistantMessageId: string, fullText: string) => void
  upsertUserMessage: (messageID: string, content: string, timestamp?: number) => void
  ensureAssistantMessage: (messageID: string) => void
  applyServerMessage: (role: 'user' | 'assistant', messageID: string, content: string, timestamp?: number) => void
  applyServerMessages: (msgs: Array<{ role: 'user' | 'assistant'; messageID: string; content: string; timestamp?: number }>, opts?: { limit?: number }) => void
  addToolPart: (part: Part, assistantMessageId?: string) => void
  updateToolPart: (callID: string, updates: Partial<Part['data']>) => void
  setInputText: (text: string) => void
  setWaiting: (w: boolean) => void
  clearMessages: () => void
  abortMessage: (sessionId: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
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

function appendToLastAssistant(messages: ChatMessage[], text: string, messageID?: string): ChatMessage[] {
  const result = [...messages]
  const lastIdx = result.length - 1
  if (lastIdx >= 0 && result[lastIdx].role === 'assistant') {
    result[lastIdx] = { ...result[lastIdx], content: result[lastIdx].content + text, timestamp: Date.now() }
  } else {
    result.push({
      id: nextId(),
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      messageID,
    })
  }
  return result
}

/** 按 messageID 精确追加 AI 文本：找到对应消息就拼接；找不到则新建一条 assistant 消息。
 *  避免多个 assistant 消息共存时（多轮对话/远程新增）文本错贴到错误的旧消息上。 */
function appendToAssistantById(messages: ChatMessage[], assistantMessageId: string, text: string): ChatMessage[] {
  const result = [...messages]
  const idx = result.findIndex((m) => m.messageID === assistantMessageId)
  if (idx >= 0) {
    result[idx] = {
      ...result[idx],
      content: result[idx].content + text,
      timestamp: Date.now(),
      messageID: assistantMessageId,
    }
    return result
  }
  result.push({
    id: nextId(),
    role: 'assistant',
    content: text,
    timestamp: Date.now(),
    messageID: assistantMessageId,
  })
  return result
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  inputText: '',
  waiting: false,
  streamStates: {},

  setActiveSession: (sessionId) => {
    const prev = get().activeSessionId
    if (prev !== sessionId) {
      set({ activeSessionId: sessionId, messages: [], waiting: false, streamStates: {} })
    } else {
      set({ activeSessionId: sessionId })
    }
  },

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: nextId(),
      timestamp: Date.now(),
    }
    set((state) => {
      // 去重：按 messageID 或 (role+content) 判断，避免历史消息重复加载
      if (msg.messageID) {
        if (state.messages.some((m) => m.messageID === msg.messageID)) return state
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
      // 更早的消息插到列表前（保持升序：fresh 在前，旧列表在后）
      return { messages: [...fresh, ...state.messages] }
    })
  },

  setInputText: (text) => set({ inputText: text }),

  updateLastAssistant: (text: string) => {
    set((state) => ({
      messages: appendToLastAssistant(state.messages, text),
    }))
  },

  addToolPart: (part, assistantMessageId) => {
    set((state) => {
      const messages = [...state.messages]
      let lastIdx = -1
      // 优先按 assistantMessageID 定位目标消息（多 assistant 消息共存时准确归属）
      if (assistantMessageId) {
        lastIdx = messages.findIndex((m) => m.messageID === assistantMessageId)
      } else {
        lastIdx = messages.length - 1
      }
      // 确保工具 part 归属最后一条 assistant 消息；若无则新建
      if (lastIdx < 0 || messages[lastIdx].role !== 'assistant') {
        messages.push({
          id: nextId(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          messageID: assistantMessageId,
        })
        lastIdx = messages.length - 1
      }
      const existing = messages[lastIdx].parts ?? []
      if (existing.some((p) => p.id === part.id)) return state
      messages[lastIdx] = { ...messages[lastIdx], parts: [...existing, part] }
      return { messages }
    })
  },

  updateToolPart: (callID, updates) => {
    set((state) => ({
      messages: state.messages.map((m) => {
        if (!m.parts || m.parts.length === 0) return m
        const parts = m.parts.map((p) =>
          p.id === callID ? { ...p, data: { ...p.data, ...updates } } : p,
        )
        return { ...m, parts }
      }),
    }))
  },

  appendAssistantDelta: (assistantMessageId: string, delta: string, eventId: number | string) => {
    // SDK v3 SSE 事件顺序到达、eventId 为 evt_ 字符串，无法数值排序 → 按到达顺序追加
    if (typeof eventId !== 'number') {
      set((state) => ({
        messages: appendToAssistantById(state.messages, assistantMessageId, delta),
      }))
      return
    }
    set((state) => {
      const track: TextStreamState = state.streamStates[assistantMessageId] ?? { lastAppliedId: -1, buffer: {} }

      if (eventId <= track.lastAppliedId) {
        return state
      }

      if (track.lastAppliedId === -1 || eventId === track.lastAppliedId + 1) {
        let messages = appendToAssistantById(state.messages, assistantMessageId, delta)
        let newTrack = { ...track, lastAppliedId: eventId }

        while (newTrack.buffer[newTrack.lastAppliedId + 1]) {
          const nextId = newTrack.lastAppliedId + 1
          messages = appendToAssistantById(messages, assistantMessageId, newTrack.buffer[nextId])
          const rest = { ...newTrack.buffer }
          delete rest[nextId]
          newTrack = { ...newTrack, lastAppliedId: nextId, buffer: rest }
        }

        return {
          messages,
          streamStates: { ...state.streamStates, [assistantMessageId]: newTrack },
        }
      }

      return {
        streamStates: {
          ...state.streamStates,
          [assistantMessageId]: { ...track, buffer: { ...track.buffer, [eventId]: delta } },
        },
      }
    })
  },

  advanceStreamId: (assistantMessageId: string, eventId: number | string) => {
    // 字符串 eventId 无法做顺序推进，且 SSE 本身有序 → 无需处理
    if (typeof eventId !== 'number') {
      return
    }
    set((state) => {
      const track: TextStreamState = state.streamStates[assistantMessageId] ?? { lastAppliedId: -1, buffer: {} }

      if (eventId <= track.lastAppliedId) {
        return state
      }

      if (track.lastAppliedId === -1 || eventId === track.lastAppliedId + 1) {
        let messages = state.messages
        let newTrack = { ...track, lastAppliedId: eventId }

        while (newTrack.buffer[newTrack.lastAppliedId + 1]) {
          const nextId = newTrack.lastAppliedId + 1
          messages = appendToAssistantById(messages, assistantMessageId, newTrack.buffer[nextId])
          const rest = { ...newTrack.buffer }
          delete rest[nextId]
          newTrack = { ...newTrack, lastAppliedId: nextId, buffer: rest }
        }

        return {
          messages,
          streamStates: { ...state.streamStates, [assistantMessageId]: newTrack },
        }
      }

      return state
    })
  },

  finalizeAssistantContent: (assistantMessageId: string, fullText: string) => {
    set((state) => {
      const result = [...state.messages]
      let idx = result.findIndex((m) => m.messageID === assistantMessageId)
      // 未命中 messageID 时回退到最后一条 assistant（兼容无 messageID 的本地消息）
      if (idx < 0) {
        for (let i = result.length - 1; i >= 0; i--) {
          if (result[i].role === 'assistant') { idx = i; break }
        }
      }
      if (idx >= 0) {
        result[idx] = { ...result[idx], content: fullText, timestamp: Date.now(), messageID: assistantMessageId }
      } else {
        result.push({
          id: nextId(),
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
          messageID: assistantMessageId,
        })
      }
      const streamStates = { ...state.streamStates }
      delete streamStates[assistantMessageId]
      return { messages: result, streamStates }
    })
  },

  upsertUserMessage: (messageID: string, content: string, timestamp?: number) => {
    set((state) => {
      if (!messageID) return state
      const idx = state.messages.findIndex((m) => m.messageID === messageID)
      if (idx >= 0) {
        if (state.messages[idx].content === content) return state
        const messages = [...state.messages]
        messages[idx] = { ...messages[idx], content, timestamp: Date.now(), created: timestamp }
        return { messages }
      }
      // 本地乐观插入的用户消息没有 messageID：用 role+content 匹配后补上 messageID，避免重复
      const localIdx = state.messages.findIndex(
        (m) => m.role === 'user' && !m.messageID && m.content === content,
      )
      if (localIdx >= 0) {
        const messages = [...state.messages]
        messages[localIdx] = { ...messages[localIdx], messageID, timestamp: Date.now(), created: timestamp }
        return { messages }
      }
      // 未知 messageID 的用户消息：按时间序插入（SSE 中断恢复时避免"回答跑到问题上面"）
      return {
        messages: insertChronologically(state.messages, {
          id: nextId(),
          role: 'user',
          content,
          timestamp: timestamp ?? Date.now(),
          created: timestamp,
          messageID,
        }),
      }
    })
  },

  ensureAssistantMessage: (messageID: string) => {
    set((state) => {
      if (!messageID) return state
      if (state.messages.some((m) => m.messageID === messageID)) return state
      return {
        messages: [...state.messages, {
          id: nextId(),
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          messageID,
        }],
      }
    })
  },

  applyServerMessage: (role: 'user' | 'assistant', messageID: string, content: string, timestamp?: number) => {
    set((state) => {
      if (!messageID) return state
      const idx = state.messages.findIndex((m) => m.messageID === messageID)
      if (idx >= 0) {
        if (state.messages[idx].content === content) return state
        const messages = [...state.messages]
        messages[idx] = { ...messages[idx], content, role, timestamp: Date.now(), created: timestamp }
        return { messages }
      }
      // 未知 messageID：按时间序插入，保持消息在列表中的时序位置
      return {
        messages: insertChronologically(state.messages, {
          id: nextId(),
          role,
          content,
          timestamp: timestamp ?? Date.now(),
          created: timestamp,
          messageID,
        }),
      }
    })
  },

  applyServerMessages: (msgs) => {
    set((state) => {
      let messages = state.messages
      const known = new Set(messages.map((m) => m.messageID))
      msgs
        .filter((s) => s && s.messageID)
        .forEach((s) => {
          const idx = messages.findIndex((m) => m.messageID === s.messageID)
          if (idx >= 0) {
            const cur = messages[idx]
            if (cur.content !== s.content) {
              const copy = [...messages]
              copy[idx] = { ...cur, content: s.content, role: s.role, timestamp: Date.now(), created: s.timestamp ?? cur.created }
              messages = copy
            }
          } else {
            messages = insertChronologically(messages, {
              id: nextId(),
              role: s.role,
              content: s.content,
              timestamp: s.timestamp ?? Date.now(),
              created: s.timestamp,
              messageID: s.messageID,
            })
          }
        })
      if (known.size === messages.length && messages === state.messages) return state
      return { messages }
    })
  },

  setWaiting: (w) => set({ waiting: w }),

  clearMessages: () => set({ messages: [], waiting: false, streamStates: {} }),

  abortMessage: async (sessionId, clientCall) => {
    try {
      await clientCall('message.abort', { sessionId })
    } finally {
      set({ waiting: false })
    }
  },
}))