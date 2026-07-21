import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
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
  appendAssistantDelta: (assistantMessageId: string, delta: string, eventId: number) => void
  advanceStreamId: (assistantMessageId: string, eventId: number) => void
  finalizeAssistantContent: (assistantMessageId: string, fullText: string) => void
  setInputText: (text: string) => void
  setWaiting: (w: boolean) => void
  clearMessages: () => void
  abortMessage: (sessionId: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  shellCommand: (sessionId: string, command: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  writeCommand: (sessionId: string, command: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

let msgCounter = 0

function appendToLastAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
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
    set((state) => ({ messages: [...state.messages, newMsg] }))
  },

  setInputText: (text) => set({ inputText: text }),

  updateLastAssistant: (text: string) => {
    set((state) => ({
      messages: appendToLastAssistant(state.messages, text),
    }))
  },

  appendAssistantDelta: (assistantMessageId: string, delta: string, eventId: number) => {
    set((state) => {
      const track: TextStreamState = state.streamStates[assistantMessageId] ?? { lastAppliedId: -1, buffer: {} }

      if (eventId <= track.lastAppliedId) {
        return state
      }

      if (track.lastAppliedId === -1 || eventId === track.lastAppliedId + 1) {
        let messages = appendToLastAssistant(state.messages, delta)
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

  advanceStreamId: (assistantMessageId: string, eventId: number) => {
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
          result[i] = { ...result[i], content: fullText, timestamp: Date.now() }
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

  shellCommand: async (sessionId, command, clientCall) => {
    await clientCall('message.shell', { sessionId, command })
  },

  writeCommand: async (sessionId, command, clientCall) => {
    await clientCall('message.command', { sessionId, command })
  },
}))
