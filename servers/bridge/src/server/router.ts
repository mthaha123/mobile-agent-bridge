import { WebSocket } from "ws"
import type { TokenPayload } from "./auth.js"
import { handleLogin, handleRefresh, handleLogout } from "./auth.js"
import { switchProject, getCurrentProject } from "../state/project.js"
import { getBackend } from "../adapters/OpenCodeAdapter.js"
import { fileList, fileRead, fileSearch, getFileInfo } from "./fileHandler.js"


type Handler = (params: any, payload: TokenPayload | null) => Promise<any> | any

const handlers = new Map<string, Handler>()

export function registerHandler(method: string, handler: Handler): void {
  handlers.set(method, handler)
}

export async function handleFrame(
  connID: string,
  ws: WebSocket,
  frame: any,
  payload: TokenPayload | null,
  onTokenRefreshed?: (token: string) => void,
): Promise<void> {
  if (frame.type !== "req") {
    try { ws.send(JSON.stringify({ type: "res", id: frame.id || "0", ok: false, error: "invalid frame type" })) } catch {}
    return
  }

  const method = frame.method || ""

  if (!payload && !method.startsWith("auth.")) {
    try { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: "unauthorized" })) } catch {}
    return
  }

  const handler = handlers.get(method)

  if (!handler) {
    try { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: `unknown method: ${method}` })) } catch {}
    return
  }

  try {
    const result = await handler(frame.params || {}, payload)
    // auth.login / auth.refresh 成功后更新连接 token
    if (onTokenRefreshed && result && typeof result === "object" && "token" in result) {
      onTokenRefreshed(result.token as string)
    }
    try { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: result })) } catch {}
  } catch (err: any) {
    console.error(`[Router] ${method} 错误:`, err.message)
    try { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: err.message || "internal error" })) } catch {}
  }
}

function sdk() {
  const backend = getBackend()
  if (!backend.sdk) throw new Error("SDK not initialized. Call project.switch first.")
  return backend.sdk
}

async function sdkCall<T>(call: () => Promise<{ data?: T; error?: any } | undefined>): Promise<T> {
  const result = await call()
  if (result?.error) throw new Error(result.error.message || JSON.stringify(result.error))
  return result?.data as T
}

// ===== Handler 注册 =====

function resolveSessionId(p: Record<string, unknown>): string {
  return (p.sessionId || p.sessionID || p.session_id || "") as string
}
function resolveSessionIdOrId(p: Record<string, unknown>): string {
  return (p.sessionId || p.sessionID || p.id || p.session_id || "") as string
}

/** SDK 对 list/get 类接口返回 { data, cursor } 包裹，统一解包为裸数组/裸对象
 *  让 WS payload 契约稳定：session.list → Session[]、session.messages → 事件对象[]、session.get → Session */
function unwrapData<T>(result: any): T {
  if (result && typeof result === "object" && !Array.isArray(result) && "data" in result) {
    return result.data as T
  }
  return result as T
}

registerHandler("auth.login", (params) => handleLogin(params))
registerHandler("auth.refresh", () => handleRefresh())
registerHandler("auth.logout", () => handleLogout())

registerHandler("health.ping", () => ({ ok: true }))

registerHandler("project.switch", async (params) => switchProject(params.directory))
registerHandler("project.current", async () => {
  // 用 ensureClient 探测 OpenCode 当前项目（未 project.switch 时也可查询 location）
  const loc = await sdkCall(() => getBackend().ensureClient().v2.location.get({}))
  return { directory: loc?.directory ?? getCurrentProject().directory, project: loc?.project ?? getCurrentProject().project }
})
// opencode server 1.18.x 为单项目模型，无 /project 列表端点（返回当前项目，避免挂起）
registerHandler("project.list", async () => {
  try {
    const loc = await sdkCall<{ directory?: string; project?: { name?: string; id?: string } }>(() => sdk().v2.location.get({}))
    return loc?.directory ? [{ directory: loc.directory, name: loc.project?.name || loc.project?.id || loc.directory }] : []
  } catch {
    return []
  }
})

// ===== 经由 @opencode-ai/sdk v2 的 OpenCode API 调用 =====
// SDK 内部使用 createOpencodeClient 时传入的 fetch，确保 tsx 兼容

/** 将字符串 model 转为 SDK 需要的 { id, providerID } 格式
 *  支持 "provider/model" 和 "provider/model/variant" 两种格式 */
