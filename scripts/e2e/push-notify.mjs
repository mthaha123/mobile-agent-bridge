#!/usr/bin/env node
/**
 * 向 Mock Bridge 发送 push 通知
 *
 * 用法:
 *   node scripts/e2e/push-notify.mjs <method> <payload-json>
 *
 * 示例:
 *   node scripts/e2e/push-notify.mjs permission.v2.asked '{"id":"req-1","tool":"writeFile","args":{"path":"test.ts"},"sessionId":"mock_s1","requestedAt":1234567890}'
 *
 * 环境变量:
 *   MOCK_PUSH_PORT  Mock Bridge push API 端口 (默认 18081)
 */

const host = process.env.MOCK_PUSH_HOST || 'localhost'
const port = process.env.MOCK_PUSH_PORT || '18081'

const method = process.argv[2]
const payloadRaw = process.argv[3] || '{}'

if (!method) {
  console.error('用法: node scripts/e2e/push-notify.mjs <method> [payload-json]')
  process.exit(1)
}

let payload
try {
  payload = JSON.parse(payloadRaw)
} catch {
  payload = {}
}

const data = JSON.stringify({ method, payload })
const url = `http://${host}:${port}/push`

console.error(`[push-notify] POST ${url} method=${method}`)

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: data,
})

const result = await response.json()
if (result.ok) {
  console.log(`[push-notify] OK (sent to ${result.sent} client(s))`)
} else {
  console.error(`[push-notify] FAILED: ${result.error || response.status}`)
  process.exit(1)
}
