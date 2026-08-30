import { create } from 'zustand'

export interface QuestionOption {
  label: string
  description: string
}

export interface SingleQuestion {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionItem {
  id: string
  sessionId: string
  questions: SingleQuestion[]
  tool?: { messageID: string; callID: string }
}

export interface QuestionState {
  pending: QuestionItem[]
  visible: boolean
  /** 当前"正在被内联 Dock 展示"的会话（ChatScreen 挂载时写入，退出置空）。
   *  决定弹框归属：属于该会话的提问走内联 QuestionDock，其余走全局 QuestionSheet。
   *  两者互斥，避免同一个提问被弹两次。 */
  visibleSessionId: string | null
  addQuestion: (q: QuestionItem) => void
  removeQuestion: (id: string) => void
  clearSession: (sessionId: string) => void
  setVisible: (v: boolean) => void
  setVisibleSession: (sessionId: string | null) => void
}

export const useQuestionStore = create<QuestionState>((set) => ({
  pending: [],
  visible: false,
  visibleSessionId: null,

  addQuestion: (q) =>
    set((s) => ({
      pending: [...s.pending, q],
      visible: true,
    })),

  removeQuestion: (id) =>
    set((s) => {
      const remaining = s.pending.filter((x) => x.id !== id)
      return { pending: remaining, visible: remaining.length > 0 }
    }),

  clearSession: (sessionId) =>
    set((s) => {
      const remaining = s.pending.filter((x) => x.sessionId !== sessionId)
      return { pending: remaining, visible: remaining.length > 0 }
    }),

  setVisible: (visible) => set({ visible }),

  setVisibleSession: (sessionId) => set({ visibleSessionId: sessionId }),
}))