function resolveModel(model: unknown): { id: string; providerID: string; variant?: string } | undefined {
  if (!model) return undefined
  if (typeof model === "string") {
    const parts = model.split("/").map((s) => s.trim())
    if (parts.length >= 2) return { id: parts[1], providerID: parts[0], variant: parts[2] }
    return { id: model.trim(), providerID: model.trim() }
  }
  if (typeof model === "object" && model !== null) {
    const m = model as Record<string, unknown>
    if (typeof m.id === "string" && typeof m.providerID === "string") return { id: m.id.trim(), providerID: m.providerID.trim(), variant: m.variant as string | undefined }
  }
  return undefined
}

registerHandler("session.create", async (p) => {
  const { directory } = getCurrentProject()
  const params: Record<string, unknown> = {}
  if (p.agent) params.agent = p.agent
  const model = resolveModel(p.model ?? process.env.BRIDGE_DEFAULT_MODEL)
  if (model) params.model = model
  if (p.title) params.title = p.title
  if (directory) params.location = { directory }
  const result = await sdkCall(() => sdk().v2.session.create(params))
  // SDK v3 返回 { data: { ... } } 双层 data 包裹
  return result?.data ?? result
})
registerHandler("session.list", async (p) => {
  const params: Record<string, unknown> = {}
  if (p.search) params.search = p.search
  if (p.cursor) params.cursor = p.cursor
  // 默认拉全量：serve /api/session 默认 limit=50，会导致 App 只显示最近 50 个 session。
  // App 未显式传 limit 时设一个大上限；显式传则尊重。
  params.limit = (p.limit !== undefined) ? p.limit : 500
  const list = unwrapData(await sdkCall(() => sdk().v2.session.list(params)))
  return Array.isArray(list) ? list : list
})

registerHandler("session.get", async (p) => {
  const id = resolveSessionIdOrId(p)
  if (!id) throw new Error("session.get requires sessionId parameter")
  const s = unwrapData(await sdkCall(() => sdk().v2.session.get({ sessionID: id })))
  return (s && typeof s === "object" ? s : {}) as Record<string, unknown>
})
registerHandler("session.messages", async (p) => {
  const id = resolveSessionIdOrId(p)
  if (!id) throw new Error("session.messages requires sessionId parameter")
  // 分页透传（opencode v2 messages 支持 limit/order/cursor）
  const opts: { limit?: number; order?: 'asc' | 'desc'; cursor?: string } = {}
  if (p.limit !== undefined) opts.limit = p.limit as number
  if (p.order) opts.order = p.order as 'asc' | 'desc'
  if (p.cursor) opts.cursor = p.cursor as string
  // 双通道：v2 (/api) 优先，空则回退 v1 (/session) 裸数组；统一返回 { messages, cursor }
  return getBackend().rawSessionMessages(id, opts)
})
registerHandler("session.status", async () => sdkCall(() => sdk().v2.session.active()))
registerHandler("session.active", async () => sdkCall(() => sdk().v2.session.active()))
registerHandler("session.revert", async (p) => {
  const id = resolveSessionIdOrId(p)
  if (!id) throw new Error("session.revert requires sessionId parameter")
  // v2 两步式 revert：stage（记录回退点）→ commit（应用回退）
  const stage = await sdkCall(() => sdk().v2.session.revert.stage({
    sessionID: id as string,
    ...(p.messageID ? { messageID: p.messageID as string } : {}),
    ...(p.partID ? { files: true } : {}),
  }))
  await sdkCall(() => sdk().v2.session.revert.commit({ sessionID: id as string }))
  return stage?.data ?? stage
})
registerHandler("session.switchAgent", async (p) => {
  const id = resolveSessionId(p)
  if (!id) throw new Error("session.switchAgent requires sessionId parameter")
  if (!p.agent) throw new Error("session.switchAgent requires agent parameter")
  return sdkCall(() => sdk().v2.session.switchAgent({ sessionID: id, agent: p.agent as string }))
})
registerHandler("session.switchModel", async (p) => {
  const id = resolveSessionId(p)
  if (!id) throw new Error("session.switchModel requires sessionId parameter")
  const model = resolveModel(p.model)
  if (!model) throw new Error("session.switchModel requires model parameter")
  return sdkCall(() => sdk().v2.session.switchModel({ sessionID: id, model }))
})

