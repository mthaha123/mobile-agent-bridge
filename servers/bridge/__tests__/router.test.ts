import { jest } from "@jest/globals"
import { handleFrame } from "../src/server/router.js"
import type { WebSocket } from "ws"
import type { TokenPayload } from "../src/server/auth.js"
import { initBackend, getBackend } from "../src/adapters/OpenCodeAdapter.js"

function createMockWs(): { ws: WebSocket; messages: any[] } {
  const messages: any[] = []
  const ws = {
    send: (msg: string) => {
      messages.push(JSON.parse(msg))
    },
    readyState: 1,
  } as unknown as WebSocket
  return { ws, messages }
}

function createMockSdk() {
  initBackend("http://localhost:4096")
  const backend = getBackend()

  const mockV3Session = {
    list: jest.fn<any>().mockResolvedValue({ data: { data: [], cursor: {} } }),
    get: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
    messages: jest.fn<any>().mockResolvedValue({ data: { data: [], cursor: {} } }),
    active: jest.fn<any>().mockResolvedValue({ data: [] }),
    prompt: jest.fn<any>().mockResolvedValue({ data: {} }),
    interrupt: jest.fn<any>().mockResolvedValue({ data: {} }),
    permission: { reply: jest.fn<any>().mockResolvedValue({ data: {} }) },
    question: {
      reply: jest.fn<any>().mockResolvedValue({ data: {} }),
      reject: jest.fn<any>().mockResolvedValue({ data: {} }),
    },
  }
  const mockSession2 = {
    create: jest.fn<any>().mockResolvedValue({ data: { id: "sess_new", agent: "build" } }),
    delete: jest.fn<any>().mockResolvedValue({ data: true }),
    update: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
    todo: jest.fn<any>().mockResolvedValue({ data: { todos: [] } }),
    diff: jest.fn<any>().mockResolvedValue({ data: { diff: [] } }),
    fork: jest.fn<any>().mockResolvedValue({ data: { id: "forked_id" } }),
    revert: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
    unrevert: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
    shell: jest.fn<any>().mockResolvedValue({ data: {} }),
    command: jest.fn<any>().mockResolvedValue({ data: {} }),
  }
  const mockGlobal = { config: { get: jest.fn<any>().mockResolvedValue({ data: {} }) } }
  const mockConfig = { providers: jest.fn<any>().mockResolvedValue({ data: [] }) }
  const mockVcs = { get: jest.fn<any>().mockResolvedValue({ data: {} }) }
  const mockV2 = {
    session: mockV3Session,
    agent: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    provider: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    command: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
  }

  backend.sdk = { session: mockSession2, v2: mockV2, global: mockGlobal, config: mockConfig, vcs: mockVcs } as any
  return { backend, mockV3Session, mockSession2, mockV2, mockGlobal, mockConfig, mockVcs }
}

const testPayload: TokenPayload = { sub: "test", role: "user" }

