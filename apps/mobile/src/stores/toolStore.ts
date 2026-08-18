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
  /** 关联的 tool callID（来自 permission.v2.asked 的 source.callID），
   *  用于 tool.success/failed 时自动清理已放行的请求 */
  sourceCallID?: string
}

export interface ToolState {
  /** 待审批的请求队列 */
  pendingApprovals: ToolApproval[]
  /** 是否显示审批界面 */
  visible: boolean
  /** 已保存的 Always Allow 规则 */
  savedRules: unknown[]
  savedRulesLoading: boolean

  enqueue: (approval: ToolApproval) => void
  dequeue: (id: string) => void
  setVisible: (v: boolean) => void
  approve: (id: string, replyCall: (id: string, reply: 'once' | 'always' | 'reject') => Promise<void>) => Promise<void>
  reject: (id: string, replyCall: (id: string, reply: 'once' | 'always' | 'reject') => Promise<void>) => Promise<void>
  alwaysAllow: (id: string, replyCall: (id: string, reply: 'once' | 'always' | 'reject') => Promise<void>) => Promise<void>
  fetchSavedRules: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
  removeSavedRule: (id: string, clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useToolStore = create<ToolState>((set, get) => ({
  pendingApprovals: [],
  visible: false,
  savedRules: [],
  savedRulesLoading: false,

  enqueue: (approval) => {
    set((state) => {
      // 去重：同一请求 id 或同一 tool call 关联的请求不重复入队，
      // 避免 session.next.tool.called 与 permission.v2.asked 双弹。
      const dup = state.pendingApprovals.some(
        (a) =>
          a.id === approval.id ||
          (approval.sourceCallID && a.sourceCallID === approval.sourceCallID),
      )
      if (dup) return state
      return {
        pendingApprovals: [...state.pendingApprovals, approval],
        visible: true,
      }
    })
  },

  dequeue: (id) => {
    set((state) => {
      const remaining = state.pendingApprovals.filter(
        (a) => a.id !== id && a.sourceCallID !== id,
      )
      return {
        pendingApprovals: remaining,
        visible: remaining.length > 0,
      }
    })
  },

  setVisible: (visible) => set({ visible }),

  approve: async (id, replyCall) => {
    await replyCall(id, 'once')
    get().dequeue(id)
  },

  reject: async (id, replyCall) => {
    await replyCall(id, 'reject')
    get().dequeue(id)
  },

  alwaysAllow: async (id, replyCall) => {
    await replyCall(id, 'always')
    get().dequeue(id)
  },

  fetchSavedRules: async (clientCall) => {
    set({ savedRulesLoading: true })
    try {
      const result = await clientCall('permission.saved.list', {})
      const rules = Array.isArray(result) ? result : ((result as Record<string, unknown>)?.rules as unknown[]) || []
      set({ savedRules: rules, savedRulesLoading: false })
    } catch {
      set({ savedRulesLoading: false })
    }
  },

  removeSavedRule: async (id, clientCall) => {
    try {
      await clientCall('permission.saved.remove', { id })
      const remaining = get().savedRules.filter((r: unknown) => (r as Record<string, unknown>).id !== id)
      set({ savedRules: remaining })
    } catch (e: unknown) {
      console.warn('removeSavedRule failed:', e instanceof Error ? e.message : e)
    }
  },
}))
