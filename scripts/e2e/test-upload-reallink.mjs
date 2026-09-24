#!/usr/bin/env node
/**
 * E2E 真实链路测试：file.upload.* 分块上传
 *
 * 与 test-new-rpcs.mjs（mock-bridge 形状测试）不同，本脚本打【真实 bridge 进程】：
 *   真 WS + 真 JWT 认证 + 真文件系统落盘。
 * 覆盖：login → begin →（.part 临时文件存在但 fileList 不外露）→ 顺序 chunk
 *       → finish 落盘内容逐字节比对 → EEXIST/overwrite → 超限（真实 env limit）
 *       → 乱序 chunk → abort 幂等 → 未认证拒绝 → 非法文件名 → 清理。
 *
 * 用法（先按下方“前置”起 bridge，测试完按“清理”停 bridge）:
 *   node scripts/e2e/test-upload-reallink.mjs
 *
 * 前置（fire-and-forget，测试端口 19985，绝不碰生产 8080）：
 *   $env:BRIDGE_PORT='19985'; $env:BRIDGE_PASSWORD='reallink-test'
 *   $env:BRIDGE_DATA_DIR='D:\code\mobile-agent-bridge\logs\build\reallink-data'
 *   Start-Process -WindowStyle Hidden -FilePath node -ArgumentList '<bridge>/node_modules/tsx/dist/cli.mjs','<bridge>/src/index.ts' -WorkingDirectory '<bridge>' -RedirectStandardOutput '<repo>/logs/build/reallink-bridge.out.log' -RedirectStandardError '<repo>/logs/build/reallink-bridge.err.log'
 *
 * 返回码: 0=全部通过, 1=有失败
 */
import { createRequire } from "node:module"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { TEST_BRIDGE_PORT, assertTestPort } from "../ports.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(projectRoot, "servers/bridge/node_modules/ws"))

const PORT = assertTestPort(Number(process.env.TEST_BRIDGE_PORT || TEST_BRIDGE_PORT), "test-upload-reallink")
const PASSWORD = process.env.E2E_BRIDGE_PASSWORD || "reallink-test"
const WS_URL = `ws://localhost:${PORT}/ws`

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    passed++
    console.log(`  ✅ ${msg}`)
  } else {
    failed++
    console.log(`  ❌ ${msg}`)
  }
}

/** 全局超时兜底（AGENTS: 测试脚本必须自带） */
const bailout = setTimeout(() => {
  console.error("❌ 全局超时（60s）强制退出")
  process.exit(1)
}, 60_000)

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => rej(new Error(`WS connect timeout: ${url}`)), 5000)
    ws.on("open", () => { clearTimeout(timer); res(ws) })
    ws.on("error", (e) => { clearTimeout(timer); rej(e) })
  })
}

/** 单连接 RPC：ok→payload；!ok→throw frame.error */
function makeCall(ws) {
  let reqId = 0
  return (method, params = {}) =>
    new Promise((res, rej) => {
      const id = String(++reqId)
      const timer = setTimeout(() => rej(new Error(`timeout: ${method}`)), 5000)
      ws.once("message", (data) => {
        clearTimeout(timer)
        const frame = JSON.parse(data.toString())
        if (frame.id !== id) return
        if (frame.ok) res(frame.payload)
        else rej(new Error(frame.error))
      })
      ws.send(JSON.stringify({ type: "req", id, method, params }))
    })
}

