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

  it('groups consecutive tool parts into one tool-group segment', () => {
    const parts = [toolPart('t1'), toolPart('t2'), toolPart('t3')]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('tool-group')
    expect(segs[0].parts).toHaveLength(3)
  })

  it('splits tool groups separated by reasoning', () => {
    const parts = [
      toolPart('t1'), toolPart('t2'),
      reasoningPart('r1', 'thinking'),
      toolPart('t3'), toolPart('t4'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ type: 'tool-group', parts: [parts[0], parts[1]] })
    expect(segs[1]).toMatchObject({ type: 'reasoning', parts: [parts[2]] })
    expect(segs[2]).toMatchObject({ type: 'tool-group', parts: [parts[3], parts[4]] })
  })

  it('keeps each reasoning as its own segment', () => {
    const parts = [reasoningPart('r1', 'a'), reasoningPart('r2', 'b')]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('reasoning')
    expect(segs[1].type).toBe('reasoning')
  })

  it('single tool between text parts becomes its own tool-group', () => {
    const parts = [
      textPart('txt1', 'before'),
      toolPart('t1'),
      textPart('txt2', 'after'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ type: 'text', parts: [parts[0]] })
    expect(segs[1]).toMatchObject({ type: 'tool-group', parts: [parts[1]] })
    expect(segs[2]).toMatchObject({ type: 'text', parts: [parts[2]] })
  })

  it('preserves order of mixed parts', () => {
    const parts = [
      reasoningPart('r1', 'think1'),
      toolPart('t1'), toolPart('t2'),
      textPart('txt1', 'answer'),
      toolPart('t3'),
      textPart('txt2', 'more'),
    ]
    const segs = buildSegments(parts)
    expect(segs.map(s => s.type)).toEqual([
      'reasoning', 'tool-group', 'text', 'tool-group', 'text',
    ])
  })

  it('handles error, file, compaction as independent segments', () => {
    const parts = [
      errorPart('e1'),
      compactionPart('c1'),
      textPart('txt1', 'ok'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs.map(s => s.type)).toEqual(['error', 'compaction', 'text'])
  })
})
