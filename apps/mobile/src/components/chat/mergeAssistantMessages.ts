import type { ChatMessage } from '../../stores/chatStore'
import type { Part } from '../../types/message'

/**
 * 渲染层合并连续 assistant 消息（grouped 模式专用）。
 *
 * 背景：SDK v2 把 reasoning / tool call / text 作为独立 message（不同 info.id）返回。
 * 实时流式路径（chatStore.ingestEvent）按 assistantMessageID 建立独立 store 消息，
 * 历史加载路径（applyLoadedMessages）也逐条入库，且 addMessage 按 messageID 去重
 * 使合并版本无法替换已在 store 里的实时消息。buildSegments 只在单条消息的 parts[]
 * 上分组，跨消息的操作序列会散落渲染（思考块、工具卡、文本行各自为政）。
 *
 * 此函数在渲染前把连续 assistant 消息拼为一条：
 * - parts 按消息顺序拼接（保持 reasoning/text/tool 相对时间线顺序）
 * - 无 parts 但有 content 的消息（流式文本）合成为 text part，保证在操作序列中的位置；
 *   parts 存在但缺 text part 的消息，其流式 content 也追加为尾部 text part（防丢失）
 * - 保留首条消息的 id/messageID/created/timestamp/agent（FlatList key 稳定、日期分隔符正确）
 * - 单条 assistant 消息原样透传（引用不变，配合 MessageItem memo 避免多余重渲染）
 *
 * 仅影响展示：chatStore 数据保持逐条 SDK 消息不变。
 *
 * mergedRunCache：key = run 首条消息引用，value = 上次的成员快照与合并对象。
 * 成员引用逐一未变时复用合并对象，保住 MessageItem 的 memo（详见 flush 内注释）。
 */
const mergedRunCache = new WeakMap<ChatMessage, { members: ChatMessage[]; merged: ChatMessage }>()

export function mergeConsecutiveAssistantMsgs(msgs: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let acc: ChatMessage[] = []

  const flush = () => {
    if (acc.length === 0) return
    if (acc.length === 1) {
      // 单条无需重建，原引用透传
      result.push(acc[0])
    } else {
      // 成员引用全都没变时复用上一次的合并结果 —— 否则每次流式 flush 都会
      // 生成新的合并对象，使 MessageItem 的 memo 失效，整段 run（含历史文本、
      // 思考块、工具卡）跟着重渲染并重新 lex+parse markdown。
      const cached = mergedRunCache.get(acc[0])
      if (cached && cached.members.length === acc.length && cached.members.every((m, i) => m === acc[i])) {
        result.push(cached.merged)
        acc = []
        return
      }
      const first = acc[0]
      const parts: Part[] = []
      for (const m of acc) {
        if (Array.isArray(m.parts) && m.parts.length > 0) {
          parts.push(...m.parts)
          const hasTextInParts = m.parts.some((p) => p.type === 'text')
          if (!hasTextInParts && m.content) {
            // 流式文本存于 content（parts 无 text part）→ 合成为尾部 text part，
            // 否则 MessageItem 的 hasTextPart 抑制逻辑/顺序都会把它放错位
            parts.push({ id: `${m.id}-content`, type: 'text', data: { content: m.content } })
          }
        } else if (m.content) {
          // 纯 content 消息（流式中的文本消息）：合成 text part 保持时间线位置
          parts.push({ id: `${m.id}-content`, type: 'text', data: { content: m.content } })
        }
      }
      if (parts.length === 0) {
        // 整段 run 无可展示内容（纯占位消息），丢弃避免空泡
        acc = []
        return
      }
      const merged: ChatMessage = {
        ...first,
        parts,
        content: '',
      }
      mergedRunCache.set(first, { members: [...acc], merged })
      result.push(merged)
    }
    acc = []
  }

  for (const msg of msgs) {
    if ((msg.role as string) === 'assistant') {
      acc.push(msg)
    } else {
      flush()
      result.push(msg)
    }
  }
  flush()
  return result
}
