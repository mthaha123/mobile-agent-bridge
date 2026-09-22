/**
 * serve 管理全场景验证
 * 覆盖：CRUD、重复/缺参/目录不存在、多实例、状态流转、删除释放端口、正常退出杀 serve
 */
import { spawn, execSync } from "child_process"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const WebSocket = require("ws")
const net = require("net")
const http = require("http")

// 默认连【测试桥 19985】，避免误连生产 8080
const BRIDGE_URL = process.env.BRIDGE_URL || "ws://localhost:19985/ws"
const PASS = "test123"
const DIR_A = "D:\\code\\mobile-agent-bridge"
const DIR_B = "D:\\code"

// 生产隔离守卫：本脚本会 kill bridge，绝不能跑在生产端口上
const PROD_PORTS = [8080, 4097, 4100, 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109]
const BRIDGE_PORT = new URL(BRIDGE_URL).port || (BRIDGE_URL.startsWith("wss") ? "443" : "80")
if (PROD_PORTS.includes(Number(BRIDGE_PORT))) {
  console.error(`[守卫] 拒绝在疑似生产端口 ${BRIDGE_PORT} 上运行（本脚本会 kill bridge）。请使用测试桥 19985。`)
  process.exit(2)
}

let ws, mid = 0, passed = 0, failed = 0

function ok(cond, msg) { if (cond) { passed++; console.log(`  ✅ ${msg}`) } else { failed++; console.error(`  ❌ ${msg}`) } }
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `t${++mid}`
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.id === id) { ws.off("message", h); m.ok ? resolve(m.payload) : reject(new Error(m.error)) } }
    ws.on("message", h)
    ws.send(JSON.stringify({ type: "req", id, method, params }))
    setTimeout(() => { ws.off("message", h); reject(new Error(`Timeout: ${method}`)) }, 15000)
  })
}
function portUsed(port) {
  return new Promise(r => { const s = net.createServer(); s.once("error", () => r(true)); s.once("listening", () => { s.close(); r(false) }); s.listen(port) })
}
function waitForPort(port, ms = 30000) {
  return new Promise(r => {
    const dl = Date.now() + ms
    const iv = setInterval(() => {
      http.get(`http://localhost:${port}/doc`, { timeout: 2000 }, res => { clearInterval(iv); clearTimeout(fb); r(res.statusCode === 200) }).on("error", () => {}).on("timeout", function() { this.destroy() })
      if (Date.now() > dl) { clearInterval(iv); clearTimeout(fb); r(false) }
    }, 1000)
    const fb = setTimeout(() => { clearInterval(iv); r(false) }, ms)
  })
}
/** 只清理【本测试桥】已注册的 serve（绝不无差别杀进程 / 不碰其他 bridge 的 serve） */
async function resetTestBridgeServes() {
  const list = await send("serve.list")
  for (const s of list) {
    try { await send("serve.remove", { id: s.id }) } catch {}
  }
}

async function main() {
  console.log("=== serve 全场景验证 ===\n")

  // 连接
  ws = new WebSocket(BRIDGE_URL)
  await new Promise(r => ws.on("open", r))
  await send("auth.login", { password: PASS })
  console.log("✅ 连接+认证\n")

  // 连接后清理【测试桥自身】的 serve（取代原先无差别 taskkill /IM opencode.exe）
  await resetTestBridgeServes()

  // 场景1: 基本 CRUD
  console.log("场景 1: 基本 CRUD")
  const L0 = await send("serve.list")
  ok(Array.isArray(L0) && L0.length === 0, "初始列表为空")
  const a = await send("serve.add", { name: "Test A", directory: DIR_A })
  ok(a.name === "Test A", `name=Test A`)
  ok(a.port >= 4100, `port=${a.port}`)
  ok(a.status === "starting" || a.status === "running", `status=${a.status}`)
  ok(a.pid > 0, `pid=${a.pid}`)
  const L1 = await send("serve.list")
  ok(L1.length === 1, "列表 1 条")
  console.log("")

  // 场景2: 重复添加
  console.log("场景 2: 重复添加")
  try { await send("serve.add", { name: "Dup", directory: DIR_A }); ok(false, "应该报错") }
  catch (e) { ok(e.message.includes("已存在"), e.message) }
  console.log("")

  // 场景3: 缺参数
  console.log("场景 3: 缺参数")
  try { await send("serve.add", { name: "", directory: DIR_A }); ok(false, "应该报错") }
  catch (e) { ok(e.message.includes("name is required"), e.message) }
  try { await send("serve.add", { name: "X", directory: "" }); ok(false, "应该报错") }
  catch (e) { ok(e.message.includes("directory is required"), e.message) }
  console.log("")

  // 场景4: 目录不存在
  console.log("场景 4: 目录不存在")
  try { await send("serve.add", { name: "Bad", directory: "C:\\nonexistent_xyzzy_999" }); ok(false, "应该报错") }
  catch (e) { ok(e.message.includes("不存在"), e.message) }
  console.log("")

  // 场景5: 多实例
  console.log("场景 5: 多实例")
  const b = await send("serve.add", { name: "Test B", directory: DIR_B })
  ok(b.port === a.port + 1, `port=${b.port}`)
  const L2 = await send("serve.list")
  ok(L2.length === 2, `列表 2 条 (got ${L2.length})`)
  console.log("")

  // 场景6: 状态流转 starting → running
  console.log("场景 6: 状态流转")
  console.log(`  ⏳ 等待 port ${a.port}...`)
  const ready = await waitForPort(a.port, 30000)
  ok(ready, `port ${a.port} 已监听`)
  const L3 = await send("serve.list")
  const fa = L3.find(p => p.id === a.id)
  ok(fa?.status === "running", `status=running (got ${fa?.status})`)
  console.log("")

  // 场景7: 删除 serve（验证端口释放）
  console.log("场景 7: 删除 + 端口释放")
  await send("serve.remove", { id: a.id })
  const L4 = await send("serve.list")
  ok(L4.length === 1, `删后 1 条`)
  ok(L4[0].id === b.id, "剩余 serve B")
  const free = await portUsed(a.port)
  ok(!free, `port ${a.port} 已释放`)
  console.log("")

  // 场景8: 删不存在的 id
  console.log("场景 8: 删不存在 id")
  const r = await send("serve.remove", { id: "nonexistent" })
  ok(r === false, "返回 false")
  console.log("")

  // 场景9: 正常退出杀 serve（会 kill 【测试桥】自身；生产桥已被守卫拦下）
  console.log("场景 9: 正常退出杀 serve")
  ok(await portUsed(b.port), `serve B port ${b.port} 运行中`)
  // 按 BRIDGE_URL 的端口找测试桥 PID
  try {
    const out = execSync(`netstat -ano | findstr :${BRIDGE_PORT} | findstr LISTENING`, { encoding: "utf8" })
    const bpid = parseInt(out.trim().split(/\s+/).pop())
    ok(bpid > 0, `bridge PID=${bpid}`)
    process.kill(bpid, "SIGTERM")
    await new Promise(r => setTimeout(r, 3000))
    ok(!(await portUsed(b.port)), `serve B port ${b.port} 已被清理`)
  } catch (e) {
    ok(false, `bridge kill 失败: ${e.message}`)
  }
  console.log("")

  // 总结
  console.log("=== 结果 ===")
  console.log(`  通过: ${passed}`)
  console.log(`  失败: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error("❌ 致命错误:", e.message); process.exit(1) })
