/**
 * chatStore — 聊天消息状态管理
 *
 * 管理会话内的消息列表和输入状态
 */
import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ChatState {
  /** 当前活跃 session ID */
  activeSessionId: string | null
  /** 消息列表 */
  messages: ChatMessage[]
  /** 输入框内容 */
  inputText: string
  /** 是否正在等待 AI 回复 */
  waiting: boolean

  setActiveSession: (sessionId: string | null) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setInputText: (text: string) => void
  sendMessage: () => void
  setWaiting: (w: boolean) => void
  clearMessages: () => void
}

let msgCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  inputText: '',
  waiting: false,

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg_${++msgCounter}_${Date.now()}`,
      timestamp: Date.now(),
    }
    set((state) => ({ messages: [...state.messages, newMsg] }))
  },

  setInputText: (text) => set({ inputText: text }),

  sendMessage: () => {
    const { inputText, activeSessionId } = get()
    if (!inputText.trim()) return
    if (!activeSessionId) return

    get().addMessage({ role: 'user', content: inputText.trim() })
    set({ inputText: '', waiting: true })

    // BridgeClient 发送 prompt 的逻辑由外层调用
  },

  setWaiting: (w) => set({ waiting: w }),

  clearMessages: () => set({ messages: [], waiting: false }),
}))
