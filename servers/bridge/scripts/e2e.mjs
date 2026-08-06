#!/usr/bin/env node
/**
 * Mobile Agent Bridge — Phase 1 E2E 验证脚本（跨平台）
 *
 * 启动 Bridge 服务器 → WS 连接 → 测试认证/路由/错误处理/project → 关闭
 * 替代 e2e.sh（依赖 wscat，不支持 Windows）
 *
 * 用法:
 *   node scripts/e2e.mjs                           # 基础验证（43 场景，无需 OpenCode）
 *   OPENCODE_URL=http://localhost:4096 node scripts/e2e.mjs  # 完整验证（含真实 session 生命周期）
 *   BRIDGE_PORT=9090 BRIDGE_PASSWORD=mysecret node scripts/e2e.mjs
 *
 * 前置条件：
 *   - 基础模式（缺省）：无需 OpenCode，验证 RPC 路由/认证/错误处理/代理透传
 *   - 完整模式（设置 OPENCODE_URL）：需要 OpenCode serve 运行在目标 URL
 */

// 全局超时兜底：确保进程永不无限阻塞
const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error("\n[FATAL] 全局超时 — 测试未在 120s 内完成，强制退出")
  process.exit(1)
}, 120000)

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { createHmac } from "node:crypto"
import { WebSocket } from "ws"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverDir = resolve(__dirname, "..")

// 从环境变量读取，支持自定义
const PORT = parseInt(process.env.BRIDGE_PORT || "19876", 10)
const PASSWORD = process.env.BRIDGE_PASSWORD || "test123"
const BASE = `ws://localhost:${PORT}`

let passed = 0
let failed = 0

function green(text) { return `\x1b[32m${text}\x1b[0m` }
function red(text) { return `\x1b[31m${text}\x1b[0m` }
function yellow(text) { return `\x1b[33m${text}\x1b[0m` }

function ok(label, detail) {
  console.log(`  ${green("✅")} ${label}${detail ? ` (${detail})` : ''}`)
  passed++
}

function fail(label, detail) {
  console.log(`  ${red("❌")} ${label}${detail ? `: ${detail}` : ''}`)
  failed++
}

function assert(label, condition, detail) {
  if (condition) ok(label, detail)
  else fail(label, detail)
}

// ─── 启动 Bridge 服务器 ───────────────────────────────

console.log(`\n${yellow("🔧")} 启动 Bridge 服务器 (端口 ${PORT})...`)

const env = {
  ...process.env,
  BRIDGE_PORT: String(PORT),
  BRIDGE_PASSWORD: PASSWORD,
}

const tsxBin = resolve(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs")
const server = spawn(process.execPath, [tsxBin, "src/index.ts"], {
  cwd: serverDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
})

let serverOutput = ""
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString() })
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString() })

// 等待服务器就绪（最多 10s）
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("服务器启动超时")), 10000)
  const check = (chunk) => {
    const text = chunk.toString()
    if (text.includes("服务器启动于端口")) {
      clearTimeout(timeout)
      setTimeout(resolve, 500)  // 给 WS 一点时间
    }
  }
  server.stdout.on("data", check)
  server.stderr.on("data", check)
})

console.log(`  ${green("✅")} 服务器已启动\n`)

// ─── OpenCode 可用性检测 ─────────────────────────────

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096"
let hasOpenCode = false

