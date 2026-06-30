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

export async function handleFrame(connID: string, ws: WebSocket, frame: any, payload: TokenPayload | null): Promise<void> {
  if (frame.type !== "req") {
    ws.send(JSON.stringify({ type: "res", id: frame.id || "0", ok: false, error: "invalid frame type" }))
    return
  }

  const method = frame.method || ""

  // 非 auth 方法需要已认证
  if (!payload && !method.startsWith("auth.")) {
    ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: "unauthorized" }))
    return
  }

  const handler = handlers.get(method)

  if (!handler) {
    ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: `unknown method: ${method}` }))
    return
  }

  try {
    const result = await handler(frame.params || {}, payload)
    ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: result }))
  } catch (err: any) {
    console.error(`[Router] ${method} 错误:`, err.message)
    ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: err.message || "internal error" }))
  }
}

// ===== Handler 注册 =====

// 认证（直接实现）
registerHandler("auth.login", (params) => handleLogin(params))
registerHandler("auth.refresh", () => handleRefresh())
registerHandler("auth.logout", () => handleLogout())

// 健康检查（直接实现）
registerHandler("health.ping", () => ({ ok: true }))

// 项目设置（直接实现）
registerHandler("project.setup", async (params) => setupProject(params.directory))
registerHandler("project.current", async () => getCurrentProject())

// ===== SDK 代理方法 =====

function sdk() {
  const backend = getBackend()
  if (!backend.sdk) throw new Error("SDK not initialized. Call project.setup first.")
  return backend.sdk
}

// session.*
registerHandler("session.create", async (p) => sdk().session.create(p))
registerHandler("session.list", async (p) => sdk().session.list(p))
registerHandler("session.get", async (p) => sdk().session.get(p))
registerHandler("session.delete", async (p) => sdk().session.delete(p))
registerHandler("session.rename", async (p) => sdk().session.update(p))
registerHandler("session.messages", async (p) => sdk().session.messages(p))
registerHandler("session.status", async () => sdk().session.status({}))
registerHandler("session.todo", async (p) => sdk().session.todo(p))
registerHandler("session.diff", async (p) => sdk().session.diff(p))
registerHandler("session.fork", async (p) => sdk().session.fork(p))
registerHandler("session.revert", async (p) => sdk().session.revert(p))
registerHandler("session.unrevert", async (p) => sdk().session.unrevert(p))

// message.*（映射到 session.*）
registerHandler("message.send", async (p) => sdk().session.prompt(p))
registerHandler("message.shell", async (p) => sdk().session.shell(p))
registerHandler("message.command", async (p) => sdk().session.command(p))
registerHandler("message.abort", async (p) => sdk().session.abort(p))

// permission.*
registerHandler("permission.reply", async (p) => sdk().permission.reply(p))

// question.*
registerHandler("question.reply", async (p) => sdk().question.reply(p))
registerHandler("question.reject", async (p) => sdk().question.reject(p))

// config.*
registerHandler("config.get", async () => sdk().config.get({}))
registerHandler("config.providers", async () => sdk().config.providers({}))
registerHandler("config.agents", async () => sdk().app.agents({}))
registerHandler("provider.list", async () => sdk().provider.list({}))
registerHandler("vcs.get", async () => sdk().vcs.get({}))
registerHandler("command.list", async () => sdk().command.list({}))
