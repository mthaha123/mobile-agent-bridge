/**
 * toolStore — 工具审批状态管理
 *
 * 管理 AI 请求执行工具时的审批流程
 */
import { create } from 'zustand'

export interface ToolApproval {
  id: string
  /** 工具名称 */
  tool: string
  /** 工具参数 */
  args: Record<string, unknown>
  /** 请求来源 */
  sessionId: string
  /** 请求时间 */
  requestedAt: number
}

export interface ToolState {
  /** 待审批的请求队列 */
  pendingApprovals: ToolApproval[]
  /** 是否显示审批界面 */
  visible: boolean

  enqueue: (approval: ToolApproval) => void
  dequeue: (id: string) => void
  setVisible: (v: boolean) => void
  approve: (id: string, replyCall: (id: string, approved: boolean) => Promise<void>) => Promise<void>
  reject: (id: string, replyCall: (id: string, approved: boolean) => Promise<void>) => Promise<void>
}

export const useToolStore = create<ToolState>((set, get) => ({
  pendingApprovals: [],
  visible: false,

  enqueue: (approval) => {
    set((state) => ({
      pendingApprovals: [...state.pendingApprovals, approval],
      visible: true,
    }))
  },

  dequeue: (id) => {
    set((state) => {
      const remaining = state.pendingApprovals.filter((a) => a.id !== id)
      return {
        pendingApprovals: remaining,
        visible: remaining.length > 0,
      }
    })
  },

  setVisible: (visible) => set({ visible }),

  approve: async (id, replyCall) => {
    await replyCall(id, true)
    get().dequeue(id)
  },

  reject: async (id, replyCall) => {
    await replyCall(id, false)
    get().dequeue(id)
  },
}))
