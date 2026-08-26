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
  agents: unknown[]
  commands: unknown[]
  models: unknown[]
  loading: boolean
  error: string | null

  fetchAgents: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchCommands: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  fetchModels: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

// 注：config.get / config.providers 已随 Bridge stub 端点一并移除
// （2026-08 设置页重构）；agent 查询走 config.agents，模型/命令走 model.list / command.list。
export const useConfigStore = create<ConfigState>((set) => ({
  agents: [],
  commands: [],
  models: [],
  loading: false,
  error: null,

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
}))
