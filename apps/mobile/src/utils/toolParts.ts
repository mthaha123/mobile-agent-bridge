/**
 * tool part 归一化工具 —— 服务端数据形态 → App 渲染形态的唯一转换层。
 *
 * 背景（bug 根因）：chatStore 与 ChatScreen 各自维护了一份转换逻辑，
 * 漂移导致两类真实问题：
 *   1. 结果提取只读 state.output/state.content，而 opencode 持久化的
 *      bash 输出实际在 state.metadata.output → 重载后 bash 输出丢失；
 *   2. 状态映射缺 'pending'/'running' 分支 → 原样透传进 UI，
 *      渲染成"无图标无结果"的未完成卡片（服务端 part 卡死在 running 时永不修复）。
 * 此处收敛为单一实现，两侧（live ingest / 历史加载）共用。
 */
import type { Part } from '../types/message'
import type { ToolStatus } from '../stores/chatStore'

/** 非终态：仍显示"运行中" */
export function isOpenToolStatus(status: unknown): status is 'called' | 'progress' {
  return status === 'called' || status === 'progress'
}

/** 终态：不再变化（对账时以终态为准） */
export function isTerminalToolStatus(status: unknown): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled' || status === 'rejected'
}

/**
 * SDK v2 持久化状态 → App ToolStatus。
 * opencode part.state.status ∈ pending | running | completed | error。
 * 未识别值兜底为 called（有输入即视为已发起），绝不把未知值透传给渲染层。
 */
export function normalizeToolStatus(stateStatus?: string): ToolStatus {
  switch (stateStatus) {
    case 'completed': return 'success'
    case 'error': return 'failed'
    case 'pending': return 'called'
    case 'running': return 'progress'
    default:
      return (isOpenToolStatus(stateStatus) || isTerminalToolStatus(stateStatus)
        ? (stateStatus as ToolStatus)
        : 'called')
  }
}

/** 从持久化 state 提取可展示输出文本。metadata.output 是 bash 类工具的真实输出位置。 */
export function extractToolStateOutput(state: any): string {
  if (!state || typeof state !== 'object') return ''
  if (Array.isArray(state.content)) {
    return state.content
      .filter((c: any) => c && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
  }
  const meta = state.metadata
  if (typeof meta?.output === 'string') return meta.output
  if (typeof state.output === 'string') return state.output
  if (state.output && typeof state.output === 'object') return JSON.stringify(state.output)
  return ''
}

/**
 * 服务端原始 tool part（v1/v2 持久化形态、message.part.updated 载荷）→ App Part。
 *
 * 身份规则：优先 callID。live 流（session.next.tool.*）以 callID 为 id 更新状态；
 * 若历史加载用 prt_* 当 id，同一工具会被当成两个 part（更新匹配失败 + 卡片重复）。
 */
export function buildToolPartFromRaw(p: any): Part | null {
  if (!p || typeof p !== 'object') return null
  const callID = String(p.callID || p.id || '')
  if (!callID) return null
  const state = p.state ?? {}
  // 边界层输出按 Part.data 的宽类型承载（ToolPartData 接口无隐式索引签名，
  // 直接赋给 Record<string, unknown> 会报 TS2322；消费侧用 normalizeToolPartData 收窄）
  const data: Record<string, unknown> = {
    tool: String(p.tool || p.name || state.title || ''),
    input: (state.input ?? p.input ?? {}) as Record<string, unknown>,
    status: normalizeToolStatus(state.status),
    result: extractToolStateOutput(state),
  }
  if (state.error != null) data.error = state.error
  if (state.title) data.title = String(state.title)
  if (Array.isArray(p.outputPaths) && p.outputPaths.length > 0) data.outputPaths = p.outputPaths
  return { id: callID, type: 'tool', data }
}
