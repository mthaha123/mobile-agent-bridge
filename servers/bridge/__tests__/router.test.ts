import { handleFrame } from "../src/server/router.js"
import type { WebSocket } from "ws"
import type { TokenPayload } from "../src/server/auth.js"

function createMockWs(): { ws: WebSocket; messages: any[] } {
  const messages: any[] = []
  const ws = {
    send: (msg: string) => {
      messages.push(JSON.parse(msg))
    },
    readyState: 1, // WebSocket.OPEN
  } as unknown as WebSocket
  return { ws, messages }
}

const testPayload: TokenPayload = { sub: "test", role: "user" }

describe("RPC Router", () => {
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
    expect(messages[0].error).toContain("OpenCodeBackend not initialized")
  })
})
