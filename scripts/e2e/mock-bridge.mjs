#!/usr/bin/env node
/**
 * Mock Bridge Server — 供 Maestro E2E 测试使用
 *
 * 启动 WS 服务器，对每个 RPC 请求返回固定 mock payload。
 * 使 Maestro 可在无真实 OpenCode 服务端下完成 UI 交互测试。
 *
 * 用法:
 *   node scripts/e2e/mock-bridge.mjs
 *   默认端口 8081，通过 MOCK_BRIDGE_PORT 覆盖
 *
 * Maestro flow 中连接地址: ws://10.0.2.2:{MOCK_BRIDGE_PORT}/ws
 */

import { createRequire } from "node:module"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocketServer } = require(resolve(projectRoot, "servers/bridge/node_modules/ws"))

const PORT = parseInt(process.env.MOCK_BRIDGE_PORT || "8081", 10)

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
  "session.status": { status: { type: "idle" }, sessionID: "mock_s1" },
  "session.active": {},
  "session.switchAgent": { ok: true },
  "session.switchModel": { ok: true },

  "message.send": { ok: true },
  "message.abort": { ok: true },
  "message.shell": { ok: true },
  "message.command": { ok: true },

  "permission.reply": { ok: true },
  "question.reply": { ok: true },
  "question.reject": { ok: true },

  "config.get": { config: { theme: "dark", language: "zh" } },
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

// ─── WS Server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws) => {
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

    const payload = MOCK_PAYLOADS[method] || getDefaultPayload(method)

    console.log(`[MOCK] REQ ${method} id=${id}`)
    console.log(`[MOCK] RES ${method} id=${id} ok=true`)

    // 模拟网络延迟
    const delay = Math.random() * 50
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "res", id, ok: true, payload }))
    }, delay)
  })


})

console.log(`[MockBridge] 启动于 ws://localhost:${PORT}/ws`)
console.log(`[MockBridge] 共 ${Object.keys(MOCK_PAYLOADS).length} 个 mock handler`)
