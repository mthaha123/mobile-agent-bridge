import { jest } from "@jest/globals"
import { handleFrame } from "../src/server/router.js"
import type { WebSocket } from "ws"
import type { TokenPayload } from "../src/server/auth.js"
import { initBackend, getBackend } from "../src/adapters/OpenCodeAdapter.js"
import { _testGetConnections } from "../src/server/ws.js"

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
    create: jest.fn<any>().mockResolvedValue({ data: { id: "sess_new", agent: "build" } }),
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
    children: jest.fn<any>().mockResolvedValue({ data: [] }),
  }
  const mockGlobal = { config: { get: jest.fn<any>().mockResolvedValue({ data: {} }) }, dispose: jest.fn<any>().mockResolvedValue(undefined) }
  const mockConfig = {
    providers: jest.fn<any>().mockResolvedValue({ data: [] }),
    update: jest.fn<any>().mockResolvedValue({ data: {} }),
  }
  const mockV2 = {
    session: {
      ...mockV3Session,
      switchAgent: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
      switchModel: jest.fn<any>().mockResolvedValue({ data: { id: "sess_123" } }),
      revert: {
        stage: jest.fn<any>().mockResolvedValue({ data: { messageID: "msg_456", snapshot: "snap" } }),
        commit: jest.fn<any>().mockResolvedValue(undefined),
        clear: jest.fn<any>().mockResolvedValue(undefined),
      },
    },
    location: { get: jest.fn<any>().mockResolvedValue({ data: { directory: "D:\\code\\mobile-agent-bridge", project: { name: "mobile-agent-bridge" } } }) },
    model: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    agent: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    provider: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    command: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
    permission: {
      request: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
      saved: {
        list: jest.fn<any>().mockResolvedValue({ data: [] }),
        remove: jest.fn<any>().mockResolvedValue({ data: { ok: true } }),
      },
    },
  }
  backend.sdk = { session: mockSession2, v2: mockV2, global: mockGlobal, config: mockConfig, project: { list: jest.fn<any>().mockResolvedValue({ data: [] }) } } as any
  backend.rawSessionMessages = jest.fn<any>().mockResolvedValue({ messages: [], cursor: undefined })
  return { backend, mockV3Session, mockSession2, mockV2, mockGlobal, mockConfig }
}

const testPayload: TokenPayload = { sub: "test", role: "user" }