describe("RPC Router", () => {
  beforeEach(() => {
    initBackend("http://localhost:4096")
    getBackend().sdk = null
  })

  it("should reject unknown method", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "nonexistent", params: {} }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("unknown method")
  })

  it("should handle health.ping", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "health.ping", params: {} }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual({ ok: true })
  })

  it("should handle auth.login", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "auth.login", params: { password: "test" } }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("token")
  })

  it("should reject invalid frame type", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "invalid", id: "1" }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("invalid frame type")
  })

  it("should error when SDK not initialized for session methods", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "session.list", params: {} }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("SDK not initialized")
  })

  it("should call v2.session.prompt with correct params", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.send",
      params: { sessionId: "sess_123", message: "hello world" },
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.prompt).toHaveBeenCalledWith({
      sessionID: "sess_123",
      prompt: { text: "hello world" },
    })
  })

  it("should reject message.send without sessionId", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.send",
      params: { message: "hello" },
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  it("should call v2.session.permission.reply with correct reply value", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { id: "req_123", sessionId: "sess_123", reply: "always" },
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.permission.reply).toHaveBeenCalledWith({
      sessionID: "sess_123",
      requestID: "req_123",
      reply: "always",
    })
  })

  it("should fallback from reply to approved boolean", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { id: "req_123", sessionId: "sess_123", approved: true },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.permission.reply).toHaveBeenCalledWith({
      sessionID: "sess_123",
      requestID: "req_123",
      reply: "once",
    })
  })

  it("should call session.create with agent/model params", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.create",
      params: { agent: "build", model: "claude-sonnet-4" },
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.create).toHaveBeenCalledWith({
      agent: "build",
      model: "claude-sonnet-4",
    })
  })

  it("should call session.create with empty params when none provided", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.create",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.create).toHaveBeenCalledWith({})
  })

  it("should call v2.session.question.reply with questionV2Reply format", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "question.reply",
      params: { id: "q_1", sessionId: "sess_123", answer: "yes" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.question.reply).toHaveBeenCalledWith({
      sessionID: "sess_123",
      requestID: "q_1",
      questionV2Reply: { answers: [["yes"]] },
    })
  })

  it("should reject non-auth methods without valid payload", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "health.ping", params: {} }, null)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("unauthorized")
  })

  it("should allow auth methods without valid payload", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "auth.login", params: { password: "test" } }, null)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("token")
  })

  it("should handle errors thrown by handlers as ok:false", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    // message.send without sessionId parameter throws from within the handler
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.send",
      params: {},
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toBeTruthy()
  })

  it("should call session.delete with sessionID param", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.delete",
      params: { id: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.delete).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should reject session.delete without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.delete",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call session.update with title param", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.update",
      params: { id: "sess_123", title: "renamed" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.update).toHaveBeenCalledWith({ sessionID: "sess_123", title: "renamed" })
  })

  it("should reject session.update without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.update",
      params: { title: "no id" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call onTokenRefreshed when auth.login returns token", async () => {
    const { ws, messages } = createMockWs()
    const onTokenRefreshed = jest.fn<any>()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "auth.login",
      params: { password: "test" },
    }, null, onTokenRefreshed)
    expect(messages[0].ok).toBe(true)
    expect(onTokenRefreshed).toHaveBeenCalledTimes(1)
    expect(onTokenRefreshed.mock.calls[0][0]).toEqual(messages[0].payload.token)
  })

  // ===== Session handlers =====

  it("should call session.list", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.list).toHaveBeenCalledWith({})
  })

  it("should call session.get with sessionID", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.get",
      params: { id: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.get).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should reject session.get without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.get",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call session.messages with sessionID", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.messages).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should reject session.messages without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call session.status", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.status", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.active).toHaveBeenCalled()
  })

  it("should call session.active", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.active", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.active).toHaveBeenCalled()
  })

  it("should call session.rename with name param", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.rename",
      params: { id: "sess_123", name: "new-name" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.update).toHaveBeenCalledWith({
      sessionID: "sess_123",
      title: "new-name",
    })
  })

  it("should reject session.rename without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.rename",
      params: { name: "new-name" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call session.todo", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.todo",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.todo).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should call session.diff", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.diff",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.diff).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should call session.fork", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.fork",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.fork).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should call session.revert", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.revert",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.revert).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should call session.unrevert", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.unrevert",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.unrevert).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  // ===== Message handlers =====

  it("should call message.abort", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.abort",
      params: { sessionId: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.interrupt).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should call message.shell with command", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.shell",
      params: { sessionId: "sess_123", command: "ls -la" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.shell).toHaveBeenCalledWith({
      sessionID: "sess_123",
      command: "ls -la",
    })
  })

  it("should call message.command with command", async () => {
    const { mockSession2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.command",
      params: { sessionId: "sess_123", command: "/model claude" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession2.command).toHaveBeenCalledWith({
      sessionID: "sess_123",
      command: "/model claude",
    })
  })

  // ===== Question handlers =====

  it("should call question.reject", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "question.reject",
      params: { id: "q_1", sessionId: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.question.reject).toHaveBeenCalledWith({
      sessionID: "sess_123",
      requestID: "q_1",
    })
  })

  // ===== Config handlers =====

  it("should call config.get", async () => {
    const { mockGlobal } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.get", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockGlobal.config.get).toHaveBeenCalled()
  })

  it("should call config.agents", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.agents", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.agent.list).toHaveBeenCalledWith({})
  })

  it("should call config.providers", async () => {
    const { mockConfig } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.providers", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockConfig.providers).toHaveBeenCalledWith({})
  })

  it("should call provider.list", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "provider.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.provider.list).toHaveBeenCalledWith({})
  })

  it("should call command.list", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "command.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.command.list).toHaveBeenCalledWith({})
  })

  it("should call vcs.get", async () => {
    const { mockVcs } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "vcs.get", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockVcs.get).toHaveBeenCalledWith({})
  })

  // ===== Project handler =====

  it("should return current project via project.current", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.current", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("directory")
    expect(messages[0].payload).toHaveProperty("project")
  })

})
