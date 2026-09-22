// 打桩驱动的客户端 UI 测试：代码块横向滚动（零模型调用）。
// 背景：服务端内容全部可打桩 —— 通过 mock bridge 的 __push__ magic 构造任意消息，
// 再用 adb + uiautomator 量「横向拖动后代码块内容是否真的位移」。
// 判定口径：
//   Android 会把可滚动祖先内的节点 bounds **裁剪到视口**，所以代码块 Text 节点：
//     滚动量为 0 时 left = 视口左 + 内边距（约 53）；
//     滚动量 > 内边距时 left 被裁到视口左（约 11）。
//   即 left 从 53 变到 11 == 内容确实横向位移（PASS）；不变 == 滑不动（FAIL）。
//
// 用法：
//   node scripts/e2e/stub-code-scroll.mjs --setup                # 起 mock + 打开 Session 1
//   node scripts/e2e/stub-code-scroll.mjs --scenario text        # 正文里的代码块
//   node scripts/e2e/stub-code-scroll.mjs --scenario thinking    # 思考块（自动展开）
//   node scripts/e2e/stub-code-scroll.mjs --scenario group       # 聚合工具卡（自动展开）
//   node scripts/e2e/stub-code-scroll.mjs --scenario text --keyboard   # 先弹键盘再滑
//   node scripts/e2e/stub-code-scroll.mjs --all                  # 跑完所有组合，输出矩阵
//
// 已知限制：
//   - shell 场景的代码块只存在于**全屏详情 Modal** 内，Modal 盖住输入框 → 键盘弹不出来，
//     因此 shell+kb 不适用（--all 只跑 shell 一次）。
//   - 打桩消息会**累积在同一个 session**（每跑一次多一条）。同一 session 反复跑几十次后
//     debug 版渲染会变慢、uiautomator 也会更抖；建议每次 --all 前重启 mock bridge
//     （会话清空）再 --setup，得到最干净的矩阵。
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ADB = process.env.ADB || 'C:\\Users\\MT\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const WS_URL = process.env.WS_URL || 'ws://localhost:8081/ws'
const SESSION = process.env.SESSION_ID || 'mock_s1'
const MSG = 'msg_code_stub'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[stub-code]', ...a)

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 1 << 26 })
}
const shell = (...args) => adb('shell', ...args)

// ── UI 树解析 ────────────────────────────────────────────────
function parseNodes(xml) {
  const out = []
  const re = /<node\b[^>]*>/g
  let m
  while ((m = re.exec(xml))) {
    const tag = m[0]
    const get = (k) => {
      const mm = new RegExp(`${k}="([^"]*)"`).exec(tag)
      return mm ? mm[1] : ''
    }
    const bm = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(get('bounds'))
    if (!bm) continue
    out.push({
      cls: get('class'),
      text: get('text'),
      desc: get('content-desc'),
      scrollable: get('scrollable') === 'true',
      clickable: get('clickable') === 'true',
      left: Number(bm[1]),
      top: Number(bm[2]),
      right: Number(bm[3]),
      bottom: Number(bm[4]),
    })
  }
  return out
}

async function dumpNodes(label) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      shell('uiautomator dump /sdcard/ui.xml')
      const xml = adb('shell', 'cat', '/sdcard/ui.xml')
      shell('rm', '/sdcard/ui.xml')
      if (xml.includes('<hierarchy')) return parseNodes(xml)
    } catch {
      /* uiautomator 在界面变动时会返回 null root node，重试 */
    }
    await sleep(1200)
  }
  throw new Error(`dump failed (${label})`)
}

const center = (n) => [Math.round((n.left + n.right) / 2), Math.round((n.top + n.bottom) / 2)]

/** 找代码块：优先本场景锚点命中，再按可见性 + 最靠下（最新消息在列表底部） */
/**
 * 当前场景的锚点文本。打桩消息是**累积**在同一个 session 里的（每跑一次就多一条），
 * 只按"最靠下"挑代码块会挑到别的场景/上一轮的块（实测出现过 viewportLeft 忽 11 忽 32、
 * 甚至挑到被裁剪的块导致误判 FAIL）。按锚点文本锁定"本场景的块"才能保证确定性。
 */
let anchorFilter = null

