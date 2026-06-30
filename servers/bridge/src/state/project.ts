import { getBackend } from "../adapters/OpenCodeAdapter.js"
import { broadcastToAll } from "../server/ws.js"

let activeDirectory: string | null = null
let currentProject: { name?: string } | null = null
let sseAbort: AbortController | null = null
let sseLoop: Promise<void> | null = null
let isSwitching = false

async function startSSE(signal: AbortSignal): Promise<void> {
  const backend = getBackend()
  while (true) {
    if (signal.aborted) break
    try {
      // 注意：sdk.global.event() 不支持 sseMaxRetryAttempts 参数时的类型约束
      // 以 AbortSignal 作为 signal.name 传递
      const result = await backend.sdk!.global.event({
        signal,
        sseMaxRetryAttempts: 0,
      } as any)
      for await (const event of result.stream) {
        if (signal.aborted) break
        // GlobalEvent: { directory, project?, workspace?, payload: { id, type, properties } }
        const ev = event as any
        const eventType: string = ev.payload?.type || "unknown"
        const eventData: unknown = ev.payload?.properties || ev
        broadcastToAll({
          type: "notify",
          method: eventType,
          payload: eventData,
        })
      }
    } catch (err: any) {
      if (signal.aborted) break
      console.error("[SSE] 错误:", err.message)
    }
    // 断线后等待重试（指数退避已在 SDK 内部处理）
    await new Promise(r => setTimeout(r, 3000))
  }
}

export async function setupProject(directory: string): Promise<{ directory: string; project?: { name?: string } } | { error: string }> {
  if (isSwitching) return { error: "already switching" }
  isSwitching = true

  try {
    // 清理旧 SSE
    sseAbort?.abort()
    sseAbort = null
    sseLoop = null

    // 重建 SDK client（绑定新目录）
    const backend = getBackend()
    backend.createClient(directory)
    activeDirectory = directory

    // 启动新 SSE
    const abort = new AbortController()
    sseAbort = abort
    sseLoop = startSSE(abort.signal)

    // 读取项目元信息
    currentProject = { name: directory.split("/").pop() || directory.split("\\").pop() || "unknown" }

    isSwitching = false

    // 广播 project.changed
    setTimeout(() => {
      broadcastToAll({
        type: "notify",
        method: "project.changed",
        payload: { directory: activeDirectory, project: currentProject },
      })
    }, 0)

    return { directory: activeDirectory, project: currentProject }
  } catch (err: any) {
    isSwitching = false
    return { error: err.message || "setup failed" }
  }
}

export function getCurrentProject(): { directory: string | null; project: { name?: string } | null } {
  return { directory: activeDirectory, project: currentProject }
}
