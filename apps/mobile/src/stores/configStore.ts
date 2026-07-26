import { create } from 'zustand'

function extractArray(result: unknown, key: string): unknown[] {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object') {
    const v = (result as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v
  }
  return []
}

export interface ConfigState {
  config: Record<string, unknown> | null
  providers: unknown[]
  agents: unknown[]
  commands: unknown[]
  models: unknown[]
  vcs: unknown | null
  loading: boolean
  error: string | null

  fetchConfig: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchProviders: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchAgents: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchCommands: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchModels: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchVcs: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  updateConfig: (updates: Record<string, unknown>, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  providers: [],
  agents: [],
  commands: [],
  models: [],
  vcs: null,
  loading: false,
  error: null,

  fetchConfig: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = (await clientCall('config.get')) as Record<string, unknown>
      const config = (result?.config as Record<string, unknown>) || result
      set({ config, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取配置失败' })
    }
  },

  fetchProviders: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('config.providers')
      set({ providers: extractArray(result, 'providers'), loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 providers 失败' })
    }
  },

  fetchAgents: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('config.agents')
      set({ agents: extractArray(result, 'agents'), loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 agents 失败' })
    }
  },

  fetchCommands: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('command.list')
      set({ commands: extractArray(result, 'commands'), loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 commands 失败' })
    }
  },

  fetchModels: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('model.list')
      set({ models: extractArray(result, 'models'), loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 models 失败' })
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

  updateConfig: async (updates, clientCall) => {
    try {
      await clientCall('config.update', updates)
      await get().fetchConfig(clientCall)
    } catch (e: unknown) {
      console.warn('updateConfig failed:', e instanceof Error ? e.message : e)
    }
  },
}))
