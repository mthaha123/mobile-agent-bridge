/**
 * serveStore — 管理多个 opencode serve 实例的状态
 */
import { create } from "zustand"
import type { ClientCall } from "../services/BridgeClient"

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

  fetchServes: (call: ClientCall) => Promise<void>
  addServe: (call: ClientCall, name: string, directory: string) => Promise<ServeEntry>
  removeServe: (call: ClientCall, id: string) => Promise<void>
  startServe: (call: ClientCall, id: string) => Promise<void>
  stopServe: (call: ClientCall, id: string) => Promise<void>
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
    await call("serve.start", { id })
    // 更新状态
    set((state) => ({
      serves: state.serves.map((s) =>
        s.id === id ? { ...s, status: "running" as const } : s,
      ),
    }))
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
