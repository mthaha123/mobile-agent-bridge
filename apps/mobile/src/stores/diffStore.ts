import { create } from 'zustand'

export interface FileDiff {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: 'added' | 'deleted' | 'modified'
}

export interface DiffState {
  diffs: Record<string, FileDiff[]>

  setDiffs: (sessionId: string, diffs: FileDiff[]) => void
  clearSession: (sessionId: string) => void
}

export const useDiffStore = create<DiffState>((set) => ({
  diffs: {},

  setDiffs: (sessionId, diffs) => {
    set((state) => ({
      diffs: { ...state.diffs, [sessionId]: diffs },
    }))
  },

  clearSession: (sessionId) => {
    set((state) => {
      const remaining = { ...state.diffs }
      delete remaining[sessionId]
      return { diffs: remaining }
    })
  },
}))
