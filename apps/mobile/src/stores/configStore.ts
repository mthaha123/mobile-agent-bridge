import { create } from 'zustand'

function extractArray(result: unknown, key: string): unknown[] {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object') {
    const v = (result as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v
  }
  return []
}

/** 配置绝对到期阈值：距上次成功刷新超过该时长即视为过期 */
export const CONFIG_REFRESH_TTL_MS = 5 * 60 * 1000

export type ClientCall = (method: string, params?: unknown) => Promise<unknown>

export interface ConfigState {
  agents: unknown[]
  commands: unknown[]
  models: unknown[]
  loading: boolean
  error: string | null
  /** 上次任一配置成功刷新的时间戳（0=尚未刷新过）。绝对到期调度的唯一事实来源 */
  lastRefreshedAt: number
  /** 是否有一次 refreshAll 正在进行（重入保护） */
  refreshing: boolean

  fetchAgents: (clientCall: ClientCall) => Promise<void>
  fetchCommands: (clientCall: ClientCall) => Promise<void>
  fetchModels: (clientCall: ClientCall) => Promise<void>
  /** 并发重拉 agents/commands/models；成功才覆盖，失败保留旧值 */
  refreshAll: (clientCall: ClientCall, opts?: { force?: boolean }) => Promise<void>
  /** 距下一次绝对到期还有多少 ms（未刷新过 → TTL） */
  msUntilRefreshDue: () => number
}

// 注：config.get / config.providers 已随 Bridge stub 端点一并移除
// （2026-08 设置页重构）；agent 查询走 config.agents，模型/命令走 model.list / command.list。
export const useConfigStore = create<ConfigState>((set, get) => ({
  agents: [],
  commands: [],
  models: [],
  loading: false,
  error: null,
  lastRefreshedAt: 0,
  refreshing: false,

  fetchAgents: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('config.agents')
      set({ agents: extractArray(result, 'agents'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 agents 失败' })
    }
  },

  fetchCommands: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('command.list')
      set({ commands: extractArray(result, 'commands'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 commands 失败' })
    }
  },

  fetchModels: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('model.list')
      set({ models: extractArray(result, 'models'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 models 失败' })
    }
  },

  refreshAll: async (clientCall, opts) => {
    const { refreshing, lastRefreshedAt } = get()
    if (refreshing) return
    const fresh = lastRefreshedAt > 0 && Date.now() - lastRefreshedAt < CONFIG_REFRESH_TTL_MS
    if (fresh && !opts?.force) return
    set({ refreshing: true })
    try {
      // 单点失败不影响其它；各 fetchX 内部已 catch，失败保留旧值
      await Promise.allSettled([
        get().fetchAgents(clientCall),
        get().fetchCommands(clientCall),
        get().fetchModels(clientCall),
      ])
    } finally {
      set({ refreshing: false })
    }
  },

  msUntilRefreshDue: () => {
    const { lastRefreshedAt } = get()
    if (!lastRefreshedAt) return CONFIG_REFRESH_TTL_MS
    return Math.max(0, lastRefreshedAt + CONFIG_REFRESH_TTL_MS - Date.now())
  },
}))
