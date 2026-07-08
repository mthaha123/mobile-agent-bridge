import { WebSocket } from "ws"
import type { TokenPayload } from "./auth.js"
import { handleLogin, handleRefresh, handleLogout } from "./auth.js"
import { setupProject, getCurrentProject } from "../state/project.js"
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
  if (!backend.sdk) throw new Error("SDK not initialized. Call project.setup first.")
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

registerHandler("project.setup", async (params) => setupProject(params.directory))
registerHandler("project.current", async () => getCurrentProject())

// ===== 经由 @opencode-ai/sdk v2 的 OpenCode API 调用 =====
// SDK 内部使用 createOpencodeClient 时传入的 fetch，确保 tsx 兼容

registerHandler("session.create", async (p) => {
  const params: Record<string, unknown> = {}
  if (p.agent) params.agent = p.agent
  if (p.model) params.model = p.model
  if (p.title) params.title = p.title
  return sdkCall(() => sdk().session.create(params))
})
registerHandler("session.list", async () => sdkCall(() => sdk().v2.session.list({})))
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
  return sdkCall(() => sdk().session.diff({ sessionID: id }))
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
  return sdkCall(() => sdk().session.revert({ sessionID: id }))
})
registerHandler("session.unrevert", async (p) => {
  const id = p.id || p.sessionID || p.session_id
  if (!id) throw new Error("session.unrevert requires id parameter")
  return sdkCall(() => sdk().session.unrevert({ sessionID: id }))
})
registerHandler("message.send", async (p) => {
  if (!p.sessionId) throw new Error("message.send requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.prompt({
    sessionID: p.sessionId,
    prompt: { text: p.message || "" },
  }))
})
registerHandler("message.abort", async (p) => {
  if (!p.sessionId) throw new Error("message.abort requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.interrupt({ sessionID: p.sessionId }))
})
registerHandler("message.shell", async (p) => {
  if (!p.sessionId) throw new Error("message.shell requires sessionId parameter")
  return sdkCall(() => sdk().session.shell({
    sessionID: p.sessionId,
    ...(p.command ? { command: p.command } : {}),
  }))
})
registerHandler("message.command", async (p) => {
  if (!p.sessionId) throw new Error("message.command requires sessionId parameter")
  return sdkCall(() => sdk().session.command({
    sessionID: p.sessionId,
    ...(p.command ? { command: p.command } : {}),
  }))
})

registerHandler("permission.reply", async (p) => {
  if (!p.id) throw new Error("permission.reply requires id parameter")
  if (!p.sessionId) throw new Error("permission.reply requires sessionId parameter")
  const reply = p.reply || (p.approved ? "once" : "reject")
  return sdkCall(() => sdk().v2.session.permission.reply({
    sessionID: p.sessionId,
    requestID: p.id,
    reply,
  }))
})

registerHandler("question.reply", async (p) => {
  if (!p.id) throw new Error("question.reply requires id parameter")
  if (!p.sessionId) throw new Error("question.reply requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.question.reply({
    sessionID: p.sessionId,
    requestID: p.id,
    questionV2Reply: { answers: [[p.answer]] },
  }))
})
registerHandler("question.reject", async (p) => {
  if (!p.id) throw new Error("question.reject requires id parameter")
  if (!p.sessionId) throw new Error("question.reject requires sessionId parameter")
  return sdkCall(() => sdk().v2.session.question.reject({
    sessionID: p.sessionId,
    requestID: p.id,
  }))
})

registerHandler("config.get", async () => sdkCall(() => sdk().global.config.get()))
registerHandler("config.agents", async () => sdkCall(() => sdk().v2.agent.list({})))
registerHandler("config.providers", async () => sdkCall(() => sdk().config.providers({})))
registerHandler("provider.list", async () => sdkCall(() => sdk().v2.provider.list({})))
registerHandler("command.list", async () => sdkCall(() => sdk().v2.command.list({})))
registerHandler("vcs.get", async () => sdkCall(() => sdk().vcs.get({})))
