import { WebSocket } from "ws"
import type { TokenPayload } from "./auth.js"
import { handleLogin, handleRefresh, handleLogout } from "./auth.js"
import { switchProject, getCurrentProject } from "../state/project.js"
import { getBackend } from "../adapters/OpenCodeAdapter.js"

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

async function sdkCall<T>(call: () => Promise<{ data?: T; error?: any }>): Promise<T> {
  const result = await call()
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error))
  return result.data as T
}

// ===== Handler 注册 =====

registerHandler("auth.login", (params) => handleLogin(params))
registerHandler("auth.refresh", () => handleRefresh())
registerHandler("auth.logout", () => handleLogout())

registerHandler("health.ping", () => ({ ok: true }))

registerHandler("project.switch", async (params) => switchProject(params.directory))
registerHandler("project.current", async () => getCurrentProject())

// ===== 经由 @opencode-ai/sdk v2 的 OpenCode API 调用 =====
// SDK 内部使用 createOpencodeClient 时传入的 fetch，确保 tsx 兼容

/** 将字符串 model 转为 SDK 需要的 { id, providerID } 格式 */
function resolveModel(model: unknown): { id: string; providerID: string; variant?: string } | undefined {
  if (!model) return undefined
  if (typeof model === "string") return { id: model, providerID: model }
  if (typeof model === "object" && model !== null) {
    const m = model as Record<string, unknown>
    if (typeof m.id === "string" && typeof m.providerID === "string") return { id: m.id, providerID: m.providerID, variant: m.variant as string | undefined }
  }
  return undefined
}

registerHandler("session.create", async (p) => {
  const params: Record<string, unknown> = {}
  if (p.agent) params.agent = p.agent
  const model = resolveModel(p.model)
  if (model) params.model = model
  if (p.title) params.title = p.title
  return sdkCall(() => sdk().session.create(params))
})
registerHandler("session.list", async (p) => {
  const params: Record<string, unknown> = {}
  if (p.search) params.search = p.search
  if (p.limit) params.limit = p.limit
  if (p.cursor) params.cursor = p.cursor
  return sdkCall(() => sdk().v2.session.list(params))
})
registerHandler("session.get", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.get requires id parameter")
  return sdkCall(() => sdk().v2.session.get({ sessionID: id }))
})
registerHandler("session.messages", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.messages requires id parameter")
  return sdkCall(() => sdk().v2.session.messages({ sessionID: id }))
})
registerHandler("session.status", async () => sdkCall(() => sdk().v2.session.active()))
registerHandler("session.active", async () => sdkCall(() => sdk().v2.session.active()))
registerHandler("session.delete", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.delete requires id parameter")
  return sdkCall(() => sdk().session.delete({ sessionID: id }))
})
registerHandler("session.update", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.update requires id parameter")
  return sdkCall(() => sdk().session.update({
    sessionID: id,
    ...(p.title ? { title: p.title } : {}),
  }))
})
registerHandler("session.rename", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.rename requires id parameter")
  return sdkCall(() => sdk().session.update({
    sessionID: id,
    ...(p.name || p.title ? { title: p.name || p.title } : {}),
  }))
})
registerHandler("session.todo", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.todo requires id parameter")
  return sdkCall(() => sdk().session.todo({ sessionID: id }))
})
registerHandler("session.diff", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.diff requires id parameter")
  return sdkCall(() => sdk().session.diff({
    sessionID: id as string,
    ...(p.messageID || p.message ? { messageID: (p.messageID || p.message) as string } : {}),
  }))
})
registerHandler("session.fork", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.fork requires id parameter")
  return sdkCall(() => sdk().session.fork({
    sessionID: id,
    ...(p.messageID || p.message ? { messageID: p.messageID || p.message } : {}),
  }))
})
registerHandler("session.revert", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.revert requires id parameter")
  return sdkCall(() => sdk().session.revert({
    sessionID: id as string,
    ...(p.messageID ? { messageID: p.messageID as string } : {}),
    ...(p.partID ? { partID: p.partID as string } : {}),
  }))
})
registerHandler("session.unrevert", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.unrevert requires id parameter")
  return sdkCall(() => sdk().session.unrevert({ sessionID: id }))
})
function sessionId(p: Record<string, unknown>): string {
  return (p.sessionID || p.sessionId || "") as string
}

registerHandler("message.send", async (p) => {
  const sid = sessionId(p)
  if (!sid) throw new Error("message.send requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().v2.session.prompt({
    sessionID: sid,
    prompt: { text: p.message || "" as string },
  }))
})
registerHandler("message.abort", async (p) => {
  const sid = sessionId(p)
  if (!sid) throw new Error("message.abort requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().v2.session.interrupt({ sessionID: sid }))
})
registerHandler("message.shell", async (p) => {
  const sid = sessionId(p)
  if (!sid) throw new Error("message.shell requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().session.shell({
    sessionID: sid,
    ...(p.command ? { command: p.command as string } : {}),
  }))
})
registerHandler("message.command", async (p) => {
  const sid = sessionId(p)
  if (!sid) throw new Error("message.command requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().session.command({
    sessionID: sid,
    ...(p.command ? { command: p.command as string } : {}),
  }))
})

registerHandler("permission.reply", async (p) => {
  if (!p.id) throw new Error("permission.reply requires id parameter")
  const sid = sessionId(p)
  if (!sid) throw new Error("permission.reply requires sessionID/sessionId parameter")
  const reply = p.reply || (p.approved ? "once" : "reject")
  return sdkCall(() => sdk().v2.session.permission.reply({
    sessionID: sid,
    requestID: p.id as string,
    reply: reply as "once" | "always" | "reject",
  }))
})

registerHandler("question.reply", async (p) => {
  if (!p.id) throw new Error("question.reply requires id parameter")
  const sid = sessionId(p)
  if (!sid) throw new Error("question.reply requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().v2.session.question.reply({
    sessionID: sid,
    requestID: p.id as string,
    questionV2Reply: { answers: p.answers as string[][] || [[p.answer as string]] },
  }))
})
registerHandler("question.reject", async (p) => {
  if (!p.id) throw new Error("question.reject requires id parameter")
  const sid = sessionId(p)
  if (!sid) throw new Error("question.reject requires sessionID/sessionId parameter")
  return sdkCall(() => sdk().v2.session.question.reject({
    sessionID: sid,
    requestID: p.id as string,
  }))
})

registerHandler("config.get", async () => sdkCall(() => sdk().global.config.get()))
registerHandler("config.agents", async () => sdkCall(() => sdk().v2.agent.list({})))
registerHandler("config.providers", async () => sdkCall(() => sdk().config.providers({})))
registerHandler("provider.list", async () => sdkCall(() => sdk().v2.provider.list({})))
registerHandler("command.list", async () => sdkCall(() => sdk().v2.command.list({})))
registerHandler("vcs.get", async () => sdkCall(() => sdk().vcs.get({})))
