#!/usr/bin/env node
/**
 * diag-api-key.mjs — OPENCODE_API_KEY 一键诊断
 *
 * 背景：serve 模式只认环境变量 OPENCODE_API_KEY（不读 auth.json），而长驻父进程
 * （agent harness / 旧终端）常携带过期或已超额的同名 env。若解析顺序把坏 env 放在
 * 前面，就会把坏 key 注入 serve/bridge，表现为模型调用 429（月份额度用尽）或
 * 401（缺 key），却极难定位。
 *
 * 本项目所有脚本统一按 `注册表(HKCU) → auth.json → env` 顺序解析 key。
 * 本工具把三个来源全部列出、逐个实测，并给出解析结果与修复建议，
 * 让"key 问题"下次一条命令定位，不用再翻半天。
 *
 * 用法:
 *   node scripts/diag-api-key.mjs
 *   node scripts/diag-api-key.mjs --model deepseek-v4-flash   # 换测试模型
 *
 * 退出码: 0 = 解析出的 key 可用；1 = 不可用（需按提示修复）
 */
import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import https from "node:https"

const ENV_VAR = "OPENCODE_API_KEY"
const PROVIDERS = ["opencode-go", "opencode"]
const API_HOST = "opencode.ai"
const API_PATH = "/zen/go/v1/chat/completions"

const modelArgIdx = process.argv.indexOf("--model")
const TEST_MODEL = modelArgIdx >= 0 ? process.argv[modelArgIdx + 1] : (process.env.DIAG_MODEL || "mimo-v2.5")

function mask(k) {
  return k ? `${k.slice(0, 12)}…${k.slice(-4)}` : "(空)"
}

function readRegistry(envVar) {
  try {
    const out = execSync(`reg query "HKCU\\Environment" /v ${envVar}`, {
      encoding: "utf8", timeout: 5000, windowsHide: true,
    })
    const m = out.match(new RegExp(`${envVar}\\s+REG_\\w+\\s+(\\S+)`))
    return m ? m[1] : ""
  } catch {
    return ""
  }
}

function readAuthJson(providers) {
  try {
    const p = join(homedir(), ".local", "share", "opencode", "auth.json")
    if (!existsSync(p)) return ""
    const auth = JSON.parse(readFileSync(p, "utf8"))
    for (const id of providers) {
      const k = auth[id]?.key
      if (typeof k === "string" && k) return k
    }
  } catch {}
  return ""
}

/** 实测一个 key：发一次最小 chat completion，区分 200 / 429 / 401 */
function testKey(key) {
  return new Promise((resolve) => {
    if (!key) return resolve({ ok: false, detail: "(空)" })
    const body = JSON.stringify({ model: TEST_MODEL, messages: [{ role: "user", content: "ping" }], max_tokens: 1 })
    const req = https.request({
      hostname: API_HOST, port: 443, path: API_PATH, method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
        "x-opencode-session": `ses_diag_${Date.now()}`,
        "content-length": Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      let b = ""
      res.on("data", (c) => { b += c })
      res.on("end", () => {
        let type = ""
        try { type = JSON.parse(b)?.error?.type || "" } catch {}
        if (res.statusCode === 200) resolve({ ok: true, detail: "200 可用 ✅" })
        else resolve({ ok: false, detail: `${res.statusCode} ${type || b.slice(0, 60)}` })
      })
    })
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, detail: "超时（网络？）" }) })
    req.on("error", (e) => resolve({ ok: false, detail: "网络错误 " + e.message }))
    req.write(body)
    req.end()
  })
}

const C = { red: (t) => `\x1b[31m${t}\x1b[0m`, green: (t) => `\x1b[32m${t}\x1b[0m`, yellow: (t) => `\x1b[33m${t}\x1b[0m`, dim: (t) => `\x1b[2m${t}\x1b[0m` }

const envKey = process.env[ENV_VAR] || ""
const regKey = readRegistry(ENV_VAR)
const authKey = readAuthJson(PROVIDERS)

console.log("")
console.log("╔══════════════════════════════════════════════════════════════════════╗")
console.log("║              OPENCODE_API_KEY 诊断（serve 模式专用）                 ║")
console.log("╚══════════════════════════════════════════════════════════════════════╝")
console.log(`测试模型: ${TEST_MODEL}   端点: https://${API_HOST}${API_PATH}`)
console.log("")
console.log("  来源                                 key                    实测")
console.log("  ─────────────────────────────────────────────────────────────────────")

const sources = [
  { label: "注册表 HKCU\\Environment (setx)", key: regKey, src: "registry" },
  { label: `auth.json (${PROVIDERS.join("/")})`, key: authKey, src: "authjson" },
  { label: "process.env.OPENCODE_API_KEY", key: envKey, src: "env" },
]
const results = {}
for (const s of sources) {
  const r = await testKey(s.key)
  results[s.src] = { ...s, ...r }
  const mark = r.ok ? C.green("✅") : C.red("❌")
  console.log(`  ${mark} ${s.label.padEnd(36)} ${mask(s.key).padEnd(22)} ${r.detail}`)
}

// 与代码一致的解析顺序：注册表 → auth.json → env
const order = [
  ["registry", "注册表"],
  ["authjson", "auth.json"],
  ["env", "env"],
]
const picked = order.find(([src]) => results[src].key)
const pickedSrc = picked ? picked[0] : null
const resolvedKey = pickedSrc ? results[pickedSrc].key : ""
const resolvedOk = pickedSrc ? results[pickedSrc].ok : false

console.log("")
console.log("─".repeat(70))
console.log(`解析顺序: 注册表 → auth.json → env`)
console.log(`解析结果: ${mask(resolvedKey)}  来源: ${picked ? picked[1] : "(三级皆空)"}  ${resolvedOk ? C.green("可用") : C.red("不可用")}`)
console.log("─".repeat(70))

// 诊断与建议
const problems = []
if (envKey && regKey && envKey !== regKey) {
  problems.push(`env 的 key 与注册表不一致（env=${mask(envKey)} / 注册表=${mask(regKey)}）——长驻父进程污染，已被后面的来源覆盖`)
}
if (envKey && !results.env.ok && (results.registry.ok || results.authjson.ok)) {
  problems.push(`env 里的 key 不可用（${results.env.detail}）——这是最常见的"秘钥问题"根因，已通过注册表/auth.json 规避`)
}
if (!regKey) problems.push(`注册表无 ${ENV_VAR}（setx 未设置或被清）→ 回退 auth.json`)
if (!authKey) problems.push(`auth.json 无 ${PROVIDERS.join("/")} 条目（未 opencode auth login）`)

if (problems.length) {
  console.log("\n诊断:")
  for (const p of problems) console.log(`  • ${p}`)
}

if (!resolvedOk) {
  console.log(`\n${C.red("⚠ 解析出的 key 不可用，serve 会失败。")} 修复建议:`)
  console.log(`  1) 用可用的 key 持久化到注册表:  ${C.yellow('setx ' + ENV_VAR + ' "<可用的key>"')}`)
  console.log(`  2) 或确保 opencode 已登录（写 auth.json）:  ${C.yellow("opencode auth login")}`)
  console.log(`  3) 然后重启服务:  ${C.yellow("node scripts/start-all.mjs --stop")} 再启动 start-all`)
} else {
  console.log(`\n${C.green("✓ 解析出的 key 可用。若服务仍报 429/401，说明服务是用旧 key 启动的——重启即可:")}`)
  console.log(`  ${C.yellow("node scripts/start-all.mjs --stop")}  然后重新启动 start-all`)
}

console.log("")
process.exit(resolvedOk ? 0 : 1)
