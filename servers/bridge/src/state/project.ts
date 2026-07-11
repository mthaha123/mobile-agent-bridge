import fs from "fs"
import { getBackend } from "../adapters/OpenCodeAdapter.js"
import { broadcastToAll } from "../server/ws.js"

let activeDirectory: string | null = null
let currentProject: { name?: string } | null = null
let sseAbort: AbortController | null = null
let sseLoop: Promise<void> | null = null
let isSwitching = false

async function startSSE(signal: AbortSignal): Promise<void> {
  const backend = getBackend()
  let htmlResponseCount = 0
  while (true) {
    if (signal.aborted) break
    try {
      const result = await backend.sdk!.v2.event.subscribe({
        signal,
        sseMaxRetryAttempts: 0,
      } as any)
      for await (const event of result.stream) {
        if (signal.aborted) break
        const ev = event as any
        const eventType: string = ev.type || "unknown"
        const eventData: unknown = ev.data || ev
        broadcastToAll({
          type: "notify",
          method: eventType,
          payload: eventData,
        })
      }
    } catch (err: any) {
      if (signal.aborted) break
      const isHtmlResponse = err.message?.includes("text/html") || err.message?.includes("HTML")
      if (isHtmlResponse) {
        htmlResponseCount++
        if (htmlResponseCount >= 2) {
          console.warn("[SSE] OpenCode 服务端不支持 /api/event（返回 HTML），停止 SSE 重试")
          break
        }
      }
      console.error("[SSE] 错误:", err.message)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
}

export async function switchProject(directory: string): Promise<{ directory: string; project?: { name?: string } }> {
  if (isSwitching) throw new Error("already switching")

  try {
    fs.accessSync(directory, fs.constants.F_OK | fs.constants.R_OK)
  } catch {
    throw new Error(`directory not found or not readable: ${directory}`)
  }

  isSwitching = true
  await Promise.resolve() // yield 点：让并发调用能在 isSwitching=true 时命中锁

  try {
    sseAbort?.abort()
    sseAbort = null
    sseLoop = null

    const backend = getBackend()
    backend.createClient(directory)
    activeDirectory = directory

    const abort = new AbortController()
    sseAbort = abort
    sseLoop = startSSE(abort.signal)

    const name = directory.split(/[/\\]/).filter(Boolean).pop() || "unknown"
    currentProject = { name }

    isSwitching = false

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
    throw err
  }
}

export function getCurrentProject(): { directory: string | null; project: { name?: string } | null } {
  return { directory: activeDirectory, project: currentProject }
}
