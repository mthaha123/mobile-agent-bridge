import { create } from 'zustand'

export type Tab = 'chat' | 'files' | 'settings'
export type ChatSub = 'sessions' | 'chat'
export type FilesSub = 'browser' | 'viewer'

export interface UiState {
  screen: 'connect' | 'main'
  activeTab: Tab
  chatSubScreen: ChatSub
  filesSubScreen: FilesSub
  setScreen: (s: 'connect' | 'main') => void
  setActiveTab: (t: Tab) => void
  pushChat: () => void
  popChat: () => void
  pushViewer: () => void
  popViewer: () => void
}

export const useUiStore = create<UiState>((set) => ({
  screen: 'connect',
  activeTab: 'chat',
  chatSubScreen: 'sessions',
  filesSubScreen: 'browser',

  setScreen: (screen) => set({ screen, activeTab: 'chat', chatSubScreen: 'sessions', filesSubScreen: 'browser' }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  pushChat: () => set({ chatSubScreen: 'chat' }),

  popChat: () => set({ chatSubScreen: 'sessions' }),

  pushViewer: () => set({ filesSubScreen: 'viewer' }),

  popViewer: () => set({ filesSubScreen: 'browser' }),
}))
