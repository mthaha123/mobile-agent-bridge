import { create } from 'zustand'

export interface ToolCallProgress {
  callID: string
  sessionID: string
  tool: string
  input: Record<string, unknown>
  status: 'called' | 'progress' | 'success' | 'failed'
  content?: unknown[]
  result?: unknown
  error?: unknown
  outputPaths?: string[]
  structured?: Record<string, unknown>
  startedAt: number
}

export interface ToolProgressState {
  activeCalls: ToolCallProgress[]

  addCall: (call: { callID: string; sessionID: string; tool: string; input: Record<string, unknown> }) => void
  updateProgress: (callID: string, data: Partial<ToolCallProgress>) => void
  markSuccess: (callID: string, content?: unknown[], result?: unknown, outputPaths?: string[]) => void
  markFailed: (callID: string, error: unknown) => void
  clearSession: (sessionID: string) => void
}

export const useToolProgressStore = create<ToolProgressState>((set) => ({
  activeCalls: [],

  addCall: (call) => {
    const progress: ToolCallProgress = {
      ...call,
      status: 'called',
      startedAt: Date.now(),
    }
    set((state) => ({ activeCalls: [...state.activeCalls, progress] }))
  },

  updateProgress: (callID, data) => {
    set((state) => ({
      activeCalls: state.activeCalls.map((c) =>
        c.callID === callID ? { ...c, ...data, status: 'progress' } : c
      ),
    }))
  },

  markSuccess: (callID, content, result, outputPaths) => {
    set((state) => ({
      activeCalls: state.activeCalls.map((c) =>
        c.callID === callID
          ? { ...c, status: 'success', content, result, outputPaths }
          : c
      ),
    }))
  },

  markFailed: (callID, error) => {
    set((state) => ({
      activeCalls: state.activeCalls.map((c) =>
        c.callID === callID ? { ...c, status: 'failed', error } : c
      ),
    }))
  },

  clearSession: (sessionID) => {
    set((state) => ({
      activeCalls: state.activeCalls.filter((c) => c.sessionID !== sessionID),
    }))
  },
}))