/** 期望失败：返回错误消息（无失败则返回 null 并计一次失败） */
async function expectError(promise, needle, label) {
  try {
    await promise
    failed++
    console.log(`  ❌ ${label} — 期望报错含 "${needle}"，却成功了`)
  } catch (e) {
    assert(String(e.message).includes(needle), `${label} → "${e.message}"`)
  }
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

async function main() {
  console.log(`═══ E2E 真实链路: file.upload.* @ ${WS_URL} ═══\n`)

  // 目标目录：服务端所在机器的临时目录（真实落盘用）
  const targetDir = await mkdtemp(join(tmpdir(), "mab-reallink-"))
  console.log(`  目标目录: ${targetDir}\n`)

  try {
    // 1. 认证（同一连接 login → token 原地刷新）
    console.log("── auth ──")
    const ws = await connect(WS_URL)
    const call = makeCall(ws)
    const login = await call("auth.login", { password: PASSWORD })
    assert(typeof login?.token === "string" && login.token.length > 0, "auth.login 返回 token")

    // 2. begin
    console.log("\n── file.upload.begin ──")
    const content = "真实链路测试 reallink: hello world 上传端到端验证！"
    const bytes = Buffer.byteLength(content, "utf8")
    const begin = await call("file.upload.begin", { dir: targetDir, name: "reallink.txt", size: bytes })
    assert(typeof begin.uploadId === "string" && begin.uploadId.length > 8, `begin 返回 uploadId (${begin.uploadId.slice(0, 8)}…)`)
    assert(Number.isInteger(begin.chunkSize) && begin.chunkSize % 4 === 0, `begin 返回 4 的倍数 chunkSize (${begin.chunkSize})`)

    // 3. 服务端真实创建了 .part 临时文件…
    const midEntries = await readdir(targetDir)
    const partName = midEntries.find((n) => n.endsWith(".part"))
    assert(!!partName, `服务端已创建 .part 临时文件 (${partName})`)
    // …但 file.list 不外露
    const listedMid = await call("file.list", { path: targetDir })
    assert(!listedMid.some((f) => f.name.endsWith(".part")), "上传中 file.list 不外露 .part 半成品")

    // 4. 顺序双 chunk（base64 4 字符对齐切分）
    console.log("\n── file.upload.chunk ──")
    const b64 = Buffer.from(content, "utf8").toString("base64")
    const cut = Math.max(4, Math.floor(b64.length / 8) * 4)
    const r1 = await call("file.upload.chunk", { uploadId: begin.uploadId, index: 0, data: b64.slice(0, cut) })
    assert(r1.received === Buffer.from(b64.slice(0, cut), "base64").length && r1.total === bytes,
      `chunk#0 → received=${r1.received}/${r1.total}`)
    const r2 = await call("file.upload.chunk", { uploadId: begin.uploadId, index: 1, data: b64.slice(cut) })
    assert(r2.received === bytes, `chunk#1 → received=${r2.received}（满额）`)

    // 5. 乱序 index 被拒
    await expectError(
      call("file.upload.chunk", { uploadId: begin.uploadId, index: 99, data: "AAAA" }),
      "out-of-order",
      "乱序 chunk 拒绝",
    )

    // 6. finish → 真实落盘逐字节比对
    console.log("\n── file.upload.finish ──")
    const fin = await call("file.upload.finish", { uploadId: begin.uploadId })
    assert(fin.path === join(targetDir, "reallink.txt"), `finish 返回 path (${fin.path})`)
    assert(fin.size === bytes, `finish 返回 size (${fin.size})`)
    const onDisk = await readFile(fin.path, "utf8")
    assert(onDisk === content, "磁盘内容与上传内容逐字节一致")
    const partAfter = (await readdir(targetDir)).filter((n) => n.endsWith(".part"))
    assert(partAfter.length === 0, "finish 后 .part 临时文件已清理")

    // 7. EEXIST / overwrite
    console.log("\n── 撞名 ──")
    await expectError(
      call("file.upload.begin", { dir: targetDir, name: "reallink.txt", size: 4 }),
      "EEXIST",
      "同名未 overwrite 拒绝",
    )
    const ow = await call("file.upload.begin", { dir: targetDir, name: "reallink.txt", size: 4, overwrite: true })
    assert(typeof ow.uploadId === "string", "overwrite:true 放行")
    const owAbort = await call("file.upload.abort", { uploadId: ow.uploadId })
    assert(owAbort.ok === true, "abort 成功")
    const onDisk2 = await readFile(join(targetDir, "reallink.txt"), "utf8")
    assert(onDisk2 === content, "被放弃的 overwrite 未破坏已落盘文件")

    // 8. 超限（服务端真实 env，默认 5MB）
    console.log("\n── 大小限制 ──")
    await expectError(
      call("file.upload.begin", { dir: targetDir, name: "huge.bin", size: 99_999_999 }),
      "limit",
      "超限拒绝（错误含真实 limit）",
    )

    // 9. abort 幂等（未知 id）
    const abortUnknown = await call("file.upload.abort", { uploadId: "no-such-id" })
    assert(abortUnknown.ok === true, "abort 未知 uploadId 幂等 ok")

    // 10. 非法文件名（路径穿越）
    await expectError(
      call("file.upload.begin", { dir: targetDir, name: "../escape.txt", size: 1 }),
      "invalid file name",
      "路径穿越文件名拒绝",
    )

    // 11. 未认证连接被拒
    console.log("\n── 认证 ──")
    const anon = await connect(`${WS_URL}`) // 无 token
    const anonCall = makeCall(anon)
    await expectError(
      anonCall("file.upload.begin", { dir: targetDir, name: "x.txt", size: 1 }),
      "unauthorized",
      "无 token 连接拒绝",
    )
    anon.close()

    ws.close()
    console.log(`\n═══════════════════════════════════`)
    console.log(`结果: ${passed} 通过, ${failed} 失败`)
    process.exitCode = failed > 0 ? 1 : 0
  } finally {
    clearTimeout(bailout)
    await rm(targetDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error(`\n❌ 测试异常:`, err.message)
  clearTimeout(bailout)
  process.exit(1)
})
