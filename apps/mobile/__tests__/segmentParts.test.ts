import { buildSegments } from '../src/components/chat/segmentParts'
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
function errorPart(id: string): Part {
  return { id, type: 'error', data: { tool: 'bash', error: 'fail' } }
}
function compactionPart(id: string): Part {
  return { id, type: 'compaction', data: {} }
}

describe('buildSegments', () => {
  it('returns empty array for empty parts', () => {
    expect(buildSegments([])).toEqual([])
  })

  it('groups consecutive tool parts into one action-block', () => {
    const parts = [toolPart('t1'), toolPart('t2'), toolPart('t3')]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(3)
  })

  it('groups reasoning + tool into one action-block', () => {
    const parts = [
      reasoningPart('r1', 'thinking about the problem'),
      toolPart('t1'),
      toolPart('t2'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(3)
    expect(segs[0].parts[0].type).toBe('reasoning')
    expect(segs[0].parts[1].type).toBe('tool')
    expect(segs[0].parts[2].type).toBe('tool')
  })

  it('groups interleaved reasoning + tool into one action-block', () => {
    const parts = [
      reasoningPart('r1', 'thinking 1'),
      toolPart('t1'),
      reasoningPart('r2', 'thinking 2'),
      toolPart('t2'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(4)
  })

  it('separates long text from action-block', () => {
    const longText = 'a'.repeat(150)
    const parts = [
      reasoningPart('r1', 'thinking'),
      toolPart('t1'),
      textPart('txt1', longText),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(2) // reasoning + tool
    expect(segs[1].type).toBe('text')
    expect(segs[1].parts).toHaveLength(1)
  })

  it('absorbs short text between action parts into action-block', () => {
    const parts = [
      reasoningPart('r1', 'thinking'),
      textPart('txt1', 'short'), // <100 chars
      toolPart('t1'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(3) // reasoning + short text + tool
  })

  it('groups consecutive reasoning parts into one action-block', () => {
    const longText1 = 'b'.repeat(150)
    const longText2 = 'c'.repeat(150)
    const parts = [
      reasoningPart('r1', longText1),
      reasoningPart('r2', longText2),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(2)
  })

  it('handles typical AI response: reasoning + tools + answer', () => {
    const answerText = 'Here is my analysis of the code... ' + 'x'.repeat(150)
    const parts = [
      reasoningPart('r1', 'Let me think about this...'),
      toolPart('t1'),
      reasoningPart('r2', 'Now I see the issue'),
      toolPart('t2'),
      textPart('txt1', answerText),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('action-block')
    expect(segs[0].parts).toHaveLength(4) // r1 + t1 + r2 + t2
    expect(segs[1].type).toBe('text')
    expect(segs[1].parts).toHaveLength(1) // answer
  })

  it('single tool between text parts becomes its own action-block', () => {
    const longText1 = 'a'.repeat(150)
    const longText2 = 'b'.repeat(150)
    const parts = [
      textPart('txt1', longText1),
      toolPart('t1'),
      textPart('txt2', longText2),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ type: 'text', parts: [parts[0]] })
    expect(segs[1]).toMatchObject({ type: 'action-block', parts: [parts[1]] })
    expect(segs[2]).toMatchObject({ type: 'text', parts: [parts[2]] })
  })

  it('preserves order of mixed parts', () => {
    const longText = 'x'.repeat(150)
    const parts = [
      reasoningPart('r1', 'think1'),
      toolPart('t1'), toolPart('t2'),
      textPart('txt1', longText),
      toolPart('t3'),
      textPart('txt2', longText),
    ]
    const segs = buildSegments(parts)
    expect(segs.map(s => s.type)).toEqual([
      'action-block', 'text', 'action-block', 'text',
    ])
  })

  it('handles error, compaction as independent segments', () => {
    const longText = 'x'.repeat(150)
    const parts = [
      errorPart('e1'),
      compactionPart('c1'),
      textPart('txt1', longText),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs.map(s => s.type)).toEqual(['error', 'compaction', 'text'])
  })

  it('error between action parts breaks the group', () => {
    const parts = [
      toolPart('t1'),
      errorPart('e1'),
      toolPart('t2'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0].type).toBe('action-block')
    expect(segs[1].type).toBe('error')
    expect(segs[2].type).toBe('action-block')
  })
})
