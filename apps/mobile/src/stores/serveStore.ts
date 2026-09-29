/**
 * serveStore — 管理多个 opencode serve 实例的状态
 */
import { create } from "zustand"

/** bridge RPC 调用签名：第 3 参用于覆盖单次调用超时（serve.start 需要更长超时） */
export type ServeCall = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
) => Promise<unknown>

/** serve.start 服务端 spawnAndVerify 的 STARTUP_TIMEOUT_MS 为 30s，
 *  客户端默认 requestTimeout 也是 30s → 必须显式放宽，否则最坏情况刚好超时 */
const SERVE_START_TIMEOUT_MS = 60_000

export interface ServeEntry {
  id: string
  name: string
  directory: string
  port: number
  status: "running" | "stopped" | "starting"
  pid?: number
  createdAt: number
}

interface ServeState {
  serves: ServeEntry[]
  loading: boolean

  fetchServes: (call: ServeCall) => Promise<void>
  addServe: (call: ServeCall, name: string, directory: string) => Promise<ServeEntry>
  removeServe: (call: ServeCall, id: string) => Promise<void>
  /** @returns serve 是否真正启动成功（服务端 startProject 返回 false → false） */
  startServe: (call: ServeCall, id: string) => Promise<boolean>
  stopServe: (call: ServeCall, id: string) => Promise<void>
}

export const useServeStore = create<ServeState>((set, get) => ({
  serves: [],
  loading: false,

  fetchServes: async (call) => {
    set({ loading: true })
    try {
      const result = await call("serve.list", {})
      set({ serves: Array.isArray(result) ? result : [] })
    } catch {
      // 静默
    } finally {
      set({ loading: false })
    }
  },

  addServe: async (call, name, directory) => {
    const result = await call("serve.add", { name, directory })
    // 刷新列表
    const serves = await call("serve.list", {})
    set({ serves: Array.isArray(serves) ? serves : [] })
    return result
  },

  removeServe: async (call, id) => {
    await call("serve.remove", { id })
    // 从本地状态移除
    set((state) => ({ serves: state.serves.filter((s) => s.id !== id) }))
  },

  startServe: async (call, id) => {
    const result = await call("serve.start", { id }, { timeoutMs: SERVE_START_TIMEOUT_MS })
    if (result === false) {
      // 启动失败（无可用端口 / opencode.exe 缺失）→ 回读服务端真实状态，交回 false
      await get().fetchServes(call)
      return false
    }
    // 更新状态
    set((state) => ({
      serves: state.serves.map((s) =>
        s.id === id ? { ...s, status: "running" as const } : s,
      ),
    }))
    return true
  },

  stopServe: async (call, id) => {
    await call("serve.stop", { id })
    set((state) => ({
      serves: state.serves.map((s) =>
        s.id === id ? { ...s, status: "stopped" as const } : s,
      ),
    }))
  },
}))