/** mock backend.createClient 以设置一个含 mock subscribe 的 SDK */
function mockCreateClientForSwitch(extra?: { subscribeBlock?: Promise<void> }) {
  const backend = getBackend()
  const oldSdk = backend.sdk
  const subscribeMock = jest.fn<any>().mockImplementation(() =>
    extra?.subscribeBlock
      ? extra.subscribeBlock.then(() => ({ stream: (async function*() {})() }))
      : Promise.resolve({ stream: (async function*() {})() })
  )
  backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
    backend.sdk = {
      ...oldSdk,
      v2: {
        ...(oldSdk as any).v2,
        event: { subscribe: subscribeMock },
      },
      global: { dispose: jest.fn<any>().mockResolvedValue(undefined), config: (oldSdk as any)?.global?.config },
    } as any
  })
  return { backend, oldSdk, subscribeMock }
}

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

  it("should accept sessionID (upper case D) in message.send", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "message.send",
      params: { sessionID: "sess_123", message: "hello via sessionID" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.prompt).toHaveBeenCalledWith({
      sessionID: "sess_123",
      prompt: { text: "hello via sessionID" },
    })
  })

  it("should reject message.send without sessionID/sessionId", async () => {
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

  it("should accept permission.reply with sessionID (upper case D)", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { id: "req_123", sessionID: "sess_123", reply: "once" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.permission.reply).toHaveBeenCalledWith({
      sessionID: "sess_123",
      requestID: "req_123",
      reply: "once",
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

  it("should fallback approved:false to reject", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { id: "req_456", sessionId: "sess_456", approved: false },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.permission.reply).toHaveBeenCalledWith({
      sessionID: "sess_456",
      requestID: "req_456",
      reply: "reject",
    })
  })

  it("should reject permission.reply without sessionId", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { id: "req_123", reply: "once" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  it("should reject permission.reply without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.reply",
      params: { sessionId: "sess_123", reply: "once" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  // ===== Permission management handlers =====

  it("should call permission.list", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.permission.request.list).toHaveBeenCalledWith({})
  })

  it("should call permission.saved.list", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.saved.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.permission.saved.list).toHaveBeenCalledWith({})
  })

  it("should call permission.saved.remove with id", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.saved.remove",
      params: { id: "rule_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.permission.saved.remove).toHaveBeenCalledWith({ id: "rule_123" })
  })

  it("should reject permission.saved.remove without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "permission.saved.remove", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("id")
  })

  it("should call session.create with agent/model params (string model resolved to object)", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.create",
      params: { agent: "build", model: "claude-sonnet-4" },
    }, testPayload)
    expect(messages.length).toBe(1)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.create).toHaveBeenCalledWith({
      agent: "build",
      model: { id: "claude-sonnet-4", providerID: "claude-sonnet-4" },
    })
  })

  it("should accept model as object and pass through directly", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.create",
      params: { model: { id: "gpt-4o", providerID: "openai", variant: "2024-11" } },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.create).toHaveBeenCalledWith({
      model: { id: "gpt-4o", providerID: "openai", variant: "2024-11" },
    })
  })

  it("should call session.create with empty params when none provided", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.create",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV3Session.create).toHaveBeenCalledWith({})
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

  it("should call question.reply with answers array format", async () => {
    const { mockV3Session: mockSession } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "question.reply",
      params: { id: "q_2", sessionId: "sess_456", answers: [["opt1", "opt2"]] },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockSession.question.reply).toHaveBeenCalledWith({
      sessionID: "sess_456",
      requestID: "q_2",
      questionV2Reply: { answers: [["opt1", "opt2"]] },
    })
  })

  it("should reject question.reply without sessionId", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "question.reply",
      params: { id: "q_1", answer: "yes" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  it("should reject question.reply without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "question.reply",
      params: { sessionId: "sess_123", answer: "yes" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
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
    expect(mockV3Session.list).toHaveBeenCalledWith({ limit: 500 })
    // SDK { data: [...] } 被解包为裸数组
    expect(Array.isArray(messages[0].payload)).toBe(true)
  })

  it("should unwrap double-wrapped data in session.list", async () => {
    const { mockV3Session } = createMockSdk()
    mockV3Session.list.mockResolvedValueOnce({ data: { data: [{ id: "s1", title: "T" }], cursor: {} } })
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual([{ id: "s1", title: "T" }])
  })

  it("should return raw session messages via rawSessionMessages", async () => {
    const { backend } = createMockSdk()
    ;(backend.rawSessionMessages as jest.Mock).mockResolvedValueOnce({ messages: [{ id: "m1", type: "user", text: "hi" }], cursor: undefined })
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(backend.rawSessionMessages).toHaveBeenCalledWith("sess_123", {})
    expect(messages[0].payload).toEqual({ messages: [{ id: "m1", type: "user", text: "hi" }], cursor: undefined })
  })

  it("should unwrap { data } in session.get", async () => {
    const { mockV3Session } = createMockSdk()
    mockV3Session.get.mockResolvedValueOnce({ data: { data: { id: "sess_123", title: "T" } } })
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.get",
      params: { id: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual({ id: "sess_123", title: "T" })
  })

  it("should pass search/limit to session.list", async () => {
    const { mockV3Session } = createMockSdk()
    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.list",
      params: { search: "test", limit: 10, cursor: "abc" },
    }, testPayload)
    expect(mockV3Session.list).toHaveBeenCalledWith({ search: "test", limit: 10, cursor: "abc" })
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
    expect(messages[0].error).toContain("sessionId")
  })

  it("should call rawSessionMessages with sessionID", async () => {
    const { backend } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: { sessionID: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(backend.rawSessionMessages).toHaveBeenCalledWith("sess_123", {})
    // 返回 { messages, cursor }
    expect(messages[0].payload).toEqual({ messages: [], cursor: undefined })
  })

  it("should forward limit/order/cursor to rawSessionMessages", async () => {
    const { backend } = createMockSdk()
    ;(backend.rawSessionMessages as jest.Mock).mockResolvedValueOnce({ messages: [{ id: "m1" }], cursor: undefined })
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: { sessionID: "sess_123", limit: 30, order: "desc", cursor: "abc" },
    }, testPayload)
    expect(backend.rawSessionMessages).toHaveBeenCalledWith("sess_123", { limit: 30, order: "desc", cursor: "abc" })
    expect(messages[0].payload).toEqual({ messages: [{ id: "m1" }], cursor: undefined })
  })

  it("should reject session.messages without id", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.messages",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
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

  it("should call session.revert via v2 stage+commit", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.revert",
      params: { sessionID: "sess_123", messageID: "msg_456" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.session.revert.stage).toHaveBeenCalledWith({ sessionID: "sess_123", messageID: "msg_456" })
    expect(mockV2.session.revert.commit).toHaveBeenCalledWith({ sessionID: "sess_123" })
  })

  it("should reject session.revert without id", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.revert",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("session.revert requires")
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

  it("should return empty config on config.get (endpoint removed in server 1.18)", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.get", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual({ config: {} })
  })

  it("should return ok on config.update (endpoint removed in server 1.18)", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.update",
      params: { theme: "light" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual({ ok: true })
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

  it("should call provider.list on config.providers (v2)", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.providers", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.provider.list).toHaveBeenCalledWith({})
    expect(messages[0].payload).toEqual({ providers: [] })
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

  it("should call model.list", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "model.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.model.list).toHaveBeenCalledWith({})
  })

  it("should call session.switchAgent with agent name", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchAgent",
      params: { sessionId: "sess_123", agent: "build" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.session.switchAgent).toHaveBeenCalledWith({
      sessionID: "sess_123",
      agent: "build",
    })
  })

  it("should accept sessionID (upper case D) in session.switchAgent", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchAgent",
      params: { sessionID: "sess_123", agent: "coder" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.session.switchAgent).toHaveBeenCalledWith({
      sessionID: "sess_123",
      agent: "coder",
    })
  })

  it("should reject session.switchAgent without sessionId", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchAgent",
      params: { agent: "build" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  it("should reject session.switchAgent without agent", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchAgent",
      params: { sessionId: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("agent")
  })

  it("should call session.switchModel with string model (resolved to object)", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchModel",
      params: { sessionId: "sess_123", model: "claude-sonnet-4" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.session.switchModel).toHaveBeenCalledWith({
      sessionID: "sess_123",
      model: { id: "claude-sonnet-4", providerID: "claude-sonnet-4" },
    })
  })

  it("should call session.switchModel with model object (pass through)", async () => {
    const { mockV2 } = createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchModel",
      params: { sessionId: "sess_123", model: { id: "gpt-4o", providerID: "openai", variant: "2024-11" } },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(mockV2.session.switchModel).toHaveBeenCalledWith({
      sessionID: "sess_123",
      model: { id: "gpt-4o", providerID: "openai", variant: "2024-11" },
    })
  })

  it("should reject session.switchModel without sessionId", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchModel",
      params: { model: "claude" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("sessionId")
  })

  it("should reject session.switchModel without model", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "session.switchModel",
      params: { sessionId: "sess_123" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("model")
  })

  // ===== Project handler =====

  it("should return current project via project.current (from v2.location)", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.current", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload.directory).toBe("D:\\code\\mobile-agent-bridge")
    expect(messages[0].payload.project).toEqual({ name: "mobile-agent-bridge" })
  })

  it("should return current project on project.list (via v2.location)", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toEqual([
      { directory: "D:\\code\\mobile-agent-bridge", name: "mobile-agent-bridge" },
    ])
  })

  it("should reject project.switch without directory", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("directory")
  })

  it("should reject project.switch with invalid directory", async () => {
    createMockSdk()
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: "C:\\nonexistent_dir_xyzzy" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("directory not found")
  })

  it("should return correct payload after successful project.switch", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk

    backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
      // keep old sdk alive (no dispose) so rollback is safe
      backend.sdk = {
        ...oldSdk,
        v2: {
          ...(oldSdk as any).v2,
          event: { subscribe: jest.fn<any>().mockResolvedValue({ stream: (async function*() {})() }) },
        },
      } as any
    })

    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("directory")
    expect(messages[0].payload).toHaveProperty("project")
    expect(messages[0].payload.project).toHaveProperty("name")
    expect(messages[0].payload.directory).toBe(process.cwd())
  })

  it("should reflect new directory in project.current after switch", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk
    const newDir = process.cwd()

    backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
      backend.sdk = {
        ...oldSdk,
        v2: {
          ...(oldSdk as any).v2,
          location: { get: jest.fn<any>().mockResolvedValue({ data: { directory, project: { name: "test" } } }) },
          event: { subscribe: jest.fn<any>().mockResolvedValue({ stream: (async function*() {})() }) },
        },
      } as any
    })

    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: newDir },
    }, testPayload)

    const { ws: ws2, messages: msgs2 } = createMockWs()
    await handleFrame("conn2", ws2, {
      type: "req", id: "2", method: "project.current", params: {},
    }, testPayload)

    expect(msgs2[0].ok).toBe(true)
    expect(msgs2[0].payload.directory).toBe(newDir)
  })

  it("should start SSE after successful project.switch", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk
    const subscribeMock = jest.fn<any>().mockResolvedValue({ stream: (async function*() {})() })

    backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
      backend.sdk = {
        ...oldSdk,
        v2: {
          ...(oldSdk as any).v2,
          event: { subscribe: subscribeMock },
        },
      } as any
    })

    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    // startSSE is async (not awaited in switchProject), wait a tick
    await new Promise(r => setTimeout(r, 50))
    expect(subscribeMock).toHaveBeenCalled()
  })

  it("should allow switching to the same directory twice", async () => {
    createMockSdk()
    mockCreateClientForSwitch()
    const { ws, messages } = createMockWs()
    const dir = process.cwd()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: dir },
    }, testPayload)
    expect(messages[0].ok).toBe(true)

    // 第二次切同一目录，用一个新的 mock 追踪
    const { subscribeMock: sub2 } = mockCreateClientForSwitch()
    await handleFrame("conn1", ws, {
      type: "req", id: "2", method: "project.switch",
      params: { directory: dir },
    }, testPayload)
    expect(messages[1].ok).toBe(true)
    await new Promise(r => setTimeout(r, 50))
    expect(sub2).toHaveBeenCalled()
  })

  it("should abort old SSE when switching to another directory", async () => {
    createMockSdk()
    let blockRelease: () => void
    const gate = new Promise<void>(r => { blockRelease = r })
    const { subscribeMock: sub1 } = mockCreateClientForSwitch({ subscribeBlock: gate })

    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)
    // 第一次的 subscribe 卡在 gate 上

    // 第二次 switch → 应 abort 旧 SSE（即释放 gate），并启动新 subscribe
    const { subscribeMock: sub2 } = mockCreateClientForSwitch()
    const p2 = handleFrame("conn1", ws, {
      type: "req", id: "2", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)
    await p2
    await new Promise(r => setTimeout(r, 50))

    // 旧的 subscribe 因 abort 被释放 → sub1 被调过
    expect(sub1).toHaveBeenCalled()
    // 新的 subscribe 也被调了
    expect(sub2).toHaveBeenCalled()
    // 释放 gate 避免 dangling promise
    blockRelease!()
  })

  it("should reject concurrent project.switch calls (already switching)", async () => {
    const { subscribeMock: sub1 } = mockCreateClientForSwitch()
    const { ws, messages } = createMockWs()

    // 两次几乎同时发送，利用 await Promise.resolve() yield 点命中锁
    const p1 = handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)
    const p2 = handleFrame("conn1", ws, {
      type: "req", id: "2", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)
    await Promise.all([p1, p2])

    const errors = messages.filter(m => !m.ok).map(m => m.error)
    // 第二次应被已切换锁拒绝
    expect(errors.some((e: string) => e?.includes("already switching"))).toBe(true)
    // 清理避免 dangling promise
    sub1.mockResolvedValue({ stream: (async function*() {})() })
  })

  it("should broadcast project.changed after successful switch", async () => {
    createMockSdk()
    const { subscribeMock } = mockCreateClientForSwitch()
    // 注册一个真实 WS 连接来接收 broadcast
    const { ws: mockWs, messages: broadcastMsgs } = createMockWs()
    const conns = _testGetConnections()
    const testConnId = "test-broadcast-conn"
    conns.set(testConnId, mockWs)

    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    // broadcast 在 setTimeout(0) 中，等下一个 tick
    await new Promise(r => setTimeout(r, 10))

    // 验证广播被发送
    const changedNotif = broadcastMsgs.find(
      (m: any) => m.type === "notify" && m.method === "project.changed"
    )
    expect(changedNotif).toBeDefined()
    expect(changedNotif.payload).toHaveProperty("directory")
    expect(changedNotif.payload).toHaveProperty("project")

    conns.delete(testConnId)
  })

  it("should tolerate SSE returning HTML errors and not crash", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk
    let subscribeCalls = 0
    const subscribeMock = jest.fn<any>().mockImplementation(async () => {
      subscribeCalls++
      const err = new Error("text/html response from /api/event")
      throw err
    })

    backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
      backend.sdk = {
        ...oldSdk,
        v2: {
          ...(oldSdk as any).v2,
          event: { subscribe: subscribeMock },
        },
        global: { dispose: jest.fn<any>().mockResolvedValue(undefined), config: (oldSdk as any)?.global?.config },
      } as any
    })

    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    expect(messages[0].ok).toBe(true)
    // SSE 循环在后台重试，不应影响主流程
    // 重试间隔 3s，等足够长让 startSSE 走到 htmlResponseCount >= 2 分支
    await new Promise(r => setTimeout(r, 3500))
    expect(subscribeCalls).toBeGreaterThanOrEqual(2)
    // bridge 仍是可用状态
    expect(backend.sdk).not.toBeNull()
  })

  it("should pass through SDK event types as notify method names (no translation)", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk
    const conns = _testGetConnections()
    const { ws: listener, messages: broadcastMsgs } = createMockWs()
    const listenerId = "sse-event-test"
    conns.set(listenerId, listener)

    // SSE stream 产出三种 SDK 事件 (V2Event 格式: { id, type, data })
    async function* eventStream() {
      yield { type: "session.next.text.delta", data: { sessionID: "s1", delta: "hi" } }
      yield { type: "permission.v2.asked", data: { id: "p1", action: "read", resources: ["."] } }
      yield { type: "session.idle", data: { sessionID: "s1" } }
    }
    const subscribeMock = jest.fn<any>().mockResolvedValue({ stream: eventStream() })

    backend.createClient = jest.fn<any>().mockImplementation((directory: string) => {
      backend.sdk = {
        ...oldSdk,
        v2: {
          ...(oldSdk as any).v2,
          event: { subscribe: subscribeMock },
        },
        global: { dispose: jest.fn<any>().mockResolvedValue(undefined), config: (oldSdk as any)?.global?.config },
      } as any
    })

    const { ws } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    // Wait for SSE loop to consume all 3 events
    await new Promise(r => setTimeout(r, 100))

    // Verify each event type was broadcast as notify method without transformation
    const textDelta = broadcastMsgs.find((m: any) => m.method === "session.next.text.delta")
    expect(textDelta).toBeDefined()
    expect(textDelta.payload).toEqual({ sessionID: "s1", delta: "hi" })

    const permV2 = broadcastMsgs.find((m: any) => m.method === "permission.v2.asked")
    expect(permV2).toBeDefined()
    expect(permV2.payload).toEqual({ id: "p1", action: "read", resources: ["."] })

    const idle = broadcastMsgs.find((m: any) => m.method === "session.idle")
    expect(idle).toBeDefined()
    expect(idle.payload).toEqual({ sessionID: "s1" })

    conns.delete(listenerId)
  })

  it("should preserve old SDK when createClient fails (rollback)", async () => {
    createMockSdk()
    const backend = getBackend()
    const oldSdk = backend.sdk

    backend.createClient = jest.fn<any>().mockImplementation(() => {
      throw new Error("createClient failed")
    })

    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.switch",
      params: { directory: process.cwd() },
    }, testPayload)

    expect(messages[0].ok).toBe(false)
    // old SDK must still be intact
    expect(backend.sdk).toBe(oldSdk)
  })

  // ===== File handlers =====

  it("should handle file.list", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.list",
      params: { path: "." },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(Array.isArray(messages[0].payload)).toBe(true)
  })

  it("should handle file.list with default path", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.list",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(Array.isArray(messages[0].payload)).toBe(true)
  })

  it("should handle file.read", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.read",
      params: { path: "package.json" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("content")
    expect(messages[0].payload).toHaveProperty("encoding")
  })

  it("should reject file.read without path", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.read",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("path")
  })

  it("should handle file.search", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.search",
      params: { query: "import" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(Array.isArray(messages[0].payload)).toBe(true)
  })

  it("should reject file.search without query", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.search",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("query")
  })

  it("should handle file.info", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.info",
      params: { path: "package.json" },
    }, testPayload)
    expect(messages[0].ok).toBe(true)
    expect(messages[0].payload).toHaveProperty("name")
    expect(messages[0].payload).toHaveProperty("type")
    expect(messages[0].payload).toHaveProperty("size")
  })

  it("should reject file.info without path", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.info",
      params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("path")
  })

  // ===== 时序契约：配置 RPC 依赖 project.switch，SDK 未初始化时报错 =====
  it("should error when SDK not initialized for config.agents", async () => {
    const backend = getBackend()
    backend.sdk = null
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "config.agents", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("SDK not initialized")
  })

  it("should error when SDK not initialized for model.list", async () => {
    const backend = getBackend()
    backend.sdk = null
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "model.list", params: {},
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("SDK not initialized")
  })

  // ===== project.current 探测：SDK 未初始化时通过 ensureClient 查询 OpenCode location =====
  it("should probe OpenCode location via ensureClient when SDK not initialized", async () => {
    const backend = getBackend()
    backend.sdk = null

    const mockLocationGet = jest.fn<any>().mockResolvedValue({ data: { directory: "D:\\repo\\probe", project: { name: "probe" } } })
    const lazySdk = {
      v2: {
        location: { get: mockLocationGet },
        agent: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
        provider: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
        model: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
        command: { list: jest.fn<any>().mockResolvedValue({ data: [] }) },
      },
      global: { dispose: jest.fn<any>().mockResolvedValue(undefined) },
    }
    backend.createClient = jest.fn<any>().mockImplementation(() => {
      backend.sdk = lazySdk as any
    })

    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "project.current", params: {},
    }, testPayload)

    expect(messages[0].ok).toBe(true)
    expect(backend.createClient).toHaveBeenCalledWith("")
    expect(mockLocationGet).toHaveBeenCalledWith({})
    expect(messages[0].payload).toEqual({
      directory: "D:\\repo\\probe",
      project: { name: "probe" },
    })
  })

})
