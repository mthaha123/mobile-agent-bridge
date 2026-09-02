import path from "path"
import fs from "fs"
import http from "http"
import { getBackend } from "../adapters/OpenCodeAdapter.js"
import { broadcastToAll } from "../server/ws.js"

let activeDirectory: string | null = null
let currentProject: { name?: string } | null = null
let sseAbort: AbortController | null = null
let sseLoop: Promise<void> | null = null
let isSwitching = false

/** 调用 serve 的 instance.dispose API，强制重新加载项目的 agents/skills/config */
function disposeInstance(directory: string, baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl)
      const body = JSON.stringify({ directory })
      const req = http.request({
        hostname: url.hostname,
        port: parseInt(url.port || "80", 10),
        path: "/instance/dispose",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 2000,
      }, (res) => {
        let b = ""
        res.on("data", (c) => { b += c })
        res.on("end", () => { resolve(b.trim() === "true") })
      })
      req.on("error", () => resolve(false))
      req.on("timeout", () => { req.destroy(); resolve(false) })
      req.end(body)
    } catch { resolve(false) }
  })
}

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
        // 兼容四种格式:
        //   V2Event:       { id, type, data: {...} }
        //   GlobalEvent:   { payload: { type, properties: {...} } }
        //   V1Event:       { type, properties: {...} }
        //   SyncEvent 包装: { payload: { type: "sync", syncEvent: { type, data, ... } } }（如 message.part.updated）
        const src = ev.payload || ev
        let eventType: string = src.type || "unknown"
        let eventData: unknown = src.properties || src.data || src
        // 解包 v1 SyncEvent：真实类型在 syncEvent.type（如 message.part.updated），数据在 syncEvent.data
        if (src.type === "sync" && src.syncEvent && typeof src.syncEvent.type === "string") {
          eventType = src.syncEvent.type
          eventData = src.syncEvent.data ?? src.syncEvent
        }
        if (src.id !== undefined && typeof eventData === "object" && eventData !== null) {
          ;(eventData as Record<string, unknown>).eventId = src.id
        }
        console.log("[SSE] 事件:", eventType, JSON.stringify(eventData).slice(0, 500))
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
  if (!directory || typeof directory !== 'string') throw new Error("directory is required")

  const resolvedDir = path.resolve(directory)

  try {
    fs.accessSync(resolvedDir, fs.constants.F_OK | fs.constants.R_OK)
  } catch {
    throw new Error(`directory not found or not readable: ${resolvedDir}`)
  }

  isSwitching = true
  await Promise.resolve() // yield 点：让并发调用能在 isSwitching=true 时命中锁

  try {
    sseAbort?.abort()
    sseAbort = null
    sseLoop = null

    // 切换前 dispose 项目实例，强制 serve 重新加载 agents/skills/config
    // 静默失败：dispose 不可用时不影响切换流程
    try {
      const backend = getBackend()
      const baseUrl = backend?.getBaseUrl?.()
      if (baseUrl) await disposeInstance(resolvedDir, baseUrl)
    } catch { /* dispose 非关键路径 */ }

    const backend = getBackend()

    backend.createClient(resolvedDir)
    activeDirectory = resolvedDir

    const abort = new AbortController()
    sseAbort = abort
    sseLoop = startSSE(abort.signal)

    const name = resolvedDir.split(/[/\\]/).filter(Boolean).pop() || "unknown"
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