function findCodeBlock(nodes) {
  const found = []
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].cls !== 'android.widget.HorizontalScrollView') continue
    let text = null
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].cls === 'android.widget.TextView') {
        text = nodes[j]
        break
      }
      if (nodes[j].cls === 'android.widget.HorizontalScrollView') break
    }
    found.push({ scroll: nodes[i], text })
  }
  if (found.length === 0) return null
  let pool = found
  if (anchorFilter) {
    const anchored = pool.filter((f) => f.text && String(f.text.text || '').includes(anchorFilter))
    if (anchored.length > 0) pool = anchored
  }
  // 可见性优先：h > 0 且尽量靠下
  const visible = pool.filter((f) => f.scroll.bottom > f.scroll.top + 20)
  const pool2 = visible.length > 0 ? visible : pool
  return pool2.reduce((a, b) => (b.scroll.bottom >= a.scroll.bottom ? b : a))
}

/** 把代码块横向滚回起点（保证 left 处于「视口左 + 内边距」的基准态） */
function resetCodeScroll(y) {
  for (let i = 0; i < 3; i++) shell('input', 'swipe', '200', String(y), '950', String(y), '300')
}

/**
 * 偏移保持性测试（流式进行中）：
 *   滑一次 → 立刻量 left（应被裁到视口左 = 已滚动）
 *   → 等 3s（流式继续，tail 每 flush 重解析/重挂载）
 *   → 再量 left：若回到「视口左 + 内边距」说明滚动偏移被重置（= 用户感觉"怎么滑都不动"）。 */
async function streamPersistenceTest(scenario) {
  anchorFilter = ANCHORS.stream
  await pushScenario(scenario)
  await sleep(2500)
  const nodes0 = await dumpNodes('persist#init')
  const cb0 = findCodeBlock(nodes0)
  if (!cb0) return { ok: false, reason: '流式期间找不到代码块' }
  const y = Math.round((cb0.scroll.top + cb0.scroll.bottom) / 2)
  const viewportLeft = cb0.scroll.left
  const paddedLeft = cb0.text ? cb0.text.left : null

  resetCodeScroll(y)
  await sleep(700)
  swipeLeft(y)
  await sleep(600)
  const cbA = findCodeBlock(await dumpNodes('persist#after-swipe'))
  const leftAfterSwipe = cbA?.text?.left ?? null

  await sleep(3000) // 流式继续
  const cbB = findCodeBlock(await dumpNodes('persist#after-wait'))
  const leftAfterWait = cbB?.text?.left ?? null
  const cbBTop = cbB?.scroll?.top ?? null
  const cbATop = cbA?.scroll?.top ?? null

  const scrolled = leftAfterSwipe !== null && leftAfterSwipe <= viewportLeft + 2
  const reset = scrolled && leftAfterWait !== null && leftAfterWait > viewportLeft + 10
  return {
    ok: scrolled && !reset,
    viewportLeft,
    paddedLeft,
    leftAfterSwipe,
    leftAfterWait,
    topAfterSwipe: cbATop,
    topAfterWait: cbBTop,
    reason: !scrolled
      ? '滑动本身没生效'
      : reset
        ? `滚动偏移被重置（left ${leftAfterSwipe} → ${leftAfterWait}）—— 流式重挂载把横向偏移清零`
        : `偏移保持（left ${leftAfterSwipe} → ${leftAfterWait}）`,
  }
}

/** 横向拖动一次；dy = 竖向分量（可为负），duration = 手指耗时（慢拖更接近真实手指） */
function swipeLeft(y, dy = 0, duration = 300) {
  shell('input', 'swipe', '950', String(y), '150', String(y + dy), String(duration))
}

/**
 * 斜向滑动矩阵：横向 800px 固定，竖向分量 dy 递增。
 * 若某档开始"横滑失效"，说明父列表（纵向）在该方向抢走了手势。
 */
