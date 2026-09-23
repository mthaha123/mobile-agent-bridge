// 打桩回放流式事件（零模型调用）：通过 mock bridge 的 __push__ magic 广播 notify
//
// 用法:
//   MODE=text RATE=12  SECONDS=40 node scripts/e2e/stream-stub.mjs
//   MODE=toolinput RATE=137 SECONDS=30 node scripts/e2e/stream-stub.mjs
//   MODE=both RATE=12 SECONDS=40 node scripts/e2e/stream-stub.mjs
//   MODE=text|plain|code SECTIONS=<节数> RATE=<次/秒> SECONDS=<秒> SESSION_ID=mock_s1 node scripts/e2e/stream-stub.mjs
//   text=富 markdown（60 节 ≈17k） plain=纯文本 code=未闭合围栏（SECTIONS=25 ≈16.6k）
//
// 说明：mock bridge 在收到 message.send 且 message 以 __push__: 开头时，
// 会把 <method>/<payload> 广播给所有已连接客户端（App 也连着同一个 mock）。
const url = process.env.WS_URL || 'ws://localhost:8081/ws'
const SESSION = process.env.SESSION_ID || 'mock_s1'
const MSG = process.env.MSG_ID || 'msg_stream_test'
const MODE = process.env.MODE || 'text'
/** 需要走 text.started/delta/ended 的流式文本模式 */
const IS_TEXT = MODE === 'text' || MODE === 'both' || MODE === 'plain' || MODE === 'code'
const RATE = Number(process.env.RATE || 12) // 每秒推送次数
const SECONDS = Number(process.env.SECONDS || 40)
const CHUNK = Number(process.env.CHUNK || 80) // 每次 delta 的字符数
const TOOL_RATE = Number(process.env.TOOL_RATE || 137)
const SECTIONS = Number(process.env.SECTIONS || 60)

/** 生成一篇结构丰富的长文（标题/段落/列表/加粗/表格），体量对齐真实长回复（~40k 字符） */
function buildDoc() {
  // 对照组 1：纯文本（无任何 markdown 标记）
  if (MODE === 'plain') {
    const p =
      '这一段是普通文本，没有任何 markdown 标记，用来对照 markdown 解析与元素挂载的开销。' +
      '它仍然会经过 MarkdownRenderer，但不会产生标题/列表/表格/行内样式等复杂节点。'
    const out = []
    for (let s = 0; s < SECTIONS; s++) out.push(`${p}${p}`)
    return out.join('\n\n')
  }
  // 对照组 2：单个未闭合的超长代码围栏（流式期间围栏始终未闭合）
  if (MODE === 'code') {
    const out = ['```ts']
    for (let i = 0; i < SECTIONS * 10; i++) {
      out.push(`const v${i} = compute(${i}, ${i * 2}, "${'x'.repeat(20)}"); // line ${i}`)
    }
    out.push('```')
    return out.join('\n')
  }
  const out = ['# 长文压测样本\n']
  const lorem =
    '这一段用于模拟模型输出的连续正文，包含 **加粗文本**、普通句子以及足够多的行内节点，' +
    '目的是让 markdown 解析器产生大量块级与行内元素。段落长度接近真实长回复的单段长度。' +
    '继续补充内容以避免过短，使整篇文档达到数万字符的量级。'
  for (let s = 0; s < SECTIONS; s++) {
    out.push(`## 第 ${s + 1} 节 标题\n`)
    out.push(`${lorem}${lorem}\n`)
    out.push(['- 列表项 A', '- 列表项 B', '- 列表项 C'].join('\n') + '\n')
    if (s % 5 === 0) {
      out.push(['| 列一 | 列二 | 列三 |', '| --- | --- | --- |', '| a | b | c |'].join('\n') + '\n')
    }
  }
  return out.join('\n')
}

const doc = buildDoc()
const ws = new WebSocket(url)
let sent = 0
let seq = 0

function req(method, params) {
  return new Promise((resolve, reject) => {
    const id = 'ms' + ++seq
    const onMsg = (e) => {
      let f; try { f = JSON.parse(String(e.data)) } catch { return }
      if (f.type === 'res' && f.id === id) {
        ws.removeEventListener('message', onMsg)
        f.error ? reject(new Error(String(f.error))) : resolve(f.payload)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
    setTimeout(() => reject(new Error('timeout ' + method)), 10000)
  })
}

/**
 * fire-and-forget 推送：不建 promise、不加 listener
 * （早期版本用 req() 等响应，未响应时 listener 累积 → 事件循环 O(n²) 退化，
 *  推 2 秒后定时器直接饿死，压不出真实负载）
 */
let pushId = 0
const notify = (method, payload) => {
  if (ws.readyState !== 1) return
  ws.send(
    JSON.stringify({
      type: 'req',
      id: 'ms' + ++pushId,
      method: 'message.send',
      params: { sessionId: SESSION, message: `__push__:${method}:${JSON.stringify(payload)}` },
    }),
  )
}

let cursor = 0
let toolCursor = 0
let timer = null
let toolTimer = null

ws.addEventListener('open', async () => {
  try { await req('auth.login', { password: 'test123' }) } catch {}
  console.log(`[mock-stream] doc=${doc.length} chars mode=${MODE} rate=${RATE}/s duration=${SECONDS}s`)

  if (IS_TEXT) {
    await notify('session.next.prompt.admitted', { sessionID: SESSION, prompt: 'stream test', messageID: 'msg_user_1' })
    await notify('session.next.text.started', { sessionID: SESSION, assistantMessageID: MSG })
  }

  const step = () => {
    if (cursor < doc.length) {
      const delta = doc.slice(cursor, cursor + CHUNK)
      cursor += CHUNK
      sent += delta.length
      notify('session.next.text.delta', { sessionID: SESSION, assistantMessageID: MSG, delta })
    }
  }

  timer = setInterval(step, Math.max(1, Math.round(1000 / RATE)))

  if (MODE === 'toolinput' || MODE === 'both') {
    // 复刻真机观测到的高频 tool.input.delta 洪流（137/s）
    toolTimer = setInterval(() => {
      const chunk = `{"filePath":"docs/x${toolCursor}.md","content":"段${toolCursor++} ..."}`
      notify('session.next.tool.input.delta', {
        sessionID: SESSION,
        assistantMessageID: MSG,
        callID: 'call_stream_1',
        delta: chunk + '\n',
      })
    }, Math.max(1, Math.round(1000 / TOOL_RATE)))
  }

  setTimeout(async () => {
    clearInterval(timer)
    if (toolTimer) clearInterval(toolTimer)
    if (IS_TEXT) {
      await notify('session.next.text.ended', { sessionID: SESSION, assistantMessageID: MSG, text: doc })
      await notify('session.next.step.ended', { sessionID: SESSION })
    }
    console.log(`[mock-stream] done: sent ${sent} chars (doc ${doc.length}), cursor=${cursor}`)
    process.exit(0)
  }, SECONDS * 1000)
})

ws.addEventListener('error', (e) => { console.log('[mock-stream] WS ERR', e?.message || ''); process.exit(1) })
setInterval(() => {
  console.log(`[mock-stream] t=${Math.round(process.uptime())}s sentChars=${sent} cursor=${cursor}`)
}, 3000)
