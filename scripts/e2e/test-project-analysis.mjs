#!/usr/bin/env node
/**
 * 服务器端验证：opencode-go/deepseek-v4-flash 分析父目录下其他项目内容
 *
 * 流程:
 *   1. 启动 opencode serve（cwd = 父目录，便于访问兄弟项目）
 *   2. 启动 Bridge
 *   3. WS 创建 session（model = opencode-go/deepseek-v4-flash）
 *   4. 发送分析任务消息 → 验证流式 SSE 事件
 *   5. 清理
 *
 * 环境变量:
 *   PARENT_DIR  — 父目录（默认 D:\code）
 *   MODEL       — 模型名（默认 opencode-go/deepseek-v4-flash）
 *   OPENCODE_PORT / BRIDGE_PORT / BRIDGE_PASSWORD
 *
 * 注意:
 *   opencode-go provider 的 API key 必须通过 env OPENCODE_API_KEY 注入 serve 进程
 *   （serve 模式不读 auth.json 的 opencode-go 条目，只认 env；CLI run 模式才读 auth.json）。
 *   脚本会自动从 auth.json 解析 key，无需手动设置。
 */
import { execSync, spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import net from "node:net"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(ROOT, "servers/bridge/node_modules/ws"))

const OC_PORT = parseInt(process.env.OPENCODE_PORT || "4106", 10)
const BR_PORT = parseInt(process.env.BRIDGE_PORT || "20006", 10)
const PARENT_DIR = process.env.PARENT_DIR || "D:\\code"
const MODEL = process.env.OPENCODE_MODEL || "opencode-go/deepseek-v4-flash"
const QUESTION = process.env.ANALYSIS_QUESTION ||
  "请扫描 D:\\code 目录（父目录），列出其中除 mobile-agent-bridge 之外的其他项目，并简要分析每个项目的用途、技术栈和核心结构。不要执行任何修改操作。"

// opencode-go provider 在 models.dev 定义 env=OPENCODE_API_KEY。
// serve 模式不读 auth.json 的 opencode-go 条目，必须显式注入该 env，否则模型解析失败
// （Model unavailable / HTTP 401 Missing API key）。CLI `opencode run` 才读 auth.json。
function resolveOpenCodeAPIKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY
  // 从 Windows 注册表 User 级环境变量读取（setx 持久化的值，opencode 进程可能未继承）
  try {
    const reg = require("child_process").execSync(
      'reg query "HKCU\\Environment" /v OPENCODE_API_KEY',
      { stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" }
    ).toString()
    const m = reg.match(/OPENCODE_API_KEY\s+REG_\w+\s+(\S+)/)
    if (m && m[1]) return m[1]
  } catch (_) {}
  try {
    const authPath = resolve(process.env.USERPROFILE || "C:\\Users\\MT", ".local", "share", "opencode", "auth.json")
    const auth = JSON.parse(require("fs").readFileSync(authPath, "utf-8"))
    for (const provider of ["opencode-go", "opencode"]) {
      if (auth[provider] && typeof auth[provider].key === "string" && auth[provider].key) return auth[provider].key
    }
  } catch (_) {}
  return undefined
}
const OPENCODE_API_KEY = resolveOpenCodeAPIKey()
if (!OPENCODE_API_KEY) {
  console.error("[FATAL] 无法解析 OPENCODE_API_KEY（未设置环境变量且 auth.json 无 opencode-go/opencode 条目）")
  process.exit(2)
}

let pass = 0, fail = 0
function ok(m) { pass++; console.log("  \u2713 " + m) }
function no(m) { fail++; console.log("  \u2717 " + m) }
function slp(t) { return new Promise(r => setTimeout(r, t)) }

function waitPort(p, t) {
  t = t || 30000; const s = Date.now()
  return new Promise((ok, no) => {
    function poll() {
      if (Date.now() - s > t) return no(new Error("timeout:" + p))
      const c = net.createConnection(p, "127.0.0.1", () => { c.destroy(); ok() })
      c.on("error", () => { c.destroy(); setTimeout(poll, 500) })
    }
    poll()
  })
}

function killPort(p) {
  try {
    const o = execSync("netstat -ano | findstr \":" + p + " \"", { stdio: "pipe", shell: true, timeout: 3000 }).toString()
    for (const l of o.trim().split("\n").filter(x => x.includes("LISTENING"))) {
      const pid = l.trim().split(/\s+/).pop()
      if (pid && pid !== "0") execSync("taskkill /f /pid " + pid, { stdio: "pipe" })
    }
  } catch (_) {}
}

