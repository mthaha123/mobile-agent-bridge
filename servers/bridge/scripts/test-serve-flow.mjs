/**
 * 服务端 serve 管理验证脚本
 * 直接通过 WS 连接 bridge，模拟客户端发送 serve.add/serve.list/serve.remove
 * 不依赖 Maestro 或手机 UI
 */
import WebSocket from "ws"

// 默认连【测试桥 19985】，避免误连生产 8080
const BRIDGE_URL = process.env.BRIDGE_URL || "ws://localhost:19985/ws"
const BRIDGE_PASSWORD = "test123"

let ws
let msgId = 0

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `test-${++msgId}`
    const frame = { type: "req", id, method, params }
    console.log(`\n>>> ${method}`, JSON.stringify(params, null, 2))

    const handler = (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === id) {
        ws.off("message", handler)
        console.log(`<<< response`, JSON.stringify(msg, null, 2))
        if (msg.ok) resolve(msg.payload)
        else reject(new Error(msg.error || "RPC failed"))
      }
    }
    ws.on("message", handler)
    ws.send(JSON.stringify(frame))

    setTimeout(() => {
      ws.off("message", handler)
      reject(new Error(`Timeout waiting for ${method} response`))
    }, 10000)
  })
}

function waitForOpen() {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.on("open", resolve)
  })
}

async function main() {
  console.log("=== 服务端 serve 管理验证 ===\n")

  // 1. 连接 bridge
  ws = new WebSocket(BRIDGE_URL)
  await waitForOpen()
  console.log("✅ 已连接 bridge")

  // 2. 认证
  await send("auth.login", { password: BRIDGE_PASSWORD })
  console.log("✅ 认证通过")

  // 3. 获取当前 serve 列表
  const beforeList = await send("serve.list", {})
  console.log(`\n📋 当前 serve 数量: ${beforeList.length}`)

  // 4. 添加一个 serve
  const testDir = "D:\\code\\mobile-agent-bridge"
  console.log(`\n➕ 添加 serve: name=Test E2E, directory=${testDir}`)
  const added = await send("serve.add", { name: "Test E2E", directory: testDir })
  console.log(`\n✅ serve 添加成功:`)
  console.log(`   id: ${added.id}`)
  console.log(`   name: ${added.name}`)
  console.log(`   directory: ${added.directory}`)
  console.log(`   port: ${added.port}`)
  console.log(`   status: ${added.status}`)

  // 5. 再次获取列表，验证新 serve 出现
  const afterList = await send("serve.list", {})
  console.log(`\n📋 添加后 serve 数量: ${afterList.length}`)
  const found = afterList.find(p => p.id === added.id)
  if (found) {
    console.log(`✅ 新 serve 已出现在列表中: name=${found.name}, status=${found.status}`)
  } else {
    console.log(`❌ 新 serve 未出现在列表中!`)
  }

  // 6. 测试重复添加（应报错）
  console.log(`\n🧪 测试重复添加（应报错）...`)
  try {
    await send("serve.add", { name: "Duplicate", directory: testDir })
    console.log(`❌ 应该报错但没有!`)
  } catch (e) {
    console.log(`✅ 正确报错: ${e.message}`)
  }

  // 7. 测试缺少参数（应报错）
  console.log(`\n🧪 测试缺少参数（应报错）...`)
  try {
    await send("serve.add", { name: "", directory: testDir })
    console.log(`❌ 应该报错但没有!`)
  } catch (e) {
    console.log(`✅ 正确报错: ${e.message}`)
  }

  // 8. 删除测试 serve
  console.log(`\n🗑️  删除 serve: ${added.id}`)
  await send("serve.remove", { id: added.id })
  console.log(`✅ serve 删除成功`)

  // 9. 验证删除后列表
  const finalList = await send("serve.list", {})
  console.log(`\n📋 删除后 serve 数量: ${finalList.length}`)
  const stillThere = finalList.find(p => p.id === added.id)
  if (!stillThere) {
    console.log(`✅ serve 已从列表中移除`)
  } else {
    console.log(`❌ serve 仍然存在!`)
  }

  // 10. 关闭连接
  ws.close()
  console.log("\n=== 所有验证通过 ✅ ===")
}

main().catch((e) => {
  console.error("\n❌ 验证失败:", e.message)
  if (ws) ws.close()
  process.exit(1)
})
