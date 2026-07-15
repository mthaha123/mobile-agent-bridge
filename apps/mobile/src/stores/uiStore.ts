import { create } from 'zustand'

export type Screen = 'connect' | 'sessions' | 'chat' | 'filebrowser'

export interface UiState {
  screen: Screen
  previousScreen: Screen | null
  setScreen: (screen: Screen) => void
  goBack: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  screen: 'connect',
  previousScreen: null,

  setScreen: (screen) => {
    const prev = get().screen
    if (prev !== screen) {
      set({ screen, previousScreen: prev })
    }
  },

  goBack: () => {
    const prev = get().previousScreen
    if (prev) {
      set({ screen: prev, previousScreen: null })
    }
  },
}))
