import type { Part } from '../../types/message'

export type SegmentType = 'action-block' | 'text' | 'error' | 'compaction'

export interface Segment {
  type: SegmentType
  parts: Part[]
}

/** 判断是否为"操作类" part（reasoning / tool） */
function isActionPart(p: Part): boolean {
  return p.type === 'reasoning' || p.type === 'tool'
}

/**
 * 将 parts[] 按"操作块"策略分段：
 *
 * 策略核心：将连续的 reasoning + tool 合并为一个 action-block，
 * text / error / compaction 等内容型 part 始终独立成段。
 */
export function buildSegments(parts: Part[]): Segment[] {
  if (!parts || parts.length === 0) return []

  const result: Segment[] = []
  let i = 0

  while (i < parts.length) {
    const p = parts[i]

    if (isActionPart(p)) {
      // 收集连续的 action parts（reasoning + tool）
      const group: Part[] = []
      while (i < parts.length && isActionPart(parts[i])) {
        group.push(parts[i])
        i++
      }
      if (group.length > 0) {
        result.push({ type: 'action-block', parts: group })
      }
    } else if (p.type === 'text') {
      // 长文本独立成段
      result.push({ type: 'text', parts: [p] })
      i++
    } else if (p.type === 'error') {
      result.push({ type: 'error', parts: [p] })
      i++
    } else if (p.type === 'compaction') {
      result.push({ type: 'compaction', parts: [p] })
      i++
    } else {
      // 未知类型兜底：作为独立段
      result.push({ type: 'text', parts: [p] })
      i++
    }
  }

  return result
}
