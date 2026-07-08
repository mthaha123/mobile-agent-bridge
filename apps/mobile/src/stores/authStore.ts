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
  /** OpenCode 项目目录 */
  directory: string

  setBridgeUrl: (url: string) => void
  setDirectory: (dir: string) => void
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
  directory: '',

  setBridgeUrl: (url: string) => {
    set({ bridgeUrl: url, error: null })
  },

  setDirectory: (dir: string) => {
    set({ directory: dir })
  },

  login: async (password?: string) => {
    const { bridgeUrl, directory } = get()
    if (!bridgeUrl) {
      set({ error: '请先输入 Bridge 地址' })
      return
    }

    set({ loading: true, error: null })

    try {
      // 临时 client 用于登录（无需 token，服务器接受未认证连接）
      const loginClient = new BridgeClient({ url: bridgeUrl })

      // 先连接再调用 auth.login
      await loginClient.connect()

      const result = (await loginClient.call('auth.login', {
        password: password ?? null,
      })) as { token: string }

      loginClient.disconnect()

      // 创建持久的已认证 client
      const client = new BridgeClient({ url: bridgeUrl, token: result.token })

      await client.connect()

      // 步骤1：先设置 client 触发 AppProvider 注册通知处理器
      // 此时 authenticated=false，ConnectScreen 仍然显示
      set({ client, token: result.token, loading: false, error: null })

      // 步骤2：注册完处理器后再启动 project.setup（SSE 事件流）
      // handler 已就绪，不会丢失初始化事件
      const setupDir = directory || '/'
      await client.call('project.setup', { directory: setupDir })

      // 步骤3：最后标记已认证，页面跳转至 SessionsScreen
      set({ authenticated: true, loading: false })
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
      directory: '',
      loading: false,
      error: null,
    })
  },

  clearError: () => set({ error: null }),
}))
