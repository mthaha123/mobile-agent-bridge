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
    const { bridgeUrl, client: existingClient } = get()
    if (!bridgeUrl) {
      set({ error: '请先输入 Bridge 地址' })
      return
    }

    set({ loading: true, error: null })

    try {
      // 临时 client 用于登录
      const loginClient = new BridgeClient({ url: bridgeUrl })

      // 先连接再调用 auth.login
      await loginClient.connect('temp-token-for-login')

      const result = (await loginClient.call('auth.login', {
        password: password ?? null,
      })) as { token: string }

      loginClient.disconnect()

      // 创建持久的已认证 client
      const client = new BridgeClient({ url: bridgeUrl, token: result.token })

      await client.connect()

      set({
        client,
        token: result.token,
        authenticated: true,
        loading: false,
        error: null,
      })
    } catch (e: any) {
      set({
        loading: false,
        error: e.message || '登录失败',
        authenticated: false,
      })
    }
  },

  logout: () => {
    const { client } = get()
    client?.destroy()
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
}))