registerHandler("message.send", async (p) => {
  const sid = resolveSessionId(p)
  if (!sid) throw new Error("message.send requires sessionId parameter")
  if (!p.message) throw new Error("message.send requires message parameter")
  return sdkCall(() => sdk().v2.session.prompt({
    sessionID: sid,
    prompt: { text: p.message as string },
  }))
})
registerHandler("message.abort", async (p) => {
  const sid = resolveSessionId(p)
  if (!sid) throw new Error("message.abort requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.interrupt({ sessionID: sid }))
})

registerHandler("permission.reply", async (p) => {
  if (!p.id) throw new Error("permission.reply requires sessionId parameter")
  const sid = resolveSessionId(p)
  if (!sid) throw new Error("permission.reply requires sessionId parameter")
  const reply = p.reply || (p.approved ? "once" : "reject")
  return sdkCall(() => sdk().v2.session.permission.reply({
    sessionID: sid,
    requestID: p.id as string,
    reply: reply as "once" | "always" | "reject",
  }))
})
registerHandler("permission.list", async () =>
  sdkCall(() => sdk().v2.permission.request.list({})))
registerHandler("permission.saved.list", async () =>
  sdkCall(() => sdk().v2.permission.saved.list({})))
registerHandler("permission.saved.remove", async (p) => {
  if (!p.id) throw new Error("permission.saved.remove requires id parameter")
  return sdkCall(() => sdk().v2.permission.saved.remove({ id: p.id as string }))
})

registerHandler("question.reply", async (p) => {
  if (!p.id) throw new Error("question.reply requires sessionId parameter")
  const sid = resolveSessionId(p)
  if (!sid) throw new Error("question.reply requires sessionId parameter")
  const rawAnswers = p.answers
  const answers: string[][] = Array.isArray(rawAnswers)
    ? rawAnswers.length > 0 && Array.isArray(rawAnswers[0])
      ? (rawAnswers as string[][])
      : (rawAnswers as string[]).map((a: string) => [a])
    : [[p.answer as string]]
  return sdkCall(() => sdk().v2.session.question.reply({
    sessionID: sid,
    requestID: p.id as string,
    questionV2Reply: { answers },
  }))
})
registerHandler("question.reject", async (p) => {
  if (!p.id) throw new Error("question.reject requires sessionId parameter")
  const sid = resolveSessionId(p)
  if (!sid) throw new Error("question.reject requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.question.reject({
    sessionID: sid,
    requestID: p.id as string,
  }))
})

// opencode server 1.18.x 无 /config 端点：config.get/update 返回空（功能在 server 侧不存在）
registerHandler("config.get", async () => ({ config: {} }))
registerHandler("config.update", async () => ({ ok: true }))
// config.agents / config.providers / model.list / command.list 依赖 OpenCode server，
// 必须在 project.switch 建立 OpenCode 连接之后才能查询（客户端登录时序保证）。
// SDK list 类返回 { location, data: [...] }，统一解包为裸数组（与手机端 extractArray 契约一致）
registerHandler("config.agents", async () => unwrapData(await sdkCall(() => sdk().v2.agent.list({}))))
// config.providers 真实对接 /api/provider
registerHandler("config.providers", async () => {
  const providers = unwrapData(await sdkCall(() => sdk().v2.provider.list({})))
  return { providers }
})
registerHandler("provider.list", async () => unwrapData(await sdkCall(() => sdk().v2.provider.list({}))))
registerHandler("command.list", async () => unwrapData(await sdkCall(() => sdk().v2.command.list({}))))
registerHandler("model.list", async () => unwrapData(await sdkCall(() => sdk().v2.model.list({}))))

// ===== 文件操作（直接实现，不经过 SDK）=====

registerHandler("file.list", async (p) => {
  const dirPath = p.path || p.directory || "."
  return fileList(dirPath)
})

registerHandler("file.read", async (p) => {
  const filePath = p.path || p.file
  if (!filePath) throw new Error("file.read requires path parameter")
  return fileRead(filePath, p.encoding)
})

registerHandler("file.search", async (p) => {
  const query = p.query || p.search || p.pattern
  if (!query) throw new Error("file.search requires query parameter")
  return fileSearch(query, {
    pattern: p.pattern,
    dirs: p.dirs || p.directories,
    limit: p.limit,
  })
})

registerHandler("file.info", async (p) => {
  const filePath = p.path || p.file
  if (!filePath) throw new Error("file.info requires path parameter")
  return getFileInfo(filePath)
})
