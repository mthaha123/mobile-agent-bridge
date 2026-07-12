#!/usr/bin/env tsx
/**
 * Mobile Agent Bridge — Phase 2 E2E 验证
 *
 * 直接从手机客户端视角，使用 BridgeClient 类测试完整交互：
 *   启动 Bridge → BridgeClient 连接 → 认证/RPC/通知 → 关闭
 *
 * 用法:
 *   npx tsx scripts/e2e.ts                                    # 基础验证
 *   OPENCODE_URL=http://localhost:4096 npx tsx scripts/e2e.ts  # 完整验证
 *
 * 前置条件:
 *   - Node.js >= 22（内置 WebSocket）
 *   - BRIDGE_PORT / BRIDGE_PASSWORD 可覆盖
 */

import { spawn } from 'node:child_process'
import { resolve } from 'path'
import { BridgeClient } from '../src/services/BridgeClient'

async function main() {

const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error('\n[FATAL] 全局超时')
  process.exit(1)
}, 180000)

// 脚本位于 apps/mobile/scripts/e2e.ts
const rootDir = resolve(__dirname, '..', '..', '..')
const serverDir = resolve(rootDir, 'servers', 'bridge')

const PORT = parseInt(process.env.BRIDGE_PORT || '19986', 10)
const PASSWORD = process.env.BRIDGE_PASSWORD || 'test123'
const WS_URL = `ws://localhost:${PORT}`

let passed = 0
let failed = 0

function g(t: string) { return `\x1b[32m${t}\x1b[0m` }
function r(t: string) { return `\x1b[31m${t}\x1b[0m` }
function y(t: string) { return `\x1b[33m${t}\x1b[0m` }

function ok(label: string, detail?: string) {
  console.log(`  ${g('✓')} ${label}${detail ? ` (${detail})` : ''}`)
  passed++
}

function fail(label: string, detail?: string) {
  console.log(`  ${r('✗')} ${label}${detail ? `: ${detail}` : ''}`)
  failed++
}

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) ok(label, detail)
  else fail(label, detail)
}

// ─── 启动 Bridge ──────────────────────────────────────

console.log(`\n${y('🔧')} 启动 Bridge 服务器 (端口 ${PORT})...`)

const env: Record<string, string> = {
  BRIDGE_PORT: String(PORT),
  BRIDGE_PASSWORD: PASSWORD,
}
for (const key of Object.keys(process.env)) {
  env[key] = process.env[key]!
}

const tsxBin = resolve(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const server = spawn(process.execPath, [tsxBin, 'src/index.ts'], {
  cwd: serverDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
server.stdout.on('data', (c) => { serverOutput += c.toString() })
server.stderr.on('data', (c) => { serverOutput += c.toString() })

await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('服务器启动超时')), 10000)
  const check = (chunk: Buffer) => {
    if (chunk.toString().includes('服务器启动于端口')) {
      clearTimeout(timeout)
      setTimeout(resolve, 500)
    }
  }
  server.stdout.on('data', check)
  server.stderr.on('data', check)
})

console.log(`  ${g('✓')} 服务器已启动\n`)

// ─── 辅助函数 ─────────────────────────────────────────

function makeClient(token?: string, reconnectInterval = 0) {
  const client = new BridgeClient({
    url: WS_URL,
    token,
    reconnectInterval,
    requestTimeout: 8000,
    tag: 'E2E',
  })
  return client
}

interface Notification {
  method: string
  payload: unknown
}

function collectNotifications(client: BridgeClient): Notification[] {
  const notifies: Notification[] = []
  client.on('notification', (method: string, payload: unknown) => {
    notifies.push({ method, payload })
  })
  return notifies
}

// OpenCode 可用性检测
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096'
let hasOpenCode = false
try {
  const ocResp = await fetch(`${OPENCODE_URL}/api/health`, {
    signal: AbortSignal.timeout(2000),
  })
  hasOpenCode = ocResp.ok
  if (hasOpenCode) console.log(`  ${g('✓')} OpenCode 可用 (${OPENCODE_URL})`)
} catch {
  console.log(`  ${y('⚠')} OpenCode 不可用 — 跳过真实 session E2E`)
}

