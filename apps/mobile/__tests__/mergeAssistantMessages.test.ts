import { mergeConsecutiveAssistantMsgs } from '../src/components/chat/mergeAssistantMessages'
import type { ChatMessage } from '../src/stores/chatStore'
import type { Part } from '../src/types/message'

function toolPart(id: string, tool = 'read'): Part {
  return { id, type: 'tool', data: { tool, input: {}, status: 'success' } }
}
function textPart(id: string, content: string): Part {
  return { id, type: 'text', data: { content } }
}
function reasoningPart(id: string, content: string): Part {
  return { id, type: 'reasoning', data: { content } }
}

let seq = 0
function msg(partial: Partial<ChatMessage> & { role: ChatMessage['role'] }): ChatMessage {
  seq += 1
  return {
    id: partial.id ?? `m${seq}`,
    content: '',
    timestamp: 1700000000000 + seq,
    ...partial,
  }
}

describe('mergeConsecutiveAssistantMsgs', () => {
  it('returns empty array for empty input', () => {
    expect(mergeConsecutiveAssistantMsgs([])).toEqual([])
  })

  it('passes through a single assistant message unchanged (same reference)', () => {
    const a = msg({ role: 'assistant', parts: [toolPart('t1')] })
    expect(mergeConsecutiveAssistantMsgs([a])[0]).toBe(a)
  })

  it('merges consecutive assistant messages parts in order', () => {
    const a = msg({ role: 'assistant', parts: [reasoningPart('r1', 'thinking')] })
    const b = msg({ role: 'assistant', parts: [toolPart('t1'), toolPart('t2')] })
    const out = mergeConsecutiveAssistantMsgs([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].parts).toEqual([reasoningPart('r1', 'thinking'), toolPart('t1'), toolPart('t2')])
  })

  it('user message breaks the assistant run', () => {
    const a = msg({ role: 'assistant', parts: [toolPart('t1')] })
    const u = msg({ role: 'user', content: 'hi' })
    const b = msg({ role: 'assistant', parts: [toolPart('t2')] })
    const out = mergeConsecutiveAssistantMsgs([a, u, b])
    expect(out).toHaveLength(3)
    expect(out[0].parts).toEqual([toolPart('t1')])
    expect(out[1].role).toBe('user')
    expect(out[2].parts).toEqual([toolPart('t2')])
  })

  it('synthesizes text part from content-only streaming messages preserving position', () => {
    // 模拟实时流式：文本消息（无 parts）、工具消息交替
    const a = msg({ id: 'ma', role: 'assistant', content: 'let me check the repo' })
    const b = msg({ id: 'mb', role: 'assistant', parts: [toolPart('t1', 'bash')] })
    const c = msg({ id: 'mc', role: 'assistant', content: 'done checking' })
    const out = mergeConsecutiveAssistantMsgs([a, b, c])
    expect(out).toHaveLength(1)
    expect(out[0].parts).toEqual([
      textPart('ma-content', 'let me check the repo'),
      toolPart('t1', 'bash'),
      textPart('mc-content', 'done checking'),
    ])
  })

  it('appends bare streaming content of parts-bearing messages as trailing text part', () => {
    // 流式中 parts（工具）与 content（文本）并存的消息：content 不能因 hasTextPart 抑制而丢失
    const a = msg({ id: 'ma', role: 'assistant', parts: [textPart('t1', 'loaded text')], content: 'loaded text' })
    const b = msg({ id: 'mb', role: 'assistant', parts: [toolPart('t2')], content: 'streaming tail' })
    const out = mergeConsecutiveAssistantMsgs([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].parts).toEqual([
      textPart('t1', 'loaded text'),
      toolPart('t2'),
      textPart('mb-content', 'streaming tail'),
    ])
  })

  it('keeps first message identity fields (id/messageID/created/timestamp/agent)', () => {
    const a = msg({
      role: 'assistant',
      id: 'first',
      messageID: 'srv-1',
      created: 1700000001000,
      timestamp: 1700000001000,
      agent: 'build',
    } as Partial<ChatMessage> & { role: ChatMessage['role'] })
    const b = msg({ role: 'assistant', id: 'second', parts: [toolPart('t1')] })
    const out = mergeConsecutiveAssistantMsgs([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('first')
    expect(out[0].messageID).toBe('srv-1')
    expect(out[0].created).toBe(1700000001000)
    expect(out[0].timestamp).toBe(1700000001000)
    expect(out[0].agent).toBe('build')
  })

  it('drops a fully empty assistant run (placeholder messages only)', () => {
    const a = msg({ role: 'assistant', content: '' })
    const b = msg({ role: 'assistant', content: '' })
    const out = mergeConsecutiveAssistantMsgs([a, b])
    expect(out).toHaveLength(0)
  })

  it('merges runs split across history page boundary', () => {
    // 上滑加载：更早页尾部 assistant + 当前页头部 assistant（prepend 后相邻）
    const older = msg({ role: 'assistant', parts: [toolPart('t-old')] })
    const newer = msg({ role: 'assistant', parts: [toolPart('t-new')] })
    const out = mergeConsecutiveAssistantMsgs([older, newer])
    expect(out).toHaveLength(1)
    expect(out[0].parts).toEqual([toolPart('t-old'), toolPart('t-new')])
  })
})