async function diagonalSwipeMatrix(scenario, cases) {
  const list =
    cases ||
    [
      // 起点二维隔离：x=950/1000 × y=块中部 / 右上角 Copy 按钮
      { startX: 950, yRef: 'mid' },
      { startX: 1000, yRef: 'mid' },
      { startX: 950, yRef: 'copy' },
      { startX: 1000, yRef: 'copy' },
    ]
  anchorFilter = ANCHORS[scenario] || null
  await pushScenario(scenario)
  await sleep(2500)
  await scrollListToBottom(4)
  const visible = await ensureCodeBlockVisible(`${scenario}-diag`)
  if (!visible) return [{ dy: null, ok: false, reason: '代码块不可见' }]

  const rows = []
  for (const c of list) {
    const { dy = 0, duration = 300, startX = 950, yRef = 'mid' } = c
    const nodes = await dumpNodes(`diag-${startX}-${yRef} base`)
    const cb = findCodeBlock(nodes)
    if (!cb) {
      rows.push({ startX, yRef, ok: false, reason: '找不到代码块' })
      continue
    }
    const midY = Math.round((cb.scroll.top + cb.scroll.bottom) / 2)
    // copy：代码块右上角 Copy 按钮中心（实测 bounds ≈ [953, top+11][1060, top+66]）
    const swipeY = yRef === 'copy' ? cb.scroll.top + 38 : midY
    resetCodeScroll(midY)
    await sleep(800)
    const base = await dumpNodes(`diag-${startX}-${yRef} reset`)
    const cb0 = findCodeBlock(base)
    const left0 = cb0?.text?.left ?? null
    const top0 = cb0?.scroll?.top ?? null
    shell('input', 'swipe', String(startX), String(swipeY), '150', String(swipeY + dy), String(duration))
    await sleep(900)
    const after = await dumpNodes(`diag-${startX}-${yRef} after`)
    const cb1 = findCodeBlock(after)
    const left1 = cb1?.text?.left ?? null
    const top1 = cb1?.scroll?.top ?? null
    const movedX = left0 !== null && left1 !== null && left1 < left0
    const movedY = top0 !== null && top1 !== null && Math.abs(top1 - top0) > 20
    rows.push({
      startX,
      yRef,
      dy,
      duration,
      ok: movedX,
      left0,
      left1,
      top0,
      top1,
      listScrolled: movedY,
      reason: movedX ? '横滑生效' : movedY ? '横滑失效 + 列表纵向滚了（父级抢走手势）' : '横滑失效（未位移）',
    })
    const r = rows[rows.length - 1]
    log(`  start=(${startX},${yRef}) dy=${dy} dur=${duration}ms: ${r.reason} left ${left0}->${left1} top ${top0}->${top1}`)
  }
  return rows
}

async function codeBlockScrollTest(label) {
  const before = await dumpNodes(`${label} before`)
  const cb = findCodeBlock(before)
  if (!cb) return { label, ok: false, reason: '找不到代码块（HorizontalScrollView 未渲染）' }
  const y = Math.round((cb.scroll.top + cb.scroll.bottom) / 2)
  const viewportLeft = cb.scroll.left

  // 先把内容滚回起点，保证基准态可测（否则历史滚动会让 left 一直贴在裁剪边界）
  resetCodeScroll(y)
  // 复位手势本身是 swipe，列表/ScrollView 可能还残留动量；带动量时新触摸会被
  // 当作"刹住 fling"消费掉，横向位移为 0 → 实测出现过假 FAIL。多等一拍再测。
  await sleep(1600)
  const base = await dumpNodes(`${label} base`)
  const cbBase = findCodeBlock(base)
  const leftBefore = cbBase && cbBase.text ? cbBase.text.left : null

  swipeLeft(y)
  await sleep(900)
  const after = await dumpNodes(`${label} after`)
  const cb2 = findCodeBlock(after)
  if (!cb2) return { label, ok: false, reason: '拖动后代码块消失' }
  const leftAfter = cb2.text ? cb2.text.left : null

  // PASS：left 从「视口左+padding」被裁到「视口左」（内容真实位移）
  const moved = leftBefore !== null && leftAfter !== null && leftAfter < leftBefore
  return {
    label,
    ok: moved,
    leftBefore,
    leftAfter,
    viewportLeft,
    blockBounds: `[${cb.scroll.left},${cb.scroll.top}][${cb.scroll.right},${cb.scroll.bottom}]`,
    textBoundsBefore: cbBase && cbBase.text ? `[${cbBase.text.left},${cbBase.text.top}][${cbBase.text.right},${cbBase.text.bottom}]` : null,
    textBoundsAfter: cb2.text ? `[${cb2.text.left},${cb2.text.top}][${cb2.text.right},${cb2.text.bottom}]` : null,
    reason: moved ? '内容位移（可横向滚动）' : '拖动后 left 未变化（滑不动）',
  }
}