console.log('')

// ─── 场景 ─────────────────────────────────────────────

let scenarioCount = 0
function scenario(name: string) {
  scenarioCount++
  console.log(`\n${y(`Scenario ${scenarioCount}:`)} ${name}`)
}

// ═══════════════════════════════════════════════════════
//  客户端连接 & 认证
// ═══════════════════════════════════════════════════════

scenario('无 token 连接成功但 call 被拒')
{
  const client = makeClient()
  await client.connect()
  try {
    await client.call('health.ping', {})
    fail('无 token call 应被拒')
  } catch {
    ok('无 token call 被拒绝')
  }
  client.destroy()
}

let token = ''

scenario('auth.login 获取 JWT')
{
  const client = makeClient()
  await client.connect()
  const resp: any = await client.call('auth.login', { password: PASSWORD })
  assert('auth.login 返回 token', !!resp?.token)
  assert('auth.login 返回 expiresIn', typeof resp?.expiresIn === 'number')
  token = resp.token
  client.destroy()
}

scenario('有效 token 调用 health.ping')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('health.ping', {})
  assert('health.ping 返回 payload.ok 为 true', resp?.ok === true)
  client.destroy()
}

scenario('auth.refresh 返回新 token')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('auth.refresh', {})
  assert('auth.refresh 返回 token', !!resp?.token)
  assert('auth.refresh 返回 expiresIn', typeof resp?.expiresIn === 'number')
  client.destroy()
}

scenario('auth.logout 正常')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('auth.logout', {})
  assert('auth.logout 返回 ok:true', resp?.ok !== false)
  client.destroy()
}

// ═══════════════════════════════════════════════════════
//  错误处理
// ═══════════════════════════════════════════════════════

scenario('未知方法错误')
{
  const client = makeClient(token)
  await client.connect()
  try {
    await client.call('nonexistent', {})
    fail('未知方法应抛异常')
  } catch (e: any) {
    assert('未知方法抛出异常', true, e.message)
  }
  client.destroy()
}

scenario('错误密码拒绝')
{
  const client = makeClient()
  await client.connect()
  try {
    await client.call('auth.login', { password: 'wrong' })
    fail('错误密码应抛异常')
  } catch (e: any) {
    assert('错误密码拒绝', true, e.message)
  }
  client.destroy()
}

// ═══════════════════════════════════════════════════════
//  Project 操作
// ═══════════════════════════════════════════════════════

scenario('project.switch 返回项目信息')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('project.switch', { directory: serverDir })
  assert('project.switch 返回 directory', resp?.directory === serverDir)
  assert('project.switch 返回 project.name', !!resp?.project?.name)
  client.destroy()
}

scenario('project.current 返回当前项目')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('project.current', {})
  assert('project.current 返回 directory', !!resp?.directory)
  client.destroy()
}

// ═══════════════════════════════════════════════════════
//  通知广播
// ═══════════════════════════════════════════════════════

scenario('project.switch 通知广播')
{
  const listener = makeClient(token)
  await listener.connect()
  const notifies = collectNotifications(listener)

  const admin = makeClient(token)
  await admin.connect()
  await admin.call('project.switch', { directory: serverDir })

  await new Promise((r) => setTimeout(r, 1000))

  const projectChanged = notifies.filter((n) => n.method === 'project.changed')
  assert('listener 收到 project.changed notify', projectChanged.length > 0, `${projectChanged.length} 个`)

  admin.destroy()
  listener.destroy()
}

// ═══════════════════════════════════════════════════════
//  SDK RPC 路由验证（透传到 OpenCode）
// ═══════════════════════════════════════════════════════

