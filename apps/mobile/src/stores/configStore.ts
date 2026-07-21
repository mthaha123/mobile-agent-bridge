import { create } from 'zustand'

export interface ConfigState {
  config: Record<string, unknown> | null
  providers: unknown[]
  agents: unknown[]
  commands: unknown[]
  vcs: unknown | null
  loading: boolean
  error: string | null

  fetchConfig: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchProviders: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchAgents: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchCommands: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchVcs: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  providers: [],
  agents: [],
  commands: [],
  vcs: null,
  loading: false,
  error: null,

  fetchConfig: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = (await clientCall('config.get')) as Record<string, unknown>
      set({ config: result, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取配置失败' })
    }
  },

  fetchProviders: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = (await clientCall('config.providers')) as unknown[]
      set({ providers: result, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 providers 失败' })
    }
  },

  fetchAgents: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = (await clientCall('config.agents')) as unknown[]
      set({ agents: result, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 agents 失败' })
    }
  },

  fetchCommands: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = (await clientCall('command.list')) as unknown[]
      set({ commands: result, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 commands 失败' })
    }
  },

  fetchVcs: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('vcs.get')
      set({ vcs: result, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 VCS 失败' })
    }
  },
}))
