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
  addQuestion: (q: QuestionItem) => void
  removeQuestion: (id: string) => void
  clearSession: (sessionId: string) => void
  setVisible: (v: boolean) => void
}

export const useQuestionStore = create<QuestionState>((set) => ({
  pending: [],
  visible: false,

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
}))
