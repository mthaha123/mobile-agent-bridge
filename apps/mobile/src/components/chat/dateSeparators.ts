import type { ChatMessage } from '../../stores/chatStore'

/** FlatList 列表项：消息或日期分隔符 */
export type ChatListItem =
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'separator'; key: string; label: string }

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 今天 / 昨天 / M月D日（跨年加年份） */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS)
  const d = new Date(ts)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/**
 * 输入时间正序消息（chatStore 原始数组，旧→新），
 * 输出正序展示项（旧→新）并在每个日界插入分隔符。
 * 分隔符位于"该天第一条消息之前"——正序 FlatList 中视觉上在该天消息上方。
 */
export function buildChatListItems(
  messages: ChatMessage[],
  now: number = Date.now(),
): ChatListItem[] {
  const out: ChatListItem[] = []
  let prevDay: number | null = null
  for (const m of messages) {
    const ts = m.created ?? m.timestamp
    const day = startOfDay(ts)
    // 新的一天 → 分隔符插在该天第一条消息之前
    if (prevDay === null || day !== prevDay) {
      out.push({ kind: 'separator', key: `sep_${day}`, label: dayLabel(ts, now) })
      prevDay = day
    }
    out.push({ kind: 'message', key: m.id, message: m })
  }
  return out
}
