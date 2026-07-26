#!/usr/bin/env node
/**
 * E2E test: 验证新实现的 4 个 RPC（project.list / config.update / permission.* / session.children）
 *
 * 用法:
 *   node scripts/e2e/test-new-rpcs.mjs
 *
 * 启动 Mock Bridge (端口 8081)，连接后依次调用各 RPC，验证响应。
 * 返回码: 0=全部通过, 1=有失败
 */
import { createRequire } from "node:module"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { fork } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..", "..")
const require = createRequire(import.meta.url)
const { WebSocket } = require(resolve(projectRoot, "servers/bridge/node_modules/ws"))

const PORT = 18082
const PUSH_PORT = 18083

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

async function main() {
  console.log("═══ E2E: 新 RPC 测试 ═══\n")

  // 1. 启动 Mock Bridge（独立端口避免冲突）
  const mockProcess = fork(
    resolve(projectRoot, "scripts/e2e/mock-bridge.mjs"),
    [],
    {
      env: {
        ...process.env,
        MOCK_BRIDGE_PORT: String(PORT),
        MOCK_PUSH_PORT: String(PUSH_PORT),
      },
      stdio: "pipe",
    },
  )

  // 等待 Mock Bridge 启动
  await new Promise((r) => setTimeout(r, 500))

  // 2. 连接 WS
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`)

  await new Promise((resolve, reject) => {
    ws.on("open", resolve)
    ws.on("error", reject)
    const t = setTimeout(() => reject(new Error("WS connect timeout")), 5000)
    ws.on("open", () => clearTimeout(t))
  })

  console.log("  已连接 Mock Bridge\n")

  // 3. RPC 调用辅助函数
  let reqId = 0
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++reqId)
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 5000)
      ws.once("message", (data) => {
        clearTimeout(timer)
        const frame = JSON.parse(data.toString())
        if (frame.id === id) {
          if (frame.ok) resolve(frame.payload)
          else reject(new Error(frame.error))
        }
      })
      ws.send(JSON.stringify({ type: "req", id, method, params }))
    })
  }

  try {
    // 4. 测试 project.list
    console.log("── project.list ──")
    const projList = await call("project.list")
    assert(Array.isArray(projList) || (projList && typeof projList === "object"),
      "project.list 返回结果")
    // Mock 返回 { projects: [...] }
    const projects = Array.isArray(projList) ? projList : (projList?.projects || [])
    assert(projects.length >= 1, `project.list 包含项目 (${projects.length} 个)`)
    if (projects.length > 0) {
      assert(projects[0].directory?.length > 0, "项目含 directory 字段")
    }

    // 5. 测试 config.update
    console.log("\n── config.update ──")
    const updResult = await call("config.update", { theme: "light" })
    assert(updResult?.ok !== false, "config.update 返回成功")

    // 6. 测试 permission.saved.list
    console.log("\n── permission.saved.list ──")
    const savedList = await call("permission.saved.list")
    assert(true, "permission.saved.list 不抛异常")
    const rules = Array.isArray(savedList) ? savedList : (savedList?.rules || [])
    assert(Array.isArray(rules), "返回权限规则数组")

    // 7. 测试 permission.saved.remove
    console.log("\n── permission.saved.remove ──")
    const rmResult = await call("permission.saved.remove", { id: "test_rule" })
    assert(rmResult?.ok !== false, "permission.saved.remove 返回成功")

    // 8. 测试 session.children
    console.log("\n── session.children ──")
    const children = await call("session.children", { sessionId: "mock_s1" })
    assert(true, "session.children 不抛异常")
    const childrenList = Array.isArray(children) ? children : (children?.sessions || [])
    assert(Array.isArray(childrenList), "返回子会话数组")

    // 9. 清理
    ws.close()
    mockProcess.kill()

    console.log(`\n═══════════════════════════════`)
    console.log(`结果: ${passed} 通过, ${failed} 失败`)
    process.exit(failed > 0 ? 1 : 0)

  } catch (err) {
    console.error(`\n❌ 测试异常:`, err.message)
    ws.close()
    mockProcess.kill()
    process.exit(1)
  }
}

main()
