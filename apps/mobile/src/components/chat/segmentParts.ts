import type { Part } from '../../types/message'

export type SegmentType = 'action-block' | 'text' | 'error' | 'compaction'

export interface Segment {
  type: SegmentType
  parts: Part[]
}

/** 短文本阈值：低于此字符数的文本被视为过渡语，吸收到 action-block 中 */
const SHORT_TEXT_THRESHOLD = 100

/** 判断是否为"操作类" part（reasoning / tool） */
function isActionPart(p: Part): boolean {
  return p.type === 'reasoning' || p.type === 'tool'
}

/** 判断是否为短文本（过渡语） */
function isShortText(p: Part): boolean {
  if (p.type !== 'text') return false
  const content = (p.data as { content?: string })?.content ?? ''
  return content.length < SHORT_TEXT_THRESHOLD
}

/**
 * 将 parts[] 按"操作块"策略分段：
 *
 * 策略核心：将 reasoning + tool + 短文本（<100字符的过渡语）合并为一个 action-block，
 * 只有长文本（>100字符）才作为独立的 text segment 分隔。
 *
 * 典型 AI 回复结构：
 *   [reasoning, tool, reasoning, tool, ...长文本回答]
 *   ↓ 聚合后
 *   [action-block(reasoning+tool+reasoning+tool), text(长文本回答)]
 *
 * 这与 ChatGPT/Claude Web UI 的折叠逻辑一致：
 * 整个"操作阶段"（思考+工具调用）折叠为一个块，只有最终回答单独显示。
 */
export function buildSegments(parts: Part[]): Segment[] {
  if (!parts || parts.length === 0) return []

  const result: Segment[] = []
  let i = 0

  while (i < parts.length) {
    const p = parts[i]

    if (isActionPart(p) || isShortText(p)) {
      // 收集连续的 action parts + 短文本
      const group: Part[] = []
      while (i < parts.length && (isActionPart(parts[i]) || isShortText(parts[i]))) {
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
