/**
 * sessionTitles — session 标题映射（serve 侧自动命名）
 *
 * opencode server 无法通过 HTTP API 更新 session 标题（v1 PATCH 挂起、v2 不存在）。
 * 本模块在 bridge 侧维护 sessionId → 友好标题 的映射：
 *   - 首次收到用户消息时，根据消息内容生成标题（截取前 N 字符）
 *   - 持久化到 .data/session-titles.json，重启不丢失
 *   - session.list / session.get 返回时合并映射，覆盖 "New session - <时间戳>" 默认名
 */
import fs from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "..", "..", ".data")
const FILE = resolve(DATA_DIR, "session-titles.json")

const TITLE_MAX_LEN = 30
const DEFAULT_TITLE_RE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// sessionId → title
const titles = new Map<string, string>()

function load(): void {
  try {
    if (!fs.existsSync(FILE)) return
    const raw = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Record<string, string>
    for (const [k, v] of Object.entries(raw)) {
      if (k && v) titles.set(k, v)
    }
  } catch (e) {
    console.warn("[sessionTitles] 加载失败:", (e as Error).message)
  }
}

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(titles), null, 2), "utf-8")
  } catch (e) {
    console.warn("[sessionTitles] 保存失败:", (e as Error).message)
  }
}

/** 从消息文本生成标题 */
function deriveTitle(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (!cleaned) return undefined
  return cleaned.length > TITLE_MAX_LEN ? cleaned.slice(0, TITLE_MAX_LEN - 3) + "..." : cleaned
}

/** 首次收到用户消息时记录并生成标题 */
export function recordUserMessage(sessionId: string, messageText: string): void {
  if (!sessionId || !messageText) return
  if (titles.has(sessionId)) return // 已命名，跳过
  const title = deriveTitle(messageText)
  if (!title) return
  titles.set(sessionId, title)
  persist()
}

/** 显式设置标题（供未来手动重命名） */
export function setTitle(sessionId: string, title: string): void {
  if (!sessionId || !title) return
  titles.set(sessionId, title)
  persist()
}

/** 获取映射标题（无则 undefined） */
export function getTitle(sessionId: string): string | undefined {
  return titles.get(sessionId)
}

/** 给单个 session 应用标题（覆盖默认名） */
export function applyTitle(session: Record<string, unknown>): Record<string, unknown> {
  const id = (session.id || session.sessionID || "") as string
  if (!id) return session
  const mapped = titles.get(id)
  if (!mapped) return session
  const name = (session.title || session.name) as string | undefined
  // 仅覆盖默认标题；显式命名保留
  if (name && !DEFAULT_TITLE_RE.test(name)) return session
  return { ...session, title: mapped, name: mapped }
}

/** 给 session 数组应用标题映射 */
export function applyTitles(sessions: any[]): any[] {
  if (!Array.isArray(sessions)) return sessions
  return sessions.map((s) => (s && typeof s === "object" ? applyTitle(s) : s))
}

load()