// ── 打桩：构造消息 ──────────────────────────────────────────
const LONG_LINE =
  'const CONFIG = { baseUrl: "https://example.com/api/v9", timeoutMs: 30000, retries: 5 }; // LONGSTART' +
  '_padding_'.repeat(20) +
  'LONGANCHOR'

/** shell 工具的超长输出行（含空格 → 存在换行机会，与 JSON 单 token 不同） */
const SHELL_LONG_LINE =
  '2026-09-22 00:12:33.123 INFO  [main] com.example.some.very.long.package.name.ServiceBootstrap - ' +
  'starting service with config { env: "prod", region: "ap-northeast-1", retries: 5 } SHELLSTART ' +
  'padding '.repeat(20) +
  'SHELLANCHOR'

/**
 * 每个场景用**专属锚点**：打桩消息会累积在同一个 session 里（同一场景反复跑也会叠加）。
 * 只有锚点唯一，`findCodeBlock` 才能锁定"本次场景的代码块"，不被上一轮的块/别的场景的块
 * 抢走（否则 viewportLeft 忽 11 忽 32、甚至挑到被裁剪的块 → 假 FAIL）。
 */
const ANCHORS = {
  text: 'ANCHOR_TEXT',
  thinking: 'ANCHOR_THINK',
  group: 'ANCHOR_GROUP',
  modal: 'ANCHOR_MODAL',
  shell: 'SHELLANCHOR',
  stream: 'ANCHOR_STREAM',
}

function docWith({ anchor = 'LONGANCHOR' } = {}) {
  const parts = ['# 打桩代码块', '', `下面代码块含超长行（右端有 ${anchor}）。`, '']
  parts.push('```ts', LONG_LINE.replace('LONGANCHOR', anchor), '```', '', '中间一段正文。', '')
  parts.push('文档结束。')
  return parts.join('\n')
}

/** 流式尾部填充（延长流式时长，让滑动发生在流式进行中） */
const STREAM_TAIL = ('后续补充正文，用于延长流式时长。' + ' padding'.repeat(12) + '\n\n').repeat(60)

