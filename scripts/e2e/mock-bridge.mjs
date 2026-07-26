#!/usr/bin/env node
/**
 * Mock Bridge Server — 供 Maestro E2E 测试使用
 *
 * 启动 WS 服务器 + HTTP push API。
 * WS: 对每个 RPC 请求返回固定 mock payload。
 * HTTP: POST /push 接受 { method, payload } 广播给所有 WS 客户端。
 *
 * 使 Maestro 可在无真实 OpenCode 服务端下完成 UI 交互测试。
 *
 * 用法:
 *   node scripts/e2e/mock-bridge.mjs
 *   默认 WS 端口 8081，HTTP push 端口 18081
 *   通过 MOCK_BRIDGE_PORT / MOCK_PUSH_PORT 覆盖
 *
 * Maestro flow 中连接地址: ws://10.0.2.2:{MOCK_BRIDGE_PORT}/ws
 * Push API: POST http://localhost:{MOCK_PUSH_PORT}/push
 */

import { createRequire } from "node:module"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import http from "node:http"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocketServer } = require(resolve(projectRoot, "servers/bridge/node_modules/ws"))

const PORT = parseInt(process.env.MOCK_BRIDGE_PORT || "8081", 10)
const PUSH_PORT = parseInt(process.env.MOCK_PUSH_PORT || "18081", 10)

// 所有已连 WS 客户端列表，用于广播 push 通知
const clients = new Set()

// ─── Mock Payloads ─────────────────────────────────────────────

const MOCK_PAYLOADS = {
  "auth.login": {
    token: "mock-jwt-token-test",
    user: { sub: "test", role: "user" },
  },
  "auth.refresh": {
    token: "mock-jwt-token-refreshed",
  },
  "auth.logout": { ok: true },
  "health.ping": { ok: true },

  "project.current": {
    directory: "/mock-project",
    project: { name: "mock-project", type: "node" },
  },
  "project.list": {
    projects: [
      { directory: "/mock-project", name: "mock-project" },
    ],
  },
  "project.switch": {
    directory: "/mock-project",
    project: { name: "mock-project", type: "node" },
  },

  "session.list": {
    sessions: [
      { id: "mock_s1", name: "Session 1", messageCount: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "mock_s2", name: "Session 2", messageCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
  },
  "session.create": {
    session: { id: "mock_s1", name: "New Session", messageCount: 0 },
  },
  "session.get": {
    session: { id: "mock_s1", name: "Test Session", messageCount: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  },
  "session.messages": {
    messages: [
      { id: "msg_1", role: "user", content: "Hello", createdAt: new Date().toISOString() },
      { id: "msg_2", role: "assistant", content: "Hi! How can I help you?", createdAt: new Date().toISOString() },
    ],
  },
  "session.delete": { ok: true },
  "session.rename": { ok: true },
  "session.todo": { todos: [] },
  "session.diff": { diffs: [] },
  "session.fork": { sessionId: "mock_forked" },
  "session.revert": { ok: true },
  "session.unrevert": { ok: true },
  "session.children": { sessions: [{ id: "mock_s1_child", name: "Forked Session", messageCount: 0 }] },
  "session.status": { status: { type: "idle" }, sessionID: "mock_s1" },
  "session.active": {},
  "session.switchAgent": { ok: true },
  "session.switchModel": { ok: true },

  "message.send": { ok: true },
  "message.abort": { ok: true },
  "message.shell": { ok: true },
  "message.command": { ok: true },

  "permission.reply": { ok: true },
  "permission.list": { requests: [] },
  "permission.saved.list": { rules: [] },
  "permission.saved.remove": { ok: true },
  "question.reply": { ok: true },
  "question.reject": { ok: true },

  "config.get": { config: { theme: "dark", language: "zh" } },
  "config.update": { ok: true },
  "config.agents": {
    agents: [
      { name: "build", label: "Build Agent", id: "build" },
      { name: "debug", label: "Debug Agent", id: "debug" },
      { name: "architect", label: "Architect Agent", id: "architect" },
    ],
  },
  "config.providers": {
    providers: [
      { name: "Anthropic", id: "anthropic" },
      { name: "OpenAI", id: "openai" },
    ],
  },
  "provider.list": {
    providers: [
      { name: "Anthropic", id: "anthropic" },
      { name: "OpenAI", id: "openai" },
    ],
  },
  "command.list": {
    commands: [
      { command: "help", description: "Show help information" },
      { command: "search", description: "Search project files" },
      { command: "model", description: "Switch AI model" },
      { command: "agent", description: "Switch agent" },
    ],
  },
  "model.list": {
    models: [
      { id: "claude-sonnet-4", name: "Claude Sonnet 4", providerID: "anthropic" },
      { id: "gpt-4o", name: "GPT-4o", providerID: "openai" },
      { id: "deepseek-v3", name: "DeepSeek V3", providerID: "deepseek" },
    ],
  },
  "vcs.get": {
    type: "git",
    currentBranch: "main",
  },

  "file.list": [
    { name: "src", type: "directory", size: 4096, modified: new Date().toISOString(), permissions: "drwxr-xr-x" },
    { name: "package.json", type: "file", size: 1024, modified: new Date().toISOString(), permissions: "-rw-r--r--" },
    { name: "README.md", type: "file", size: 512, modified: new Date().toISOString(), permissions: "-rw-r--r--" },
  ],
  "file.read": {
    content: "# Mock File\n\nThis is mock content for E2E testing.",
    encoding: "utf-8",
    size: 52,
    path: "/mock-project/README.md",
  },
  "file.search": [
    { file: "src/index.ts", line: 1, content: "import { createServer } from 'http'", match: "import" },
  ],
  "file.info": {
    name: "package.json",
    type: "file",
    size: 1024,
    modified: new Date().toISOString(),
    permissions: "-rw-r--r--",
  },
}

function getDefaultPayload(method) {
  if (method.startsWith("session.") || method.startsWith("message.")) {
    return { ok: true }
  }
  if (method.startsWith("file.")) {
    return { files: [], path: "/mock" }
  }
  if (method.startsWith("auth.")) {
    return { token: "mock-token-fallback" }
  }
  return { ok: true, message: `mock response for ${method}` }
}

// ─── HTTP Push API ──────────────────────────────────────────────

const pushServer = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/push") {
    res.writeHead(405)
    res.end()
    return
  }

  let body = ""
  req.on("data", (chunk) => { body += chunk })
  req.on("end", () => {
    let data
    try {
      data = JSON.parse(body)
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "invalid JSON" }))
      return
    }

    const { method, payload } = data
    if (!method) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "method required" }))
      return
    }

    const frame = JSON.stringify({ type: "notify", method, payload: payload || {} })
    let count = 0
    for (const ws of clients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(frame)
        count++
      }
    }

    console.log(`[MOCK-PUSH] ${method} -> ${count} client(s)`)
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, sent: count }))
  })
})

