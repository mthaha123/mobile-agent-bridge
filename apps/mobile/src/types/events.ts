/**
 * Bridge notify 帧的事件类型定义
 *
 * 对应 OpenCode SDK v2 V2Event 格式：
 * SSE 流中每条事件为 { id, type, data }，Bridge 转发为 WS notify 帧
 * { type: "notify", method: event.type, payload: event.data }
 */

/** 流式文本增量 */
export interface SessionNextTextDelta {
  sessionID: string
  assistantMessageID: string
  textID: string
  delta: string
}

/** 文本段结束 */
export interface SessionNextTextEnded {
  sessionID: string
  assistantMessageID: string
  textID: string
  text: string
}

/** 推理内容增量 */
export interface SessionNextReasoningDelta {
  sessionID: string
  assistantMessageID: string
  reasoningID: string
  delta: string
}

/** 推理结束 */
export interface SessionNextReasoningEnded {
  sessionID: string
  assistantMessageID: string
  reasoningID: string
  text: string
}

/** 工具被调用 */
export interface SessionNextToolCalled {
  sessionID: string
  assistantMessageID: string
  callID: string
  tool: string
  input: Record<string, unknown>
}

/** 工具执行进度 */
export interface SessionNextToolProgress {
  sessionID: string
  assistantMessageID: string
  callID: string
  structured: Record<string, unknown>
  content: unknown[]
}

/** 工具成功 */
export interface SessionNextToolSuccess {
  sessionID: string
  assistantMessageID: string
  callID: string
  content: unknown[]
  result?: unknown
  outputPaths?: string[]
}

/** 工具失败 */
export interface SessionNextToolFailed {
  sessionID: string
  assistantMessageID: string
  callID: string
  error: unknown
}

/** 步骤开始 */
export interface SessionNextStepStarted {
  sessionID: string
  assistantMessageID: string
  agent: string
  model: { id: string; providerID: string }
  snapshot?: string
}

/** 步骤结束 */
export interface SessionNextStepEnded {
  sessionID: string
  assistantMessageID: string
  finish: string
  cost: number
  tokens: { input: number; output: number; reasoning: number }
  snapshot?: string
  files?: string[]
}

/** 会话 idle */
export interface SessionIdleEvent {
  sessionID: string
}

/** 会话错误 */
export interface SessionErrorEvent {
  sessionID?: string
  error?: unknown
}

/** 会话状态变更 */
export interface SessionStatusEvent {
  sessionID: string
  status:
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number }
}

/** 权限请求 (v2) */
export interface PermissionV2AskedEvent {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  metadata?: Record<string, unknown>
  source?: { type: "tool"; messageID: string; callID: string }
}

/** 权限已处理 */
export interface PermissionV2RepliedEvent {
  sessionID: string
  requestID: string
  reply: "once" | "always" | "reject"
}

/** 问答请求 */
export interface QuestionV2AskedEvent {
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
  tool?: { messageID: string; callID: string }
}

/** Part 字段增量更新 */
export interface MessagePartDeltaEvent {
  sessionID: string
  messageID: string
  partID: string
  field: string
  delta: string
}

/** 文件变更 */
export interface SessionDiffEvent {
  sessionID: string
  diff: Array<{
    file?: string
    patch?: string
    additions: number
    deletions: number
    status?: "added" | "deleted" | "modified"
  }>
}

/** 待办更新 */
export interface TodoUpdatedEvent {
  sessionID: string
  todos: Array<{
    content: string
    status: string
    priority: string
  }>
}

/** 项目切换事件 */
export interface ProjectChangedEvent {
  directory: string
  project?: { name?: string }
}

/** 全部已知 event method 到 payload 类型的映射 */
export interface BridgeEventMap {
  "session.next.text.delta": SessionNextTextDelta
  "session.next.text.ended": SessionNextTextEnded
  "session.next.reasoning.delta": SessionNextReasoningDelta
  "session.next.reasoning.ended": SessionNextReasoningEnded
  "session.next.tool.called": SessionNextToolCalled
  "session.next.tool.progress": SessionNextToolProgress
  "session.next.tool.success": SessionNextToolSuccess
  "session.next.tool.failed": SessionNextToolFailed
  "session.next.step.started": SessionNextStepStarted
  "session.next.step.ended": SessionNextStepEnded
  "session.idle": SessionIdleEvent
  "session.error": SessionErrorEvent
  "session.status": SessionStatusEvent
  "permission.v2.asked": PermissionV2AskedEvent
  "permission.v2.replied": PermissionV2RepliedEvent
  "question.v2.asked": QuestionV2AskedEvent
  "message.part.delta": MessagePartDeltaEvent
  "session.diff": SessionDiffEvent
  "todo.updated": TodoUpdatedEvent
  "project.changed": ProjectChangedEvent
}