const pushReq = (ws, method, params) =>
  new Promise((resolve, reject) => {
    const id = 'sc' + Math.floor(Math.random() * 1e9)
    const onMsg = (e) => {
      let f
      try {
        f = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (f.type === 'res' && f.id === id) {
        ws.removeEventListener('message', onMsg)
        f.error ? reject(new Error(String(f.error))) : resolve(f.payload)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
    setTimeout(() => reject(new Error('timeout ' + method)), 10000)
  })

async function pushScenario(scenario) {
  const ws = new WebSocket(WS_URL)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('mock bridge 未就绪')))
  })
  const push = (method, payload) =>
    pushReq(ws, 'message.send', { sessionId: SESSION, message: `__push__:${method}:${JSON.stringify(payload)}` })
  await pushReq(ws, 'auth.login', { password: 'test123' }).catch(() => {})

  const doc = docWith({ anchor: ANCHORS[scenario] || 'LONGANCHOR' })
  await push('session.next.prompt.admitted', {
    sessionID: SESSION,
    messageID: 'msg_user_stub',
    prompt: `stub ${scenario}`,
  })

  if (scenario === 'stream') {
    // 流式进行中测试：不 await 推送循环，让调用方在流式期间滑动。
    // 文档里重复「长尾 + 代码块」，保证流式全程都有一块代码块贴在消息末尾（列表贴底可见）。
    const segment = STREAM_TAIL + '\n\n```ts\n' + LONG_LINE.replace('LONGANCHOR', ANCHORS.stream) + '\n```\n\n'
    const full = '# 打桩流式代码块\n\n' + segment.repeat(4) + '结束。'
    let cursor = 0
    await push('session.next.text.started', { sessionID: SESSION, assistantMessageID: MSG })
    const pump = async () => {
      while (cursor < full.length) {
        const delta = full.slice(cursor, cursor + 60)
        cursor += 60
        await push('session.next.text.delta', { sessionID: SESSION, assistantMessageID: MSG, delta })
        await sleep(120)
      }
      await push('session.next.text.ended', { sessionID: SESSION, assistantMessageID: MSG, text: full })
      await push('session.next.step.ended', { sessionID: SESSION })
      await push('session.idle', { sessionID: SESSION })
      ws.close()
    }
    void pump()
    return ws // 保持连接，流式继续
  }

  if (scenario === 'thinking' || scenario === 'group' || scenario === 'modal') {
    await push('session.next.reasoning.started', { sessionID: SESSION, assistantMessageID: MSG })
    // 分片推送，贴近真实流式
    for (let i = 0; i < doc.length; i += 60) {
      await push('session.next.reasoning.delta', {
        sessionID: SESSION,
        assistantMessageID: MSG,
        delta: doc.slice(i, i + 60),
      })
    }
    await push('session.next.reasoning.ended', { sessionID: SESSION, assistantMessageID: MSG })
    if (scenario === 'group' || scenario === 'modal') {
      await push('session.next.tool.called', {
        sessionID: SESSION,
        assistantMessageID: MSG,
        callID: 'call-stub-1',
        tool: 'bash',
        input: { command: 'echo stub' },
      })
      await push('session.next.tool.success', { sessionID: SESSION, callID: 'call-stub-1', content: 'stub-done' })
    }
  } else if (scenario === 'shell') {
    // 文本 + bash 工具（超长输出行）→ ShellOutput 只在详情 Modal 里出现
    await push('session.next.text.started', { sessionID: SESSION, assistantMessageID: MSG })
    const intro = '# 打桩 shell 输出\n\n下面工具卡里有超长输出行（右端有 SHELLANCHOR）。'
    await push('session.next.text.ended', { sessionID: SESSION, assistantMessageID: MSG, text: intro })
    await push('session.next.tool.called', {
      sessionID: SESSION,
      assistantMessageID: MSG,
      callID: 'call-shell-1',
      tool: 'bash',
      input: { command: 'cat app.log' },
    })
    await push('session.next.tool.success', {
      sessionID: SESSION,
      callID: 'call-shell-1',
      content: SHELL_LONG_LINE,
    })
  } else {
    await push('session.next.text.started', { sessionID: SESSION, assistantMessageID: MSG })
    for (let i = 0; i < doc.length; i += 60) {
      await push('session.next.text.delta', {
        sessionID: SESSION,
        assistantMessageID: MSG,
        delta: doc.slice(i, i + 60),
      })
    }
    await push('session.next.text.ended', { sessionID: SESSION, assistantMessageID: MSG, text: doc })
  }
  await push('session.next.step.ended', { sessionID: SESSION })
  await push('session.idle', { sessionID: SESSION })
  ws.close()
}

// ── UI 交互 ────────────────────────────────────────────────
/** 展开思考块 / 聚合卡片：点标题节点 */
async function expandBlock(label) {
  const nodes = await dumpNodes(label)
  const target = nodes.find(
    (n) =>
      n.clickable &&
      (n.desc.includes('操作') ||
        n.text.includes('操作') ||
        n.text.includes('思考过程') ||
        n.text.includes('思考中') ||
        n.desc.includes('思考')),
  )
  if (!target) {
    // 退一步：找可点的标题 TextView
    const alt = nodes.find((n) => n.text.includes('思考') || n.text.includes('操作'))
    if (!alt) return false
    const [x, y] = center(alt)
    shell('input', 'tap', String(x), String(y))
    await sleep(1200)
    return true
  }
  const [x, y] = center(target)
  shell('input', 'tap', String(x), String(y))
  await sleep(1200)
  return true
}

/** 把列表滚到底（让最后一张卡片完整进入视口） */
async function scrollListToBottom(times = 6) {
  for (let i = 0; i < times; i++) {
    shell('input', 'swipe', '540', '1200', '540', '500', '250')
    await sleep(450)
  }
  await sleep(800)
}

/** 确保代码块真正可见（被列表折叠区裁掉时先滚进视口） */
async function ensureCodeBlockVisible(label, maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    const nodes = await dumpNodes(`${label}#vis${i}`)
    const cb = findCodeBlock(nodes)
    const visible =
      cb && cb.text && cb.text.bottom > cb.text.top + 20 && cb.scroll.bottom > cb.scroll.top + 20
    if (visible) return { nodes, cb }
    shell('input', 'swipe', '540', '1100', '540', '600', '300')
    await sleep(900)
  }
  return null
}

