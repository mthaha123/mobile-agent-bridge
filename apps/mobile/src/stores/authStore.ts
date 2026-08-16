/**
 * authStore — 认证状态管理
 *
 * 管理连接地址、JWT token、登录流程
 */
import { create } from 'zustand'
import { BridgeClient } from '../services/BridgeClient'

export interface AuthState {
  /** WebSocket URL (ws://host:port/ws) */
  bridgeUrl: string
  /** JWT token (登录成功后设置) */
  token: string | null
  /** 是否已认证 */
  authenticated: boolean
  /** 是否正在登录 */
  loading: boolean
  /** 错误信息 */
  error: string | null
  /** BridgeClient 实例 */
  client: BridgeClient | null

  setBridgeUrl: (url: string) => void
  login: (password?: string) => Promise<void>
  logout: () => void
  clearError: () => void
  refreshToken: () => Promise<void>
  setToken: (token: string) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  bridgeUrl: '',
  token: null,
  authenticated: false,
  loading: false,
  error: null,
  client: null,

  setBridgeUrl: (url: string) => {
    set({ bridgeUrl: url, error: null })
  },

  login: async (password?: string) => {
    const { bridgeUrl } = get()
    if (!bridgeUrl) {
      set({ error: '请先输入 Bridge 地址' })
      return
    }

    set({ loading: true, error: null })

    try {
      // ── 层1：连接 Bridge（WS + auth.login）──
      const loginClient = new BridgeClient({ url: bridgeUrl })
      await loginClient.connect()
      const result = (await loginClient.call('auth.login', {
        password: password ?? null,
      })) as { token: string }
      loginClient.disconnect()

      // 创建持久的已认证 client
      const client = new BridgeClient({ url: bridgeUrl, token: result.token })
      await client.connect()

      // 先设置 client 触发 AppProvider 注册通知处理器（authenticated=false，ConnectScreen 仍显示）
      set({ client, token: result.token, loading: false, error: null })

      // ── 层2：建立 OpenCode 连接（project.switch，目录为空时自动探测）──
      const { useProjectStore } = await import('./projectStore')
      const switched = await useProjectStore.getState().switchProject()
      if (!switched) {
        throw new Error('未指定项目目录，且无法探测 OpenCode 当前项目。请在连接页填写项目目录。')
      }

      // ── 层2就绪后拉取全局配置（agent/provider/model/command）──
      const { useConfigStore } = await import('./configStore')
      const call = client.call.bind(client)
      await Promise.all([
        useConfigStore.getState().fetchConfig(call),
        useConfigStore.getState().fetchAgents(call),
        useConfigStore.getState().fetchProviders(call),
        useConfigStore.getState().fetchCommands(call),
        useConfigStore.getState().fetchModels(call),
      ])

      // ── 全部就绪后标记已认证，进入 SessionsScreen ──
      set({ authenticated: true, loading: false })
    } catch (e: unknown) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '登录失败',
        authenticated: false,
      })
    }
  },

  logout: async () => {
    const { client } = get()
    if (client) {
      try { await client.call('auth.logout', {}) } catch {}
      client.destroy()
    }
    set({
      client: null,
      token: null,
      authenticated: false,
      bridgeUrl: '',
      loading: false,
      error: null,
    })
  },

  clearError: () => set({ error: null }),

  refreshToken: async () => {
    const { client } = get()
    if (!client) {
      set({ error: '未连接' })
      return
    }
    try {
      const result = (await client.call('auth.refresh', {})) as { token: string }
      set({ token: result.token, error: null })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '刷新 token 失败' })
    }
  },

  setToken: (token: string) => set({ token }),
}))
