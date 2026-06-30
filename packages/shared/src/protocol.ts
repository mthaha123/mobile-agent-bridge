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

export interface WsEvent {
  type: "event"
  event: string
  data: unknown
}

export type WsFrame = WsReq | WsRes | WsEvent

// ===== 认证 (Bridge 直接实现) §2.1 ====

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

// ===== 项目设置 (Bridge 直接实现，Phase 1 新增) ====

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

// ===== 会话管理 (代理 → client.session.*) §2.2 ====

export interface SessionCreateParams {
  sessionID?: string
  title?: string
  agent?: string
  model?: string
  parentID?: string
  permission?: string
  workspaceID?: string
}

export interface SessionInfo {
  id: string
  title: string
  status: string
  createdAt: string
  agent?: string
  model?: string
}

export interface SessionListParams {
  scope?: string
  path?: string
  roots?: string[]
  start?: string
  search?: string
  limit?: number
}

export interface SessionGetParams {
  sessionID: string
}

export interface SessionDeleteParams {
  sessionID: string
}

export interface SessionRenameParams {
  sessionID: string
  title: string
}

export interface SessionMessagesParams {
  sessionID: string
  limit?: number
  before?: string
}

export interface SessionStatusResult {
  running: boolean
  sessionID?: string
}

// ===== 消息通信 (代理 → client.session.*) §2.3 ====

export interface MessageSendParams {
  sessionID: string
  parts: unknown[]
}

export interface MessageAbortParams {
  sessionID: string
}

export interface MessageShellParams {
  sessionID: string
  command: string
  agent?: string
  model?: unknown
}

export interface MessageCommandParams {
  sessionID: string
  command: string
  arguments?: string
  agent?: string
}

// ===== 工具审批 (代理 → client.permission.*) §2.4 ====

export interface PermissionReplyParams {
  requestID: string
  reply?: "once" | "always" | "reject"
  message?: string
}

// ===== 问答系统 (代理 → client.question.*) §2.5 ====

export interface QuestionReplyParams {
  requestID: string
  answers?: unknown[]
}

export interface QuestionRejectParams {
  requestID: string
}

// ===== 文件操作 (Bridge 直接实现) §2.6 ====

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

// ===== 配置与项目 (代理 → client.config.*) §2.7 ====

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
  branch: string
  status: string
}

export interface CommandInfo {
  name: string
  description: string
}

// ===== 事件 (Bridge SSE→WS 转发) §2.3-§2.5 ====

export interface MessagePartUpdatedEvent {
  sessionID: string
  messageID: string
  delta: string
}

export interface SessionIdleEvent {
  sessionID: string
}

export interface SessionErrorEvent {
  sessionID: string
  error: string
}

export interface PermissionAskedEvent {
  requestID: string
  sessionID: string
  tool: string
  args: unknown
}

export interface PermissionRepliedEvent {
  requestID: string
  reply: string
}

export interface QuestionAskedEvent {
  requestID: string
  questions: unknown[]
}

export interface ProjectChangedEvent {
  directory: string
  project?: { name?: string }
}

export interface TodoUpdatedEvent {
  sessionID: string
  todos: unknown[]
}

export interface SessionDiffEvent {
  sessionID: string
  files: unknown[]
}