/**
 * 打开操作块详情 Modal（点「查看详情」/「展开全部」入口；入口可能在折叠区外，需要滚动列表找）。
 * 打桩消息会累积，旧卡片也有同样的入口 —— 必须挑**屏内 + 最靠下**（= 最新卡片）的那个，
 * 否则会点到屏外旧入口的坐标（点空）→ 误报"打不开详情 Modal"。
 */
async function openDetailModal(label) {
  for (let i = 0; i < 5; i++) {
    const nodes = await dumpNodes(`${label}#${i}`)
    const all = nodes.filter(
      (n) => n.text === '查看详情' || n.text.startsWith('展开全部') || n.desc === '展开全部工具',
    )
    const onScreen = all.filter((n) => n.bottom > 200 && n.top < 2300 && n.bottom - n.top > 10)
    const pool = onScreen.length > 0 ? onScreen : all
    const entry = pool.reduce((a, b) => (b.top >= a.top ? b : a), null)
    if (entry) {
      const [x, y] = center(entry)
      shell('input', 'tap', String(x), String(y))
      await sleep(1800)
      const after = await dumpNodes(`${label}#${i} after`)
      if (after.some((n) => n.text === '工具详情')) return true
    }
    // 入口在裁剪区下方 → 把列表往上滚一点再找
    shell('input', 'swipe', '540', '1100', '540', '600', '300')
    await sleep(900)
  }
  return false
}

/** 打开键盘（点消息输入框），并确认窗口确实被压缩（输入框上移） */
async function openKeyboard() {
  const nodes = await dumpNodes('openKeyboard')
  const input = nodes.find((n) => n.cls === 'android.widget.EditText')
  if (!input) return false
  const yBefore = input.top
  const [x, y] = center(input)
  shell('input', 'tap', String(x), String(y))
  await sleep(1500)
  const after = await dumpNodes('openKeyboard after')
  const input2 = after.find((n) => n.cls === 'android.widget.EditText')
  return !!input2 && input2.top < yBefore - 100
}

async function closeKeyboard() {
  shell('input', 'keyevent', '4')
  await sleep(1000)
}

/** 起 mock bridge + 进入 Session 1（自包含：自己把 App 设置指向 mock） */
async function setup() {
  log('setup: 指向 mock bridge + adb reverse + 启动 App')
  // 1) 把 App 的 bridgeUrl 指到 mock（adb reverse 后的 localhost:8081）
  const settings = {
    defaultAgent: null,
    defaultModel: null,
    chatDisplayMode: 'grouped',
    bridgeUrl: 'ws://localhost:8081/ws',
    bridgePassword: 'test123',
    projectDirectory: 'D:\\code\\mobile-agent-bridge',
  }
  const tmp = join(tmpdir(), 'stub-code-settings.json')
  writeFileSync(tmp, JSON.stringify(settings))
  shell('am', 'force-stop', 'com.mobileagentbridge')
  adb('push', tmp, '/data/local/tmp/stub-code-settings.json')
  shell('run-as', 'com.mobileagentbridge', 'cp', '/data/local/tmp/stub-code-settings.json', 'files/mobile-agent-bridge-settings.json')
  shell('rm', '/data/local/tmp/stub-code-settings.json')
  // 2) adb reverse：mock bridge 监听宿主 8081
  try {
    adb('reverse', 'tcp:8081', 'tcp:8081')
  } catch {}
  await sleep(500)
  shell('am', 'start', '-n', 'com.mobileagentbridge/.MainActivity')
  // debug 版（ART 解释执行）冷启到会话列表可能 > 30s，等待给足 40 轮
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    const nodes = await dumpNodes('setup').catch(() => [])
    const connect = nodes.find((n) => n.desc === 'Connect' || n.text === 'Connect')
    if (connect) {
      const [x, y] = center(connect)
      shell('input', 'tap', String(x), String(y))
      await sleep(2500)
      continue
    }
    const row = nodes.find((n) => n.desc.startsWith('Session Session 1') || n.text === 'Session 1')
    if (row) {
      const [x, y] = center(row)
      shell('input', 'tap', String(x), String(y))
      await sleep(2500)
      log('setup: 已进入 Session 1')
      return true
    }
  }
  log('setup: 未能进入会话（请检查 mock bridge 是否在 8081 监听）')
  return false
}

