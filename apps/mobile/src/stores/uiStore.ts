import { create } from 'zustand'

export type Tab = 'chat' | 'files' | 'settings'
export type ChatSub = 'sessions' | 'chat'

export interface UiState {
  screen: 'connect' | 'main'
  activeTab: Tab
  chatSubScreen: ChatSub
  setScreen: (s: 'connect' | 'main') => void
  setActiveTab: (t: Tab) => void
  pushChat: () => void
  popChat: () => void
}

export const useUiStore = create<UiState>((set) => ({
  screen: 'connect',
  activeTab: 'chat',
  chatSubScreen: 'sessions',

  setScreen: (screen) => set({ screen, activeTab: 'chat', chatSubScreen: 'sessions' }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  pushChat: () => set({ chatSubScreen: 'chat' }),

  popChat: () => set({ chatSubScreen: 'sessions' }),
}))
