import jwt from "jsonwebtoken"

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production"
const EXPIRES_IN = 24 * 60 * 60 // 24h in seconds

export interface TokenPayload {
  sub: string
  role: string
}

export function signToken(payload: { sub: string; role: string }): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as TokenPayload
    return decoded
  } catch {
    return null
  }
}

export function generateToken(): { token: string; expiresIn: number } {
  const token = signToken({ sub: "mobile-user", role: "user" })
  return { token, expiresIn: EXPIRES_IN }
}

// auth.login handler（直接实现）
export function handleLogin(params: { password?: string }): { token: string; expiresIn: number } | { error: string } {
  const envPassword = process.env.BRIDGE_PASSWORD
  if (envPassword && params.password !== envPassword) {
    return { error: "invalid password" }
  }
  return generateToken()
}

// auth.refresh handler
export function handleRefresh(): { token: string; expiresIn: number } {
  return generateToken()
}

// auth.logout handler
export function handleLogout(): { ok: true } {
  return { ok: true }
}
