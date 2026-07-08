#!/usr/bin/env node
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import http from "http"
import { URL } from "url"

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096"
const BASE = `${OPENCODE_URL.replace(/\/+$/, "")}/api`

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

// Node http fetch
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
        res.on("end", () => resolve(new Response(Buffer.concat(chunks).toString(), {
          status: res.statusCode || 200, statusText: res.statusMessage || "",
          headers: { "content-type": res.headers["content-type"] || "" },
        })))
      }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")) }).end(bodyStr || undefined)
    })
  }
}

// Wait for server
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

// Test helpers
let id = null

async function doCall(fn) {
  try {
    const r = await fn()
    return r
  } catch (err) {
    return { _exception: err.message }
  }
}

function t(label, fn) {
  tests.push(async () => {
    const r = await doCall(fn)
    if (r === SKIP) return
    if (r?._exception) { fail(label, `Exception: ${r._exception}`); return }
    if (r?.error) {
      const msg = typeof r.error === "string" ? r.error : r.error?.message || JSON.stringify(r.error)
      fail(label, trunc(msg))
      return
    }
    ok(label, `${JSON.stringify(r?.data).length}B`)
  })
}

function x(label, fn) {
  tests.push(async () => {
    const r = await doCall(fn)
    if (r === SKIP) return
    if (r?._exception) { ok(label, `exception: ${r._exception}`); return }
    if (r?.error) { ok(label, trunc(r.error)); return }
    fail(label, `expected error but got data: ${trunc(r?.data)}`)
  })
}

function requiresId() {
  if (!id) { return SKIP }
}

// ══════════════════════════════════

const tests = []

console.log("=".repeat(60))
console.log("  SDK v2 → OpenCode server interface validation")
console.log(`  target: ${BASE}`)
console.log("=".repeat(60) + "\n")

await waitForServer()

const fetch = createNodeFetch()
const sdk = createOpencodeClient({ baseUrl: BASE, fetch })

// ─ session CRUD ─
t("session.create", () => sdk.session.create({ title: "sdk-validation-test" }))

t("session.list", async () => {
  const r = await sdk.session.list({})
  if (r.error) return r
  const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? [])
  if (!list.length) return { error: "empty list" }
  const keys = Object.keys(list[0]).join(",")
  // try title, then fallback to first
  const found = list.find(s => s.title === "sdk-validation-test" || s.name === "sdk-validation-test")
  id = found ? found.id : list[0].id
  return { data: `${list.length} sessions, id=${id}, keys=${keys}` }
})

t("session.get", () => { if (!id) return SKIP; return sdk.session.get({ sessionID: id }) })
t("session.messages", () => { if (!id) return SKIP; return sdk.session.messages({ sessionID: id }) })
t("session.status", () => sdk.session.status({}))

x("session.update (rename)", () => { if (!id) return SKIP; return sdk.session.update({ sessionID: id, title: "renamed" }) })
x("session.delete", () => { if (!id) return SKIP; return sdk.session.delete({ sessionID: id }) })

// ─ message ─
t("session.prompt", () => {
  if (!id) return SKIP
  return sdk.session.prompt({ sessionID: id, parts: [{ type: "text", text: "Hello" }] })
})

t("session.abort", () => { if (!id) return SKIP; return sdk.session.abort({ sessionID: id }) })

// ─ advanced ─
for (const method of ["todo", "diff", "shell", "command", "fork", "unrevert"]) {
  t(`session.${method}`, () => {
    if (!id) return SKIP
    const body = method === "shell" ? { command: "echo hi" } : method === "command" ? { command: "help" } : {}
    return sdk.session[method]({ sessionID: id, ...body })
  })
}

x("session.revert", () => { if (!id) return SKIP; return sdk.session.revert({ sessionID: id }) })

// ─ config / providers / global ─
for (const [label, method] of [
  ["config.get", () => sdk.config.get({})],
  ["config.providers", () => sdk.config.providers({})],
  ["app.agents", () => sdk.app.agents({})],
  ["provider.list", () => sdk.provider.list({})],
  ["vcs.get", () => sdk.vcs.get({})],
  ["command.list", () => sdk.command.list({})],
  ["global.health", () => sdk.global.health({})],
]) {
  t(label, method)
}

// ─ permission / question ─
x("permission.reply", () => sdk.permission.reply({ requestID: "nonexistent", reply: "once" }))
x("question.reply", () => sdk.question.reply({ requestID: "nonexistent", answers: [["yes"]] }))
x("question.reject", () => sdk.question.reject({ requestID: "nonexistent" }))

// ═══════ execute ═══════
for (const t of tests) await t()

console.log(`\n${"=".repeat(60)}`)
console.log(`  ${failed > 0 ? red(`${failed} FAIL`) : green("ALL PASS")}  |  ${green(`${passed} passed`)} | ${red(`${failed} failed`)} | ${yellow(`${skipped} skipped`)}`)
console.log(`${"=".repeat(60)}`)
process.exit(failed > 0 ? 1 : 0)
