// ===== WS 帧类型 =====

export interface WsReq {
  type: "req"
  id: string
  method: string
  params: Record<string, unknown>
}

export interface WsRes {
  type: "res"
  id: string
  ok: boolean
  payload?: unknown
  error?: string
}

export interface WsNotify {
  type: "notify"
  method: string
  payload: unknown
}

export type WsFrame = WsReq | WsRes | WsNotify

// ===== 认证 (Bridge 直接实现) =====

export interface AuthLoginParams {
  password?: string
}

export interface AuthLoginResult {
  token: string
  expiresIn: number
}

export interface AuthRefreshResult {
  token: string
  expiresIn: number
}

export interface AuthLogoutResult {
  ok: true
}

// ===== 项目设置 (Bridge 直接实现) =====

export interface ProjectSetupParams {
  directory: string
}

export interface ProjectInfo {
  directory: string
  project?: { name?: string }
}

export interface ProjectSetupResult {
  directory: string
  project?: { name?: string }
}

export interface ProjectCurrentResult {
  directory: string | null
  project: { name?: string } | null
}

// ===== 会话管理 (代理 → v2 命名空间) =====

export interface SessionCreateParams {
  agent?: string
  model?: string
  /** @deprecated v2 session.create 不支持 title */
  title?: string
}

export interface SessionListParams {
  search?: string
  limit?: number
}

export interface SessionGetParams {
  sessionID: string
}

export interface SessionDeleteParams {
  sessionID: string
}

export interface SessionUpdateParams {
  sessionID: string
  title?: string
}

export interface SessionMessagesParams {
  sessionID: string
  limit?: number
}

export interface SessionStatusResult {
  running: boolean
  sessionID?: string
}

/** v2.session.messages 返回的分页格式 */
export interface PaginatedMessages {
  data: unknown[]
  cursor?: { previous?: string; next?: string }
}

/** v2.session.list 返回的分页格式 */
export interface PaginatedSessions {
  data: unknown[]
  cursor?: { previous?: string; next?: string }
}

// ===== 消息通信 (代理 → v2 命名空间) =====

export interface MessageSendParams {
  sessionID: string
  message: string
}

export interface MessageAbortParams {
  sessionID: string
}

// ===== 工具审批 (代理 → v2.session.permission) =====

export interface PermissionReplyParams {
  requestID: string
  sessionID: string
  reply?: "once" | "always" | "reject"
  message?: string
}

// ===== 问答系统 (代理 → v2.session.question) =====

export interface QuestionReplyParams {
  requestID: string
  sessionID: string
  answers?: string[][]
}

export interface QuestionRejectParams {
  requestID: string
  sessionID: string
}

// ===== 文件操作 (Bridge 直接实现) =====

export interface FileListParams {
  path: string
}

export interface FileEntry {
  name: string
  type: "file" | "dir"
  size?: number
  modifiedAt?: string
}

export interface FileReadParams {
  path: string
}

export interface FileReadResult {
  content: string
  encoding: string
}

export interface FileSearchParams {
  query: string
  pattern?: string
  dirs?: string[]
  limit?: number
}

export interface FileSearchResult {
  file: string
  line: number
  content: string
}

// ===== 配置与项目 =====

export interface ConfigGetResult {
  [key: string]: unknown
}

export interface ProviderInfo {
  id: string
  name: string
  models: string[]
}

export interface AgentInfo {
  id: string
  name: string
  description?: string
}

export interface VcsInfo {
  branch?: string
  default_branch?: string
}

export interface CommandInfo {
  name: string
  description?: string
}

// ===== V2Event 格式 (SSE → notify 帧的 payload 结构) =====

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

/** 推理增量 */
export interface SessionNextReasoningDelta {
  sessionID: string
  assistantMessageID: string
  reasoningID: string
  delta: string
}

/** 工具被调用 */
export interface SessionNextToolCalled {
  sessionID: string
  assistantMessageID: string
  callID: string
  tool: string
  input: Record<string, unknown>
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
  status: { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number; message: string; next: number }
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

/** Part 增量更新 */
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

/** 项目切换 */
export interface ProjectChangedEvent {
  directory: string
  project?: { name?: string }
}

/** V2Event 完整类型（SSE 流中每条事件的结构） */
export interface V2Event {
  id: string
  type: string
  metadata?: Record<string, unknown>
  durable?: {
    aggregateID: string
    seq: number
    version: number
  }
  location?: { directory: string; workspaceID?: string }
  data: Record<string, unknown>
}
