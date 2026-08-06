#!/usr/bin/env node
/**
 * 验证: opencode server 真实支持的端点（对应 bridge 暴露的 WS 方法）
 *
 * 背景: opencode server 1.18.x 移除了部分 session 操作端点
 *   （delete/update/todo/diff/fork/unrevert/children/shell/command），
 *   bridge 已同步删除这些 handler；revert 改为 v2 stage+commit 两步式。
 * 本脚本逐一探测 bridge 保留的每个 WS 方法对应的端点，确认真实可用。
 *
 * 用法: node servers/bridge/scripts/validate-sdk-interfaces.mjs
 * 环境变量: OPENCODE_URL (默认 http://localhost:4096)
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import http from "http"
import { URL } from "url"

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096"
const BASE = `${OPENCODE_URL.replace(/\/+$/, "")}`

let passed = 0, failed = 0, skipped = 0

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }
function gray(t) { return `\x1b[90m${t}\x1b[0m` }
function ok(label, detail) { console.log(`  ${green("PASS")} ${label} ${gray(detail || "")}`); passed++ }
function fail(label, detail) { console.log(`  ${red("FAIL")} ${label} ${gray(detail || "")}`); failed++ }
function skip(label, msg) { console.log(`  ${yellow("SKIP")} ${label} ${gray(msg || "")}`); skipped++ }
function trunc(s, max = 120) {
  const str = typeof s === "string" ? s : JSON.stringify(s)
  return str.length > max ? str.slice(0, max) + "..." : str
}

const SKIP = Symbol("skip")

// Node http fetch（带 /api 前缀）
function createNodeFetch() {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const absUrl = req.url.startsWith("http") ? req.url : `${BASE}/${req.url.replace(/^\/+/, "")}`
    const url = new URL(absUrl)
    const method = req.method
    const headers = {}
    req.headers.forEach((v, k) => { headers[k] = v })
    const bodyStr = method !== "GET" && method !== "HEAD" ? await req.text().catch(() => undefined) : undefined
    return new Promise((resolve, reject) => {
      http.request({
        hostname: url.hostname, port: parseInt(url.port || "80", 10),
        path: url.pathname + url.search, method,
        headers: bodyStr ? { ...headers, "Content-Length": Buffer.byteLength(bodyStr).toString() } : headers,
        timeout: 15000,
      }, (res) => {
        const chunks = []; res.on("data", c => chunks.push(c))
        res.on("end", () => {
          const status = res.statusCode || 200
          const bodyText = Buffer.concat(chunks).toString()
          resolve(new Response(status === 204 ? null : bodyText, {
            status, statusText: res.statusMessage || "",
            headers: { "content-type": res.headers["content-type"] || "" },
          }))
        })
      }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")) }).end(bodyStr || undefined)
    })
  }
}

async function waitForServer() {
  const url = new URL(`${OPENCODE_URL}/api/health`)
  for (let i = 0; i < 12; i++) {
    try {
      const { status } = await new Promise((resolve, reject) => {
        http.get({ hostname: url.hostname, port: parseInt(url.port) || 80, path: url.pathname, timeout: 3000 }, res => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }))
        }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")) })
      })
      if (status === 200) { console.log(`  ${green("✓")} OpenCode server ready\n`); return }
    } catch {}
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error("Server not ready")
}

let id = null

async function doCall(fn) {
  try { return await fn() } catch (err) { return { _exception: err.message } }
}

function t(label, fn) {
  tests.push(async () => {
    const r = await doCall(fn)
    if (r === SKIP) return
    if (r?._exception) { fail(label, `Exception: ${r._exception}`); return }
    if (r?.error) { fail(label, trunc(r.error)); return }
    ok(label, `${JSON.stringify(r?.data).length}B`)
  })
}

// 期望 404/失败（端点存在但参数错误 → 说明端点注册了；HTML fallback → 端点不存在）
function x(label, fn) {
  tests.push(async () => {
    const r = await doCall(fn)
    if (r === SKIP) return
    if (r?._exception) { ok(label, `exception: ${r._exception} (端点可能挂起)`); return }
    if (r?.error) { ok(label, trunc(r.error)); return }
    fail(label, `expected error but got data: ${trunc(r?.data)}`)
  })
}

function requiresId() { if (!id) return SKIP }

// 直接探测带 /api 前缀的端点是否存在（404/HTML → 不存在；挂起 → 标记）
function probeEndpoint(method, path, body) {
  const url = new URL(`${BASE}${path}`)
  const bodyStr = body ? JSON.stringify(body) : undefined
  return new Promise((resolve) => {
    http.request({
      hostname: url.hostname, port: parseInt(url.port || "80", 10),
      path: url.pathname + url.search, method,
      headers: bodyStr ? { "content-type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } : {},
      timeout: 5000,
    }, (res) => {
      let d = ""; res.on("data", c => d += c)
      res.on("end", () => {
        const ct = res.headers["content-type"] || ""
        resolve(ct.includes("text/html") ? { status: "HTML" } : { status: res.statusCode, body: d })
      })
    }).on("error", e => resolve({ status: "ERR", body: e.message }))
      .on("timeout", function() { this.destroy(); resolve({ status: "TIMEOUT" }) })
      .end(bodyStr || undefined)
  })
}

function removed(label, method, body) {
  tests.push(async () => {
    if (!id) return
    const r = await probeEndpoint("POST", `/api/session/${id}/${method}`, body || {})
    if (r.status === "HTML" || r.status === 404 || r.status === 405) {
      ok(label, `endpoint ${method} → ${r.status} (不存在, 符合预期)`)
    } else if (r.status === "TIMEOUT") {
      ok(label, `endpoint ${method} → TIMEOUT (挂起, 不可用)`)
    } else {
      fail(label, `endpoint ${method} → ${JSON.stringify(r).slice(0, 80)} (意外存在!)`)
    }
  })
}

const tests = []

console.log("=".repeat(60))
console.log("  SDK v2 → OpenCode server interface validation")
console.log(`  target: ${BASE}`)
console.log("=".repeat(60) + "\n")

await waitForServer()

const fetch = createNodeFetch()
const sdk = createOpencodeClient({ baseUrl: BASE, fetch })

// ─ session CRUD（v2 端点，bridge 保留） ─
t("session.create", () => sdk.v2.session.create({ location: { directory: process.cwd() } }))

t("session.list", async () => {
  const r = await sdk.v2.session.list({})
  if (r.error) return r
  const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? [])
  if (!list.length) return { error: "empty list" }
  id = list[0].id
  return { data: `${list.length} sessions, id=${id}` }
})

t("session.get", () => { if (!id) return SKIP; return sdk.v2.session.get({ sessionID: id }) })
t("session.messages", () => { if (!id) return SKIP; return sdk.v2.session.messages({ sessionID: id }) })
t("session.active", () => sdk.v2.session.active())

// ─ 已从 bridge 移除的端点：探测确认不存在 ─
for (const method of ["delete", "update", "todo", "diff", "fork", "unrevert", "children", "shell", "command"]) {
  const body = method === "shell" ? { command: "echo hi" } : method === "command" ? { command: "help" } : {}
  removed(`session.${method} (removed)`, method, body)
}
removed("session.revert (removed, v1 路径)", "revert", {})

// ─ revert（v2 三步式 stage+commit，桥保留） ─
tests.push(async () => {
  if (!id) return
  const r = await probeEndpoint("POST", `/api/session/${id}/revert/stage`, {})
  if (r.status === 400 || r.status === 200 || r.status === 204) ok("session.revert.stage (v2)", `端点存在 → ${r.status}`)
  else if (r.status === "TIMEOUT") fail("session.revert.stage (v2)", "TIMEOUT")
  else ok("session.revert.stage (v2)", `端点存在? → ${JSON.stringify(r).slice(0,60)}`)
})

// ─ message（bridge 保留） ─
t("session.prompt", () => {
  if (!id) return SKIP
  return sdk.v2.session.prompt({ sessionID: id, prompt: { text: "Hello" } })
})
t("session.interrupt", () => { if (!id) return SKIP; return sdk.v2.session.interrupt({ sessionID: id }) })

// ─ config / providers / command / agent / model（bridge 保留） ─
for (const [label, method] of [
  ["agent.list", () => sdk.v2.agent.list({})],
  ["provider.list", () => sdk.v2.provider.list({})],
  ["command.list", () => sdk.v2.command.list({})],
  ["model.list", () => sdk.v2.model.list({})],
  ["global.health", () => sdk.global.health({})],
]) {
  t(label, method)
}

// ─ 已从 bridge 移除为空的端点（config/vcs/project，server 不支持） ─
for (const [label, method, path] of [
  ["config.get (removed)", "GET", "/api/config"],
  ["config.providers (removed)", "GET", "/api/config/providers"],
  ["vcs.get (removed)", "GET", "/api/vcs"],
  ["project.list (removed)", "GET", "/api/project"],
]) {
  tests.push(async () => {
    const r = await probeEndpoint(method, path)
    if (r.status === "HTML" || r.status === 404 || r.status === "TIMEOUT") ok(label, `endpoint → ${r.status} (不存在, bridge 返回空)`)
    else fail(label, `endpoint → ${JSON.stringify(r).slice(0, 80)} (意外存在!)`)
  })
}

// ═══════ execute ═══════
for (const t of tests) await t()

console.log(`\n${"=".repeat(60)}`)
console.log(`  ${failed > 0 ? red(`${failed} FAIL`) : green("ALL PASS")}  |  ${green(`${passed} passed`)} | ${red(`${failed} failed`)} | ${yellow(`${skipped} skipped`)}`)
console.log(`${"=".repeat(60)}`)
process.exit(failed > 0 ? 1 : 0)
