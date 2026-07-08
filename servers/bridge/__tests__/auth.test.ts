import { signToken, verifyToken, handleLogin, handleRefresh, handleLogout } from "../src/server/auth.js"

describe("JWT Auth", () => {
  it("should sign and verify a token", () => {
    const token = signToken({ sub: "test", role: "user" })
    expect(token).toBeTruthy()
    expect(typeof token).toBe("string")

    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe("test")
    expect(payload!.role).toBe("user")
  })

  it("should reject invalid token", () => {
    const payload = verifyToken("invalid-token")
    expect(payload).toBeNull()
  })

  it("should reject tampered token", () => {
    const token = signToken({ sub: "test", role: "user" })
    const tampered = token.slice(0, -5) + "xxxxx"
    const payload = verifyToken(tampered)
    expect(payload).toBeNull()
  })

  it("should handle login with correct password", () => {
    const oldPwd = process.env.BRIDGE_PASSWORD
    process.env.BRIDGE_PASSWORD = "test123"
    const result = handleLogin({ password: "test123" })
    expect(result).toHaveProperty("token")
    expect(result).toHaveProperty("expiresIn")
    process.env.BRIDGE_PASSWORD = oldPwd
  })

  it("should reject login with wrong password", () => {
    const oldPwd = process.env.BRIDGE_PASSWORD
    process.env.BRIDGE_PASSWORD = "test123"
    expect(() => handleLogin({ password: "wrong" })).toThrow("invalid password")
    process.env.BRIDGE_PASSWORD = oldPwd
  })

  it("should allow login without password when BRIDGE_PASSWORD not set", () => {
    const oldPwd = process.env.BRIDGE_PASSWORD
    delete process.env.BRIDGE_PASSWORD
    const result = handleLogin({})
    expect(result).toHaveProperty("token")
    process.env.BRIDGE_PASSWORD = oldPwd
  })

  it("should handle auth.refresh", () => {
    const result = handleRefresh()
    expect(result).toHaveProperty("token")
    expect(result).toHaveProperty("expiresIn")
  })

  it("should handle auth.logout", () => {
    const result = handleLogout()
    expect(result).toEqual({ ok: true })
  })
})
