import { create } from 'zustand'
import type { Part } from '../types/message'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  messageID?: string
  partID?: string
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
  updateLastAssistant: (text: string) => void
  appendAssistantDelta: (assistantMessageId: string, delta: string, eventId: number | string) => void
  advanceStreamId: (assistantMessageId: string, eventId: number | string) => void
  finalizeAssistantContent: (assistantMessageId: string, fullText: string) => void
  addToolPart: (part: Part) => void
  updateToolPart: (callID: string, updates: Partial<Part['data']>) => void
  setInputText: (text: string) => void
  setWaiting: (w: boolean) => void
  clearMessages: () => void
  abortMessage: (sessionId: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

let msgCounter = 0

function appendToLastAssistant(messages: ChatMessage[], text: string, messageID?: string): ChatMessage[] {
  const result = [...messages]
  const lastIdx = result.length - 1
  if (lastIdx >= 0 && result[lastIdx].role === 'assistant') {
    result[lastIdx] = { ...result[lastIdx], content: result[lastIdx].content + text, timestamp: Date.now() }
  } else {
    result.push({
      id: `msg_${++msgCounter}_${Date.now()}`,
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      messageID,
    })
  }
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
      id: `msg_${++msgCounter}_${Date.now()}`,
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

  setInputText: (text) => set({ inputText: text }),

  updateLastAssistant: (text: string) => {
    set((state) => ({
      messages: appendToLastAssistant(state.messages, text),
    }))
  },

  addToolPart: (part) => {
    set((state) => {
      const messages = [...state.messages]
      let lastIdx = messages.length - 1
      // 确保工具 part 归属最后一条 assistant 消息；若无则新建
      if (lastIdx < 0 || messages[lastIdx].role !== 'assistant') {
        messages.push({
          id: `msg_${++msgCounter}_${Date.now()}`,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
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
        messages: appendToLastAssistant(state.messages, delta, assistantMessageId),
      }))
      return
    }
    set((state) => {
      const track: TextStreamState = state.streamStates[assistantMessageId] ?? { lastAppliedId: -1, buffer: {} }

      if (eventId <= track.lastAppliedId) {
        return state
      }

      if (track.lastAppliedId === -1 || eventId === track.lastAppliedId + 1) {
        let messages = appendToLastAssistant(state.messages, delta, assistantMessageId)
        let newTrack = { ...track, lastAppliedId: eventId }

        while (newTrack.buffer[newTrack.lastAppliedId + 1]) {
          const nextId = newTrack.lastAppliedId + 1
          messages = appendToLastAssistant(messages, newTrack.buffer[nextId])
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
          messages = appendToLastAssistant(messages, newTrack.buffer[nextId])
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
      let found = false
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === 'assistant') {
          result[i] = { ...result[i], content: fullText, timestamp: Date.now(), messageID: assistantMessageId }
          found = true
          break
        }
      }
      if (!found) {
        result.push({
          id: `msg_${++msgCounter}_${Date.now()}`,
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
