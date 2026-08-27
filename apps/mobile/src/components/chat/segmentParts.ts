import type { Part } from '../../types/message'

export type SegmentType = 'tool-group' | 'reasoning' | 'text' | 'error' | 'file' | 'compaction'

export interface Segment {
  type: SegmentType
  parts: Part[]
}

/**
 * 将 parts[] 按连续同类分段：
 * - 相邻 tool parts 合并为一个 tool-group segment
 * - reasoning / text / error / file / compaction 各自独立
 * - 单个 tool call（前后被非 tool part 隔开）仍作为 tool-group(toolCount=1)
 */
export function buildSegments(parts: Part[]): Segment[] {
  if (!parts || parts.length === 0) return []

  const result: Segment[] = []
  let i = 0

  while (i < parts.length) {
    const p = parts[i]
    if (p.type === 'tool') {
      // 收集连续的 tool parts
      const group: Part[] = []
      while (i < parts.length && parts[i].type === 'tool') {
        group.push(parts[i])
        i++
      }
      result.push({ type: 'tool-group', parts: group })
    } else {
      // reasoning / text / error / file / compaction 各自独立
      const segType: SegmentType = p.type as SegmentType
      result.push({ type: segType, parts: [p] })
      i++
    }
  }

  return result
}
