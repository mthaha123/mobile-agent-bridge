// 流式卡顿探针：零模型调用（mock bridge 打桩回放），量化流式期间的 jank / CPU
// 用法: node logs/build/jank-probe.mjs [rate/s] [seconds]
// 前置: stub-code-scroll.mjs --setup 已把 App 指到 mock bridge 并进入 Session 1
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'

const ADB = process.env.ADB || 'C:\\Users\\MT\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const SERIAL = process.env.SERIAL || 'emulator-5554'
const PKG = 'com.mobileagentbridge'
const SESSION = process.env.SESSION_ID || 'mock_s1'
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const IDLE = process.argv.includes('--idle')
const rate = process.argv[2] || '12'
const seconds = process.argv[3] || '30'

console.log(`[jank] reset gfxinfo + clear logcat`)
adb('shell', 'dumpsys', 'gfxinfo', PKG, 'reset')
try { adb('logcat', '-c') } catch {}

let pid = ''
try { pid = adb('shell', 'pidof', PKG).trim() } catch {}
console.log(`[jank] app pid=${pid} streaming rate=${rate}/s for ${seconds}s session=${SESSION}`)

// 流式期间采样主线程 / JS 线程 CPU
const samples = []
const cpuTimer = setInterval(() => {
  try {
    const txt = adb('shell', 'top', '-H', '-n', '1', '-b', '-p', pid)
    for (const l of txt.split(/\r?\n/)) {
      const f = l.trim().split(/\s+/)
      if (f.length < 12) continue
      if (f[11] === 'bileagentbridge') samples.push({ cpu: f[8], time: f[10], res: f[5] })
      if (f[11] === 'mqt_v_js') samples.push({ js: f[8], jsTime: f[10] })
    }
  } catch { /* ignore */ }
}, 3000)

// 打桩流式（子进程自管，符合 AGENTS 约束）
let code = 0
if (IDLE) {
  if (process.env.SCROLL) {
    console.log(`[jank] scroll control for ${seconds}s (native scroll, no JS updates)`)
    const end = Date.now() + Number(seconds) * 1000
    while (Date.now() < end) {
      try { adb('shell', 'input', 'swipe', '540', '1700', '540', '700', '250') } catch { /* ignore */ }
      await sleep(300)
    }
  } else {
    console.log(`[jank] idle baseline for ${seconds}s (no stream)`)
    await sleep(Number(seconds) * 1000)
  }
} else {
  code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/e2e/stream-stub.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODE: process.env.MODE || 'text',
        SECTIONS: process.env.SECTIONS || '60',
        RATE: rate,
        SECONDS: seconds,
        CHUNK: '80',
        SESSION_ID: SESSION,
        MSG_ID: `msg_jank_${process.env.MODE || 'text'}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => process.stdout.write(d))
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('exit', resolve)
    child.on('error', reject)
  })
}
clearInterval(cpuTimer)
console.log(`[jank] stream child exited code=${code}`)
await sleep(2500)

// 抓取结果
const summary = adb('shell', 'dumpsys', 'gfxinfo', PKG)
fs.writeFileSync('logs/build/jank-gfx-summary.txt', summary)
const frames = adb('shell', 'dumpsys', 'gfxinfo', PKG, 'framestats')
fs.writeFileSync('logs/build/jank-gfx-framestats.txt', frames)
let logcat = ''
try { logcat = adb('logcat', '-d', '-s', 'Choreographer:I') } catch {}
fs.writeFileSync('logs/build/jank-logcat.txt', logcat)

const jank = /Janky frames[^\n]*/i.exec(summary)
const p90 = /90th percentile: (\d+)ms/.exec(summary)
const p95 = /95th percentile: (\d+)ms/.exec(summary)
const p99 = /99th percentile: (\d+)ms/.exec(summary)
const highLatency = /Number High input latency: (\d+)/.exec(summary)
const totalFrames = /Total frames rendered: (\d+)/.exec(summary)
const skipped = [...logcat.matchAll(/Skipped (\d+) frames/g)].map((m) => Number(m[1]))
const skippedMax = skipped.length ? Math.max(...skipped) : 0
const skippedSum = skipped.reduce((a, b) => a + b, 0)

console.log('\n===== JANK RESULT =====')
console.log('total frames:', totalFrames ? totalFrames[1] : 'n/a')
console.log('gfxinfo:', jank ? jank[0] : '(none)')
console.log('p90/p95/p99:', (p90 ? p90[1] : '?') + 'ms', (p95 ? p95[1] : '?') + 'ms', (p99 ? p99[1] : '?') + 'ms')
console.log('High input latency frames:', highLatency ? highLatency[1] : 'n/a')
console.log('Choreographer Skipped events:', skipped.length, 'max=', skippedMax, 'sum=', skippedSum)
console.log('main CPU% samples:', samples.filter((s) => s.cpu).map((s) => s.cpu).join(',') || '(none)')
console.log('js   CPU% samples:', samples.filter((s) => s.js).map((s) => s.js).join(',') || '(none)')

// CPU 时间增量（累计 TIME+）：把线程名映射回 mm:ss 的秒数
const parseTime = (t) => {
  if (!t) return null
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1] || 0)
  return h * 3600 + Number(m[2]) * 60 + Number(m[3])
}
const delta = (key, timeKey) => {
  const vals = samples.map((s) => s[key]).filter(Boolean)
  if (vals.length < 2) return null
  const a = parseTime(vals[0])
  const b = parseTime(vals[vals.length - 1])
  return a !== null && b !== null ? (b - a).toFixed(2) + 's' : null
}
console.log('JS  thread CPU-time delta:', delta('jsTime') || 'n/a')
console.log('main thread CPU-time delta:', delta('time') || 'n/a')