// ── 主流程 ──────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

async function runOne(scenario, keyboard) {
  const label = `${scenario}${keyboard ? '+kb' : ''}`
  anchorFilter = ANCHORS[scenario] || null
  log(`scenario=${scenario} keyboard=${keyboard ? 'open' : 'closed'}`)
  await pushScenario(scenario)
  await sleep(2500)

  if (scenario === 'thinking' || scenario === 'group' || scenario === 'modal' || scenario === 'shell') {
    const expanded = await expandBlock('expand')
    log(`  expand=${expanded}`)
    await sleep(1200)
  }
  // 先把卡片滚进视口（否则会被列表折叠区裁掉，测不到）；流式场景列表已贴底，不再滚动
  if (scenario !== 'stream') await scrollListToBottom(scenario === 'modal' || scenario === 'shell' ? 6 : 4)

  if (scenario === 'modal' || scenario === 'shell') {
    const opened = await openDetailModal('open-detail')
    log(`  detailModal=${opened}`)
    if (!opened) return { label, ok: false, reason: '打不开详情 Modal' }
    await sleep(1200)
  }

  if (keyboard) {
    const ok = await openKeyboard()
    log(`  keyboard=${ok ? 'opened' : 'NOT opened'}`)
    if (!ok) return { label, ok: false, reason: '键盘未能弹出' }
    if (scenario !== 'modal') await scrollListToBottom(3)
  }

  const visible = await ensureCodeBlockVisible(label, scenario === 'stream' ? 3 : 6)
  if (!visible) {
    if (keyboard) await closeKeyboard()
    return { label, ok: false, reason: '代码块始终不可见（被裁剪在视口外）' }
  }
  const result = await codeBlockScrollTest(label)
  result.label = label
  if (keyboard) await closeKeyboard()
  // 卫生：详情 Modal 用完要关掉。否则下一次跑（比如 shell+kb）会在**已打开的 Modal 里**
  // 找「查看详情」入口 → 永远找不到 → 误报"打不开详情 Modal"（实测踩过）。
  if (scenario === 'modal' || scenario === 'shell') {
    shell('input', 'keyevent', '4')
    await sleep(1000)
  }
  log(`  => ${result.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`)
  return result
}

async function main() {
  if (has('--setup')) {
    const ok = await setup()
    process.exit(ok ? 0 : 1)
  }
  const results = []
  if (has('--stream-persist')) {
    const r = await streamPersistenceTest(val('--scenario', 'stream'))
    console.log('\n=== 流式期间横向偏移保持性 ===')
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(r)}`)
    process.exit(r.ok ? 0 : 1)
  }
  if (has('--diag-matrix')) {
    const rows = await diagonalSwipeMatrix(val('--scenario', 'text'))
    console.log('\n=== 斜向滑动矩阵（起点 x × 起点 y，横向 800px 固定）===')
    for (const r of rows) {
      console.log(
        `${r.ok ? 'PASS' : 'FAIL'}  start=(${r.startX},${r.yRef})  left ${r.left0}->${r.left1}  top ${r.top0}->${r.top1}  ${r.reason}`,
      )
    }
    process.exit(rows.some((r) => !r.ok) ? 1 : 0)
  }
  if (has('--all')) {
    for (const s of ['text', 'thinking', 'group']) {
      results.push(await runOne(s, false))
      results.push(await runOne(s, true))
    }
    // shell 的代码块只存在于**全屏详情 Modal** 里：Modal 会盖住输入框 →
    // openKeyboard 找不到 EditText → 键盘根本弹不出来，所以 shell+kb 无意义（不适用）。
    results.push(await runOne('shell', false))
  } else {
    const scenario = val('--scenario', 'text')
    results.push(await runOne(scenario, has('--keyboard')))
  }
  console.log('\n=== 结果矩阵 ===')
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}  ${r.reason}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`合计: ${results.length - failed} pass / ${failed} fail`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[stub-code] ERROR', e?.message || e)
  process.exit(2)
})