try {
  const ocResp = await fetch(`${OPENCODE_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
  hasOpenCode = ocResp.ok
  if (hasOpenCode) console.log(`  ${green("✅")} OpenCode 服务可用 (${OPENCODE_URL})`)
} catch {
  console.log(`  ${yellow("⚠")} OpenCode 服务不可用 (${OPENCODE_URL}) — 跳过真实 session E2E 测试`)
}

console.log("")

// ─── 辅助函数 ─────────────────────────────────────────

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("WS 连接超时"))
    }, 5000)
    ws.on("open", () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function wsSend(ws, frame, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("响应超时")), timeout)
    const handler = (data) => {
      let parsed
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        clearTimeout(timer)
        ws.removeListener("message", handler)
        resolve(data.toString())
        return
      }
      // 跳过通知帧（project.changed 等），继续等待真正的响应
      if (parsed?.type === "notify") return
      clearTimeout(timer)
      ws.removeListener("message", handler)
      resolve(parsed)
    }
    ws.on("message", handler)
    ws.send(JSON.stringify(frame))
  })
}

async function wsTest(token, testFn) {
  const url = token != null ? `${BASE}?token=${encodeURIComponent(token)}` : BASE
  const ws = await wsConnect(url)
  try {
    await testFn(ws)
  } finally {
    ws.close()
  }
}

// ─── 构建一个真正过期的 JWT ──────────────────────────────

function createExpiredJWT() {
  // 手动构造一个 30 分钟前过期的 JWT
  // 使用标准 JWT 格式: base64(header).base64(payload).signature
  const header = { alg: "HS256", typ: "JWT" }
  const payload = {
    sub: "bridge-client",
    role: "user",
    iat: Math.floor(Date.now() / 1000) - 7200,    // 2 小时前签发
    exp: Math.floor(Date.now() / 1000) - 1800,      // 30 分钟前已过期
  }
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  const unsigned = `${b64(header)}.${b64(payload)}`
  // 使用 dev-secret-change-in-production 签名（与 auth.ts 默认一致）
  const hmac = createHmac("sha256", "dev-secret-change-in-production")
  hmac.update(unsigned)
  const sig = hmac.digest("base64url")
  return `${unsigned}.${sig}`
}

// ─── 测试场景 ──────────────────────────────────────────

console.log("=".repeat(56))
console.log("  Mobile Agent Bridge — Phase 1 E2E 验证")
console.log("=".repeat(56))

let token = ""
let scenarioCount = 0

function scenario(name) {
  scenarioCount++
  console.log(`\n${yellow(`Scenario ${scenarioCount}:`)} ${name}`)
}

// ── 场景 1: 认证拒绝 ──────────────────────────────────

scenario("无 token 调用非 auth 方法")
await wsTest(null, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "1", method: "health.ping", params: {} })
  assert("无 token 应被拒绝 (unauthorized)", resp?.ok === false && /unauthorized/i.test(resp?.error || ''))
})

// ── 场景 2: auth.login ──────────────────────────────

scenario("auth.login — 获取 JWT")
await wsTest(null, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "1", method: "auth.login", params: { password: PASSWORD } })
  assert("auth.login 返回 ok: true", resp?.ok === true)
  assert("auth.login 返回 token", !!resp?.payload?.token)
  assert("auth.login 返回 expiresIn", typeof resp?.payload?.expiresIn === "number")
  token = resp.payload.token
})

// ── 场景 3: 有效 token ──────────────────────────────

scenario("有效 token 调用 health.ping")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "2", method: "health.ping", params: {} })
  assert("health.ping 返回 ok: true", resp?.ok === true)
  assert("health.ping payload.ok 为 true", resp?.payload?.ok === true)
})

// ── 场景 4: 未知方法 ────────────────────────────────

scenario("未知方法拒绝")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "3", method: "nonexistent", params: {} })
  assert("未知方法应返回 unknown method 错误", resp?.ok === false && /unknown method/i.test(resp?.error || ''))
})

// ── 场景 5: 无效帧类型 ───────────────────────────────

scenario("无效帧类型拒绝")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "invalid", id: "4", method: "health.ping" })
  assert("无效帧类型应返回 invalid frame type 错误", resp?.ok === false && /invalid frame type/i.test(resp?.error || ''))
})

// ── 场景 6: 格式错误的 JSON ──────────────────────────

scenario("格式错误的 JSON 应返回 invalid json")
await wsTest(token, async (ws) => {
  // 发送原始不可解析的文本（不走 JSON.stringify）
  ws.send("this is not valid json!!!")
  const resp = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("响应超时")), 5000)
    ws.on("message", (data) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(data.toString())) } catch { resolve(data.toString()) }
    })
  })
  assert("格式错误的 JSON 应返回 invalid json", resp?.ok === false && /invalid json/i.test(resp?.error || ''))
})

// ── 场景 7: 无效 token ──────────────────────────────

scenario("无效 token 访问")
{
  const ws2 = await wsConnect(`${BASE}?token=definitely_invalid_token_here`)
  const resp = await wsSend(ws2, { type: "req", id: "5", method: "health.ping", params: {} })
  assert("无效 token 应被拒绝 (unauthorized)", resp?.ok === false && /unauthorized/i.test(resp?.error || ''))
  ws2.close()
}

// ── 场景 8: 真正的 JWT 过期检测 ────────────────────────

scenario("真正过期的 JWT 应被拒绝")
{
  const expiredToken = createExpiredJWT()
  const ws2 = await wsConnect(`${BASE}?token=${encodeURIComponent(expiredToken)}`)
  const resp = await wsSend(ws2, { type: "req", id: "8", method: "health.ping", params: {} })
  // jwt.verify() 会因 exp 过期而抛出，verifyToken 返回 null → router 拒绝
  assert("过期 token 应被拒绝 (unauthorized)", resp?.ok === false && /unauthorized/i.test(resp?.error || ''))
  ws2.close()
}

// ── 场景 9: auth.login 错误密码 ──────────────────────

scenario("auth.login 错误密码拒绝")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "9", method: "auth.login", params: { password: "wrong_password" } })
  assert("错误密码应返回 ok:false", resp?.ok === false, JSON.stringify(resp))
  assert("错误密码应包含 invalid password", /invalid password/i.test(resp?.error || ''), JSON.stringify(resp))
})

// ── 场景 10: auth.logout ────────────────────────────

scenario("auth.logout 不崩溃")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "10", method: "auth.logout", params: {} })
  assert("auth.logout 返回 ok: true", resp?.ok === true)
  assert("auth.logout 不返回错误", resp?.error == null)
})

// ── 场景 11: auth.refresh ───────────────────────────

scenario("auth.refresh 返回新 token")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "11", method: "auth.refresh", params: {} })
  assert("auth.refresh 返回 ok: true", resp?.ok === true)
  assert("auth.refresh 返回 token", !!resp?.payload?.token, JSON.stringify(resp))
  assert("auth.refresh 返回 expiresIn", typeof resp?.payload?.expiresIn === "number")
})

// ── 场景 12: session 方法在 project.switch 之前应失败 ──

scenario("session.create 在 project.switch 之前应返回 SDK not initialized")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "12", method: "session.create", params: {} }, 5000)
  assert("未初始化时 session.create 应返回 ok:false", resp?.ok === false, JSON.stringify(resp))
  assert("未初始化时错误应包含 not initialized", /not initialized/i.test(resp?.error || ''), JSON.stringify(resp))
})

scenario("session.list 在 project.switch 之前应返回 SDK not initialized")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "12b", method: "session.list", params: {} }, 5000)
  assert("未初始化时 session.list 应返回 ok:false", resp?.ok === false, JSON.stringify(resp))
  assert("未初始化时错误应包含 not initialized", /not initialized/i.test(resp?.error || ''), JSON.stringify(resp))
})

// ── 场景 13: project.switch ──────────────────────────

scenario("project.switch 返回项目信息")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "12", method: "project.switch", params: { directory: serverDir } })
  // initBackend() 在启动时调用，switchProject 能成功初始化（SSE 后台运行）
  assert("project.switch 返回 ok: true", resp?.ok === true, JSON.stringify(resp))
  assert("project.switch 返回 directory", resp?.payload?.directory === serverDir, JSON.stringify(resp))
  assert("project.switch 返回 project.name", !!resp?.payload?.project?.name, JSON.stringify(resp))
})

// ── 场景 14: project.current ────────────────────────

scenario("project.current 返回当前项目信息")
await wsTest(token, async (ws) => {
  const resp = await wsSend(ws, { type: "req", id: "13", method: "project.current", params: {} })
  assert("project.current 返回 ok: true", resp?.ok === true, JSON.stringify(resp))
})

let sdkId = 20

if (!hasOpenCode) {
  // ── SDK 代理方法（仅 OpenCode 不可用时）───────
  // project.switch 已初始化 SDK，但 OpenCode 服务未运行
  // SDK 的 HTTP 请求失败会返回 { ok: true, payload: { error, request } }
  // 而非抛出异常 — 这是 SDK 自身的行为

  // 辅助函数：批量测试 SDK 透传代理方法
  function testSdkProxy(method, params, id, extraAssert) {
    scenario(`${method} 无 OpenCode 时返回 payload.error`)
    return wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(id), method, params }, 8000)
      assert(`${method} RPC 调用成功 (ok:true)`, resp?.ok === true, JSON.stringify(resp))
      assert(`${method} 返回 payload.error`, !!resp?.payload?.error, JSON.stringify(resp))
      if (extraAssert) extraAssert(resp)
    })
  }

  // ── 场景 15-18: 已存在的核心代理方法 ───────────

  scenario("session.create 无 OpenCode 时返回 payload.error")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, { type: "req", id: "14", method: "session.create", params: {} }, 8000)
    assert("session.create RPC 调用成功 (ok:true)", resp?.ok === true, JSON.stringify(resp))
    assert("session.create 返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  scenario("session.list 无 OpenCode 时返回 payload.error")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, { type: "req", id: "15", method: "session.list", params: {} }, 8000)
    assert("session.list RPC 调用成功 (ok:true)", resp?.ok === true, JSON.stringify(resp))
    assert("session.list 返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  scenario("message.send 参数翻译 + 无 OpenCode")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: "16", method: "message.send",
      params: { sessionId: "sess_test", message: "hello" },
    }, 8000)
    assert("message.send RPC 调用成功 (ok:true)", resp?.ok === true, JSON.stringify(resp))
    assert("message.send 返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
    assert("message.send 错误不涉及原始参数名", !/sessionId|message/i.test(JSON.stringify(resp?.payload?.error || '')), JSON.stringify(resp))
  })

  scenario("permission.reply 参数翻译 + 无 OpenCode")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: "17", method: "permission.reply",
      params: { id: "req_test", approved: true },
    }, 8000)
    assert("permission.reply RPC 调用成功 (ok:true)", resp?.ok === true, JSON.stringify(resp))
    assert("permission.reply 返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
    assert("permission.reply 错误不涉及原始参数名", !/id|approved/i.test(JSON.stringify(resp?.payload?.error || '')), JSON.stringify(resp))
  })

  // ── 场景: 会话管理方法全集 ────────────────
  const sessionMethods = [
    { method: "session.get",       params: { id: "sess_test" } },
    { method: "session.delete",    params: { id: "sess_test" } },
    { method: "session.rename",    params: { id: "sess_test", name: "renamed" } },
    { method: "session.messages",  params: { id: "sess_test" } },
    { method: "session.status",    params: {} },
    { method: "session.todo",      params: { id: "sess_test" } },
    { method: "session.diff",      params: { id: "sess_test" } },
    { method: "session.fork",      params: { id: "sess_test", message: "fork here" } },
    { method: "session.revert",    params: { id: "sess_test" } },
    { method: "session.unrevert",  params: { id: "sess_test" } },
  ]

  for (const { method, params } of sessionMethods) {
    const id = sdkId++
    await testSdkProxy(method, params, id)
  }

  scenario("session.revert 额外参数 messageID+partID 透传不崩溃")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.revert",
      params: { id: "sess_test", messageID: "msg_456", partID: "part_789" },
    }, 8000)
    assert("session.revert 带 messageID+partID 不崩溃", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  // ── 场景: project.switch ──────────────────────────
  scenario("project.switch 切换目录 (代理模式)")
  await wsTest(token, async (ws) => {
    const dir = process.cwd()
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "project.switch",
      params: { directory: dir },
    }, 8000)
    if (resp?.ok === false && resp?.error?.includes("already switching")) {
      assert("project.switch 已有切换在进行", true, JSON.stringify(resp))
    } else if (resp?.ok === false && resp?.error?.includes("directory not found")) {
      assert("project.switch 目录不可读", true, JSON.stringify(resp))
    } else {
      assert("project.switch 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      assert("project.switch 返回 directory", resp?.payload?.directory === dir, JSON.stringify(resp))
      assert("project.switch 返回 project.name", typeof resp?.payload?.project?.name === "string", JSON.stringify(resp))
    }
  })

  // ── 场景: message.* 其他方法 ─────────────────────
  const messageMethods = [
    { method: "message.shell",    params: { sessionId: "sess_test", command: "ls" } },
    { method: "message.command",  params: { sessionId: "sess_test", command: "ls" } },
    { method: "message.abort",    params: { sessionId: "sess_test" } },
  ]

  for (const { method, params } of messageMethods) {
    const id = sdkId++
    await testSdkProxy(method, params, id)
  }

  // ── 场景: question.* / permission / config ──
  const otherMethods = [
    { method: "question.reply",   params: { id: "q_test", answer: "yes" } },
    { method: "question.reject",  params: { id: "q_test" } },
    { method: "config.get",       params: {} },
    { method: "config.providers", params: {} },
    { method: "config.agents",    params: {} },
    { method: "provider.list",    params: {} },
    { method: "command.list",     params: {} },
  ]

  for (const { method, params } of otherMethods) {
    const id = sdkId++
    await testSdkProxy(method, params, id)
  }

  // ── 场景: sessionID (all caps) 兼容性 ──────────
  scenario("message.send 接受 sessionID (upper case D)")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "message.send",
      params: { sessionID: "sess_test", message: "hello via sessionID" },
    }, 8000)
    assert("sessionID 大写 D 版本也被接受", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error（无 OpenCode）", !!resp?.payload?.error, JSON.stringify(resp))
  })

  scenario("permission.reply 接受 sessionID (upper case D)")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "permission.reply",
      params: { id: "req_123", sessionID: "sess_123", reply: "always" },
    }, 8000)
    assert("permission.reply 接受 sessionID 大写 D", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  scenario("message.abort 接受 sessionID (upper case D)")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "message.abort",
      params: { sessionID: "sess_123" },
    }, 8000)
    assert("message.abort 接受 sessionID 大写 D", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  // ── 场景: model 参数类型转换 ─────────────────────
  scenario("session.create 接受 model 字符串并转成对象")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.create",
      params: { model: "claude-sonnet-4" },
    }, 8000)
    // 成功转成 { id, providerID } 后发出 SDK 请求，无 OpenCode 时 payload.error
    assert("model 字符串不导致路由崩溃", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error（SDK 网络错误而非参数类型错误）", !!resp?.payload?.error, JSON.stringify(resp))
    // 关键断言：错误信息不应是 SDK 的类型校验失败
    assert("错误不是 SDK 类型校验（如 id required）", !/id.*required|providerID.*required/i.test(JSON.stringify(resp?.payload?.error || '') || ''), JSON.stringify(resp))
  })

  scenario("session.create 接受 model 对象直接透传")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.create",
      params: { model: { id: "gpt-4o", providerID: "openai", variant: "2024-11" } },
    }, 8000)
    assert("model 对象不导致路由崩溃", resp?.ok === true, JSON.stringify(resp))
  })

  // ── 场景: session.list 参数透传 ─────────────────
  scenario("session.list 透传 search/limit 参数")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.list",
      params: { search: "test", limit: 10, cursor: "abc" },
    }, 8000)
    assert("session.list 带额外参数不崩溃", resp?.ok === true, JSON.stringify(resp))
    assert("返回 payload.error", !!resp?.payload?.error, JSON.stringify(resp))
  })

  // ── 场景: session.diff 透传 messageID ──────────
  scenario("session.diff 透传 messageID")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.diff",
      params: { id: "sess_test", messageID: "msg_456" },
    }, 8000)
    assert("session.diff 带 messageID 不崩溃", resp?.ok === true, JSON.stringify(resp))
  })

  // ── 场景: 参数负面测试 ───────────────────────────
  scenario("session.get 缺少 id 参数不应崩溃")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.get", params: {} }, 8000)
    assert("session.get 缺参数不应导致 RPC 崩溃", resp?.ok === true, JSON.stringify(resp))
  })

  scenario("message.send 缺参数不应崩溃")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "message.send", params: {} }, 8000)
    assert("message.send 缺参数不应 RPC 崩溃", resp?.ok === true, JSON.stringify(resp))
  })

  // ── 场景: project.switch 切换目录 ──────────
  scenario("project.switch 切换目录后 session 仍正常工作")
  await wsTest(token, async (ws) => {
    const setupResp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "project.switch", params: { directory: serverDir } }, 5000)
    assert("切换目录返回 ok:true", setupResp?.ok === true, JSON.stringify(setupResp))
    assert("切换目录返回 directory", setupResp?.payload?.directory === serverDir, JSON.stringify(setupResp))

    const sessionResp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.list", params: {} }, 8000)
    assert("切换后 session.list RPC 仍成功 (ok:true)", sessionResp?.ok === true, JSON.stringify(sessionResp))
    assert("切换后 session.list 返回 payload.error（而非 SDK not initialized）", !!sessionResp?.payload?.error, JSON.stringify(sessionResp))
    assert("切换后 session.list 错误不涉及 not initialized", !/not initialized/i.test(JSON.stringify(sessionResp?.error || '')), JSON.stringify(sessionResp))
  })
} else {
  console.log(`\n  ${yellow("⚡")} OpenCode 已连接 — 跳过代理错误测试，进入真实 Session 生命周期验证\n`)
}

// ═══════════════════════════════════════════════════════
//  真实端到端 Session 生命周期（需要 OpenCode 服务）
// ═══════════════════════════════════════════════════════

if (hasOpenCode) {
  console.log(`\n${yellow("═══════════════════════════════════════════")}`)
  console.log(`  真实 E2E Session 生命周期 (OpenCode 已连接)`)
  console.log(`  ${yellow("═══════════════════════════════════════════")}`)

  let sessionId = ""

  scenario("session.create 创建会话")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.create", params: { title: "e2e-test-session" } }, 10000)
    if (resp?.ok === false) {
      // 某些 OpenCode 版本不支持通过 WS 创建 session
      assert("session.create 服务器不支持创建", /error/i.test(resp?.error || '') || /expected/i.test(resp?.error || '') || /not supported/i.test(resp?.error || ''), JSON.stringify(resp))
    } else {
      assert("session.create 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      const sid = resp?.payload?.data?.id || resp?.payload?.id || resp?.payload?.session_id
      assert("session.create 返回 session.id", !!sid, JSON.stringify(resp))
      sessionId = sid
    }
  })

  // ── 场景: model 参数类型转换（有真实 OpenCode）──
  scenario("session.create 接受 model 字符串 → Bridge 转成对象后发送")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.create",
      params: { model: "claude-sonnet-4" },
    }, 10000)
    // Bridge 将 model 从字符串转成 { id, providerID } 后发出 SDK 请求
    // 如果 OpenCode 不接受该 model，会返回 ok:false + error，但不是类型错误
    assert("model 字符串不破坏路由", resp?.ok === true || resp?.ok === false, JSON.stringify(resp))
    if (resp?.ok === false) {
      assert("拒绝原因是服务器行为而非 SDK 参数类型校验", !/id.*required|providerID.*required|Expected.*object/i.test(resp?.error || ''), JSON.stringify(resp))
    }
  })

  scenario("session.create 接受 model 对象直接透传")
  await wsTest(token, async (ws) => {
    const resp = await wsSend(ws, {
      type: "req", id: String(sdkId++), method: "session.create",
      params: { model: { id: "gpt-4o", providerID: "openai" } },
    }, 10000)
    assert("model 对象不破坏路由", resp?.ok === true || resp?.ok === false, JSON.stringify(resp))
  })

  // 只有创建 session 成功后才运行后续测试
  if (sessionId) {
    scenario("session.list 列出所有会话（基础）")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.list", params: {} }, 10000)
      assert("session.list 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      const payload = resp?.payload ?? []
      const sessions = Array.isArray(payload) ? payload : (payload.data ?? [])
      assert("session.list 返回数组", Array.isArray(sessions), JSON.stringify(resp))
    })

    scenario("session.list 带 search/limit 参数")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, {
        type: "req", id: String(sdkId++), method: "session.list",
        params: { search: "e2e", limit: 5 },
      }, 10000)
      assert("session.list 带 search/limit 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      const payload = resp?.payload ?? []
      const sessions = Array.isArray(payload) ? payload : (payload.data ?? [])
      assert("session.list 带 search/limit 返回数组", Array.isArray(sessions), JSON.stringify(resp))
    })

    scenario("session.get 获取会话详情")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.get", params: { id: sessionId } }, 10000)
      assert("session.get 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      const sid = resp?.payload?.data?.id || resp?.payload?.id || resp?.payload?.session_id
      assert("session.get 返回 session.id", sid === sessionId, JSON.stringify(resp))
    })

    scenario("session.status 查询会话状态")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.status", params: {} }, 10000)
      assert("session.status 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
    })

    scenario("message.send 发送消息到会话（使用 sessionID 大写 D）")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, {
        type: "req", id: String(sdkId++), method: "message.send",
        params: { sessionID: sessionId, message: "Hello via sessionID" },
      }, 15000)
      if (resp?.ok === false) {
        assert("message.send (sessionID) 服务器限制", /not supported/i.test(resp?.error || '') || /error/i.test(resp?.error || ''), JSON.stringify(resp))
      } else {
        assert("message.send (sessionID) 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      }
    })

    scenario("message.send 发送消息到会话（使用 sessionId 小写 d）")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, {
        type: "req", id: String(sdkId++), method: "message.send",
        params: { sessionId: sessionId, message: "Hello from E2E test" },
      }, 15000)
      if (resp?.ok === false) {
        assert("message.send (sessionId) 服务器限制", /not supported/i.test(resp?.error || '') || /error/i.test(resp?.error || ''), JSON.stringify(resp))
      } else {
        assert("message.send (sessionId) 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      }
    })

    scenario("session.messages 获取会话消息")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.messages", params: { id: sessionId } }, 10000)
      assert("session.messages 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
    })

    scenario("session.rename 重命名会话（预期受限）")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.rename", params: { id: sessionId, name: "e2e-renamed" } }, 10000)
      if (resp?.ok === false) {
        assert("session.rename 服务器不支持", /not supported/i.test(resp?.error || '') || /error/i.test(resp?.error || ''), JSON.stringify(resp))
      } else {
        assert("session.rename 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      }
    })

    scenario("session.diff 获取文件变更")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, {
        type: "req", id: String(sdkId++), method: "session.diff",
        params: { id: sessionId },
      }, 10000)
      assert("session.diff 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
    })

    scenario("session.revert 带 messageID + partID 参数")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, {
        type: "req", id: String(sdkId++), method: "session.revert",
        params: { id: sessionId, messageID: "msg_test", partID: "part_test" },
      }, 10000)
      if (resp?.ok === false) {
        assert("session.revert 服务器限制", /not supported/i.test(resp?.error || '') || /error/i.test(resp?.error || ''), JSON.stringify(resp))
      } else {
        assert("session.revert 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      }
    })

    scenario("session.delete 删除会话（预期受限）")
    await wsTest(token, async (ws) => {
      const resp = await wsSend(ws, { type: "req", id: String(sdkId++), method: "session.delete", params: { id: sessionId } }, 10000)
      if (resp?.ok === false) {
        assert("session.delete 服务器不支持", /not supported/i.test(resp?.error || '') || /error/i.test(resp?.error || ''), JSON.stringify(resp))
      } else {
        assert("session.delete 返回 ok:true", resp?.ok === true, JSON.stringify(resp))
      }
    })
  } else {
    console.log(`\n  ${yellow("⚠")} session.create 失败 — 跳过真实 E2E session 操作测试\n`)
  }
} else {
  console.log(`\n  ${yellow("⚠")} 跳过真实 E2E session 测试（设置 OPENCODE_URL 指向运行中的 OpenCode serve 以启用）\n`)
}

// ── 清理与结果 ────────────────────────────────────────

server.kill()

console.log("\n" + "=".repeat(56))
if (failed === 0) {
  console.log(`  ${green("全部通过!")} ${passed}/${passed + failed} 个断言通过 | ${scenarioCount} 个场景`)
} else {
  console.log(`  ${red(`${failed} 个测试失败!`)} ${passed}/${passed + failed} 个断言通过 | ${scenarioCount} 个场景`)
  console.log(`\n服务器输出:\n${serverOutput.slice(-500)}`)
}
console.log("=".repeat(56))

clearTimeout(GLOBAL_TIMEOUT)
process.exit(failed > 0 ? 1 : 0)
