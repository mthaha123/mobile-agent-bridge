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

  setDiffs: (sessionID: string, diffs: FileDiff[]) => void
  clearSession: (sessionID: string) => void
}

export const useDiffStore = create<DiffState>((set) => ({
  diffs: {},

  setDiffs: (sessionID, diffs) => {
    set((state) => ({
      diffs: { ...state.diffs, [sessionID]: diffs },
    }))
  },

  clearSession: (sessionID) => {
    set((state) => {
      const remaining = { ...state.diffs }
      delete remaining[sessionID]
      return { diffs: remaining }
    })
  },
}))
