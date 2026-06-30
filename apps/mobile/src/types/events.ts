/**
 * BridgeClient 类型补充
 */

export interface ToolApprovalEvent {
  id: string
  name: string
  arguments: Record<string, unknown>
  sessionId?: string
}

export interface MessagePartEvent {
  message: string
  text?: string
  done?: boolean
}