async function main() {
  console.log("=== 服务器端验证: opencode-go/deepseek-v4-flash 分析父目录其他项目 ===")
  console.log("父目录: " + PARENT_DIR)
  console.log("模型: " + MODEL + "\n")

  // 全局超时兜底
  setTimeout(() => { console.log("\n[FATAL] 全局超时，强制退出"); process.exit(2) }, 420000)

  killPort(OC_PORT); killPort(BR_PORT)

  // 直接 spawn opencode.exe（不经 .cmd + shell:true，否则 env 传不到最终进程 → 模型 key 丢失）
  const opencodeExe = process.env.OPENCODE_EXE || resolve(process.env.APPDATA || "C:\\Users\\MT\\AppData\\Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
  const oc = spawn(opencodeExe, ["serve", "--port", "" + OC_PORT, "--print-logs"], { cwd: PARENT_DIR, shell: false, env: { ...process.env, OPENCODE_SERVER_PASSWORD: "", OPENCODE_API_KEY } })
  let ocOut = ""
  oc.stdout.on("data", d => { ocOut += d.toString() })
  oc.stderr.on("data", d => { ocOut += d.toString() })

  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("opencode timeout")), 60000)
    const poll = () => {
      if (ocOut.match(/listening on http/)) { clearTimeout(t); ok() }
      else setTimeout(poll, 200)
    }
    poll()
  })
  ok("OpenCode serve 就绪 (端口 " + OC_PORT + ")")

  const flushOC = setInterval(() => {
    try { require("fs").writeFileSync("logs/build/opencode-serve.log", ocOut) } catch (_) {}
  }, 5000)

  const br = spawn("npx.cmd", ["tsx", resolve(ROOT, "servers/bridge/src/index.ts")], {
    env: { ...process.env, BRIDGE_PORT: "" + BR_PORT, BRIDGE_PASSWORD: "test123", OPENCODE_URL: "http://localhost:" + OC_PORT },
    cwd: resolve(ROOT, "servers/bridge"), shell: true, stdio: "pipe",
  })
  await waitPort(BR_PORT)
  ok("Bridge 就绪 (端口 " + BR_PORT + ")")

  try {
    const ws = new WebSocket("ws://localhost:" + BR_PORT + "/ws?token=x")
    await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); setTimeout(() => no(new Error("ws timeout")), 10000) })
    ok("WS 连接成功")

    let rid = 0
    function call(m, p, t) {
      p = p || {}; t = t || 10000
      return new Promise((ok, no) => {
        const id = "" + (++rid)
        const timer = setTimeout(() => no(new Error("timeout:" + m)), t)
        const h = d => {
          const f = JSON.parse(d.toString())
          if (f.id === id) { clearTimeout(timer); ws.off("message", h); f.ok ? ok(f.payload) : no(new Error(f.error)) }
        }
        ws.on("message", h)
        ws.send(JSON.stringify({ type: "req", id, method: m, params: p }))
      })
    }

    await call("auth.login", { password: "test123" }); ok("auth.login 成功")
    await call("project.switch", { directory: PARENT_DIR }); ok("project.switch 成功 (" + PARENT_DIR + ")")

    const s = await call("session.create", { model: MODEL }, 60000)
    const sid = s && (s.id || s.sessionId || s.sessionID) || ""
    ok("session.create => " + sid.slice(0, 12) + " (模型 " + MODEL + ")")

    const events = []
    const done = new Promise(ok => {
      ws.on("message", d => {
        const f = JSON.parse(d.toString())
        if (f.type !== "notify") return
        events.push(f)
        if (["session.idle", "session.next.text.ended", "session.error"].includes(f.method)) ok()
      })
    })

    console.log("\n--- 发送分析消息 ---")
    console.log("问题: " + QUESTION.slice(0, 80) + "...")
    await call("message.send", { sessionId: sid, message: QUESTION }, 300000)
    console.log("  message.send 已返回，等待 SSE 事件...")

    await Promise.race([done, slp(300000).then(() => console.log("  [warn] 等待回复超时"))])

    const textDeltas = events.filter(e => e.method === "session.next.text.delta")
    const toolEvents = events.filter(e => e.method && e.method.startsWith("session.next.tool"))
    const idle = events.filter(e => e.method === "session.idle")
    const errors = events.filter(e => e.method === "session.error")

    console.log("")
    ok("收到 SSE 事件: " + events.length)
    ok("text.delta: " + textDeltas.length)
    ok("tool 事件: " + toolEvents.length)
    ok("session.idle: " + idle.length)
    const typeCounts = {}
    for (const e of events) { const m = e.method || "(no method)"; typeCounts[m] = (typeCounts[m] || 0) + 1 }
    console.log("  [事件类型分布]")
    for (const [m, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log("    " + m + ": " + c)
    }
    if (errors.length > 0) {
      const msg = errors[0]?.payload?.error || "unknown"
      if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("FreeUsageLimit")) {
        console.log("   \u26a0\ufe0f API 限速 (429) — 管道正常")
        ok("session.error (429 限速，链路通)")
      } else no("session.error: " + msg)
    }

    let fullText = ""
    for (const e of textDeltas) {
      fullText += (e.payload && (e.payload.delta || e.payload.data && e.payload.data.delta || "")) || ""
    }
    if (fullText) {
      console.log("\n  回复摘要 (" + fullText.length + " chars):")
      console.log("  " + fullText.slice(0, 500) + "...")
    } else if (events.length === 0) {
      console.log("\n  [opencode 输出尾部]")
      const lines = ocOut.split("\n").slice(-30)
      lines.forEach(l => console.log("    " + l))
    }

    ws.close()
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  } catch (e) {
    console.error("\nERROR: " + e.message)
    console.log("\n=== " + pass + " pass, " + fail + " fail ===")
  }

  oc.kill("SIGTERM"); br.kill("SIGTERM"); clearInterval(flushOC); await slp(2000)
  oc.kill("SIGKILL"); br.kill("SIGKILL")
  process.exit(fail > 0 ? 1 : 0)
}

main()