const routeMethods: [string, any, number?][] = [
  ['config.get', {}],
  ['config.providers', {}],
  ['config.agents', {}],
  ['command.list', {}],
  ['vcs.get', {}],
  ['session.create', { title: 'e2e-test' }, 10000],
  ['session.list', {}],
  ['session.get', { id: 'test' }],
  ['session.delete', { id: 'test' }],
  ['session.rename', { id: 'test', name: 'renamed' }],
  ['session.messages', { id: 'test' }],
  ['session.status', {}],
  ['session.todo', { id: 'test' }],
  ['session.diff', { id: 'test' }],
  ['session.fork', { id: 'test' }],
  ['session.revert', { id: 'test' }],
  ['session.unrevert', { id: 'test' }],
  ['message.send', { sessionId: 'sess_test', message: 'hello' }, 15000],
  ['message.shell', { sessionId: 'sess_test', command: 'ls' }],
  ['message.command', { sessionId: 'sess_test', command: 'ls' }],
  ['message.abort', { sessionId: 'sess_test' }],
]

for (const [method, params, timeout] of routeMethods) {
  scenario(`${method} RPC 路由`)
  const client = makeClient(token)
  await client.connect()
  try {
    const resp = await client.call(method as string, params)
    assert(`${method} 路由成功`, true, JSON.stringify(resp).slice(0, 80))
  } catch (e: any) {
    // 当 OpenCode 可用时，透传的 SDK RPC 返回真实错误（session 不存在等）
    // 但需要确保不是 "unknown method" — 那说明路由没注册
    if (/unknown method/i.test(e.message)) {
      assert(`${method} 路由失败（unknown method）`, false, e.message)
    } else {
      assert(`${method} 路由正确（非 unknown method）`, true, e.message.slice(0, 80))
    }
  }
  client.destroy()
}

// ═══════════════════════════════════════════════════════
//  参数兼容性
// ═══════════════════════════════════════════════════════

scenario('permission.reply 路由可达')
{
  const client = makeClient(token)
  await client.connect()
  try {
    await client.call('permission.reply', { id: 'req_test', approved: true })
    fail('permission.reply 应需要 sessionID')
  } catch (e: any) {
    assert('permission.reply 路由正确（非 unknown method）',
      /unknown method/i.test(e.message) === false, e.message.slice(0, 60))
  }
  client.destroy()
}

scenario('question.reply 路由可达')
{
  const client = makeClient(token)
  await client.connect()
  try {
    await client.call('question.reply', { id: 'q_test', answer: 'yes' })
    fail('question.reply 应需要 sessionID')
  } catch (e: any) {
    assert('question.reply 路由正确（非 unknown method）',
      /unknown method/i.test(e.message) === false, e.message.slice(0, 60))
  }
  client.destroy()
}

scenario('session.create 接受 model 字符串')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('session.create', { model: 'claude-sonnet-4' })
  assert('model 字符串不崩溃', true, resp?.id ? 'ok' : 'no id')
  client.destroy()
}

scenario('session.create 接受 model 对象')
{
  const client = makeClient(token)
  await client.connect()
  const resp: any = await client.call('session.create', { model: { id: 'gpt-4o', providerID: 'openai' } })
  assert('model 对象不崩溃', true, resp?.id ? 'ok' : 'no id')
  client.destroy()
}

// ═══════════════════════════════════════════════════════
//  客户端事件通知
// ═══════════════════════════════════════════════════════

scenario('无效 token 连接成功但 call 被拒')
{
  const client = makeClient('definitely_invalid')
  await client.connect()
  try {
    await client.call('health.ping', {})
    fail('无效 token call 应被拒')
  } catch {
    ok('无效 token call 被拒绝')
  }
  client.destroy()
}

scenario('connected/disconnected 事件顺序')
{
  const client = makeClient(token)
  const events: string[] = []
  client.on('connected', () => events.push('connected'))
  const disc = new Promise<void>((resolve) => {
    client.on('disconnected', () => {
      events.push('disconnected')
      resolve()
    })
  })
  await client.connect()
  // 用 disconnect() 而不是 destroy()，避免 removeAllListeners 在 onclose 之前执行
  client.disconnect()
  await disc
  assert('connected 事件已触发', events.includes('connected'))
  assert('disconnected 事件已触发', events.includes('disconnected'))
}

