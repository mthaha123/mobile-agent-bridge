import {
  buildChatListItems,
  dayLabel,
  ChatListItem,
} from '../src/components/chat/dateSeparators'
import type { ChatMessage } from '../src/stores/chatStore'

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

function msg(id: string, created: number, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { id, role, content: id, timestamp: created, status: 'complete', parts: [], created }
}

describe('dayLabel', () => {
  it('labels today', () => {
    expect(dayLabel(NOW, NOW)).toBe('今天')
  })
  it('labels yesterday', () => {
    expect(dayLabel(NOW - DAY, NOW)).toBe('昨天')
  })
  it('labels older same-year date as M月D日', () => {
    expect(
      dayLabel(
        new Date('2024-03-05T10:00:00').getTime(),
        new Date('2024-08-22T12:00:00').getTime(),
      ),
    ).toBe('3月5日')
  })
  it('adds year for cross-year dates', () => {
    expect(dayLabel(new Date('2025-12-31T10:00:00').getTime(), new Date('2026-01-02T10:00:00').getTime())).toBe('2025年12月31日')
  })
})

describe('buildChatListItems', () => {
  it('returns display data in oldest-first order (no reverse)', () => {
    const items = buildChatListItems([msg('a', NOW - DAY), msg('b', NOW)], NOW)
    const kinds = items.map((i: ChatListItem) => (i.kind === 'separator' ? 'sep' : i.key))
    // 正序：最旧在 index 0，最新在末尾；分隔符在每天第一条消息之前
    expect(kinds).toEqual(['sep', 'a', 'sep', 'b'])
  })

  it('inserts one separator at each day boundary', () => {
    const items = buildChatListItems(
      [msg('a', NOW - DAY), msg('b', NOW - 1000), msg('c', NOW - 500)],
      NOW,
    )
    const seps = items.filter((i: ChatListItem) => i.kind === 'separator')
    expect(seps.length).toBe(2)
    // 正序：昨天在前（最旧），今天在后
    expect(seps.map((s: any) => s.label)).toEqual(['昨天', '今天'])
  })

  it('separator sits before the first message of each day', () => {
    const items = buildChatListItems([msg('old', NOW - DAY), msg('new', NOW)], NOW)
    const kinds = items.map((i: ChatListItem) => (i.kind === 'separator' ? 'sep' : i.key))
    // 正序：分隔符在每天第一条消息之前
    expect(kinds).toEqual(['sep', 'old', 'sep', 'new'])
  })

  it('empty input yields empty output', () => {
    expect(buildChatListItems([], NOW)).toEqual([])
  })

  it('falls back to timestamp when created is missing', () => {
    const m: ChatMessage = { id: 'x', role: 'assistant', content: '', timestamp: NOW, status: 'complete', parts: [] }
    const items = buildChatListItems([m], NOW)
    expect(items.some((i) => i.kind === 'separator')).toBe(true)
  })
})