pushServer.listen(PUSH_PORT, () => {
  console.log(`[MockBridge] Push API 启动于 http://localhost:${PUSH_PORT}/push`)
})

// ─── WS Server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws) => {
  clients.add(ws)

  ws.on("message", (data) => {
    let frame
    try {
      frame = JSON.parse(data.toString())
    } catch {
      ws.send(JSON.stringify({ type: "res", id: "0", ok: false, error: "invalid JSON" }))
      return
    }

    if (frame.type !== "req") return

    const method = frame.method || ""
    const id = frame.id || "0"

    let payload = MOCK_PAYLOADS[method] || getDefaultPayload(method)

    // 特殊处理: message.send 中以 __push__: 开头的 magic message
    // 格式: __push__:<method>:<JSON-payload>
    if (method === "message.send" && frame.params?.message?.startsWith("__push__:")) {
      const magic = frame.params.message.slice(9) // 去掉 "__push__:"
      const colonIdx = magic.indexOf(":")
      const pushMethod = colonIdx >= 0 ? magic.slice(0, colonIdx) : magic
      let pushPayload = {}
      try {
        pushPayload = colonIdx >= 0 ? JSON.parse(magic.slice(colonIdx + 1)) : {}
      } catch {}
      const notifyFrame = JSON.stringify({ type: "notify", method: pushMethod, payload: pushPayload })
      for (const c of clients) {
        if (c.readyState === 1) c.send(notifyFrame)
      }
      console.log(`[MOCK-PUSH] ${pushMethod} via magic message`)
      payload = { ok: true }
    }

    console.log(`[MOCK] REQ ${method} id=${id}`)
    if (!method.startsWith("_test.")) {
      console.log(`[MOCK] RES ${method} id=${id} ok=true`)
    }

    // 模拟网络延迟
    const delay = Math.random() * 50
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "res", id, ok: true, payload }))
    }, delay)
  })

  ws.on("close", () => {
    clients.delete(ws)
  })

  ws.on("error", () => {
    clients.delete(ws)
  })
})

console.log(`[MockBridge] WS 启动于 ws://localhost:${PORT}/ws`)
console.log(`[MockBridge] 共 ${Object.keys(MOCK_PAYLOADS).length} 个 mock handler`)