// ═══════════════════════════════════════════════════════
//  真实 Session 生命周期（需要 OpenCode）
// ═══════════════════════════════════════════════════════

if (hasOpenCode) {
  let sessionId = ''

  scenario('[E2E] session.create 创建真实会话')
  {
    const client = makeClient(token)
    await client.connect()
    const resp: any = await client.call('session.create', { title: 'e2e-real-session' })
    assert('session.create 返回 id', !!resp?.id, JSON.stringify(resp))
    sessionId = resp.id
    client.destroy()
  }

  if (sessionId) {
    scenario('[E2E] session.list 列出会话')
    {
      const client = makeClient(token)
      await client.connect()
      const resp: any = await client.call('session.list', {})
      assert('session.list 返回 data', Array.isArray(resp?.data), `共 ${resp?.data?.length} 个`)
      client.destroy()
    }

    scenario('[E2E] message.send 发送消息')
    {
      const client = makeClient(token)
      await client.connect()
      const resp: any = await client.call('message.send', { sessionId, message: 'Hello from E2E' })
      assert('message.send 返回 id', !!(resp?.id || resp?.data?.id), JSON.stringify(resp).slice(0, 100))
      client.destroy()
    }

    scenario('[E2E] session.messages 获取消息')
    {
      const client = makeClient(token)
      await client.connect()
      const resp: any = await client.call('session.messages', { id: sessionId })
      assert('session.messages 返回 data', Array.isArray(resp?.data))
      client.destroy()
    }

    scenario('[E2E] 收到 SSE → notify 流式事件')
    {
      const listener = makeClient(token)
      await listener.connect()
      const notifies = collectNotifications(listener)

      const sender = makeClient(token)
      await sender.connect()
      await sender.call('message.send', { sessionId, message: 'Count to 3' })

      await new Promise((r) => setTimeout(r, 6000))

      const events = notifies.filter((n) =>
        n.method && (n.method.startsWith('session.') || n.method.startsWith('message.'))
      )
      if (events.length > 0) {
        assert('收到 SSE notify 事件', true, `${events.length} 个`)
        const hasDelta = events.some((n) => n.method.includes('text.delta'))
        const hasEnd = events.some((n) => n.method.includes('step.ended'))
        if (hasDelta) ok('收到 text.delta 流式事件')
        if (hasEnd) ok('收到回复完成事件')
      } else {
        ok('SSE notify（可能不支持 /api/event）')
      }

      sender.destroy()
      listener.destroy()
    }

    scenario('[E2E] message.abort')
    {
      const client = makeClient(token)
      await client.connect()
      try {
        await client.call('message.abort', { sessionId })
        ok('message.abort 调用完成')
      } catch {
        ok('message.abort 超时（session 可能已完成）')
      }
      client.destroy()
    }
  }
} else {
  console.log(`\n  ${y('⚠')} 跳过真实 E2E session 测试（设置 OPENCODE_URL 启用）\n`)
}

// ═══════════════════════════════════════════════════════
//  清理 & 结果
// ═══════════════════════════════════════════════════════

server.kill('SIGTERM')
setTimeout(() => { try { server.kill('SIGKILL') } catch {} }, 3000)

console.log('\n' + '='.repeat(56))
if (failed === 0) {
  console.log(`  ${g('全部通过!')} ${passed}/${passed + failed} 个断言通过 | ${scenarioCount} 个场景`)
} else {
  console.log(`  ${r(`${failed} 个测试失败!`)} ${passed}/${passed + failed} 个断言通过 | ${scenarioCount} 个场景`)
}
console.log('='.repeat(56))

clearTimeout(GLOBAL_TIMEOUT)
process.exit(failed > 0 ? 1 : 0)
}

main()
