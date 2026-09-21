import { accumulateChunks, splitStablePrefix, FrozenChunks } from '../src/components/chat/MarkdownRenderer'

/**
 * 流式增量解析的切分规则回归防护。
 *
 * 背景：流式期间 content 每个 flush 都变，若整篇重新 lex+parse（实测 30k 字符 /
 * 1 万 token 节点 / 每秒 12.5 次），JS 线程长期 100%、点击无响应。修复方式是把
 * 「已写完的块」冻结成稳定前缀（命中 useMarkdown memo，零解析），只重解析尾部。
 *
 * 这些用例锁定切分的**安全边界**：切错会把一个 markdown 块拆成两个（松/紧列表、
 * 引用分裂、围栏内空行），渲染结果与整篇解析不一致 —— 属于用户可见的回归。
 */
describe('splitStablePrefix', () => {
  it('无空行时不可切分（退化为整篇解析）', () => {
    expect(splitStablePrefix('一段没有空行的文字')).toEqual({
      stable: '',
      tail: '一段没有空行的文字',
    })
  })

  it('在段落后的空行处切分', () => {
    expect(splitStablePrefix('第一段\n\n第二段')).toEqual({
      stable: '第一段\n\n',
      tail: '第二段',
    })
  })

  it('切分点不落在列表项之后（避免拆散同一个列表）', () => {
    const content = '- a\n- b\n\n- c'
    expect(splitStablePrefix(content)).toEqual({ stable: '', tail: content })
  })

  it('切分点不落在有序列表项之后', () => {
    const content = '1. a\n2. b\n\n3. c'
    expect(splitStablePrefix(content)).toEqual({ stable: '', tail: content })
  })

  it('切分点可以落在标题之后', () => {
    expect(splitStablePrefix('# 标题\n\n正文')).toEqual({
      stable: '# 标题\n\n',
      tail: '正文',
    })
  })

  it('未闭合代码围栏内的空行不作为切分点', () => {
    const content = '```\ncode\n\nmore\n```'
    expect(splitStablePrefix(content)).toEqual({ stable: '', tail: content })
  })

  it('闭合围栏之后可以切分', () => {
    expect(splitStablePrefix('```\na\n```\n\n正文')).toEqual({
      stable: '```\na\n```\n\n',
      tail: '正文',
    })
  })

  it('切分点不落在引用块之后', () => {
    const content = '> 引用\n\n后续'
    expect(splitStablePrefix(content)).toEqual({ stable: '', tail: content })
  })

  it('切分点不落在缩进续行之后', () => {
    const content = '段落\n  续行\n\n后续'
    expect(splitStablePrefix(content)).toEqual({ stable: '', tail: content })
  })

  it('多块长文只在最后一个安全块边界处切分', () => {
    const content = '# 一\n\n段落一\n\n## 二\n\n段落二\n\n- 列表项'
    const { stable, tail } = splitStablePrefix(content)
    expect(stable).toBe('# 一\n\n段落一\n\n## 二\n\n段落二\n\n')
    expect(tail).toBe('- 列表项')
  })

  it('stable + tail 恒等于原文（任何切分都不丢字）', () => {
    const cases = [
      '',
      'a',
      '\n\n',
      '第一段\n\n第二段',
      '- a\n- b\n\n- c',
      '```\ncode\n\nmore\n```',
      '```\na\n```\n\n正文',
      '> 引用\n\n后续',
      '# 标题\n\n正文\n\n## 小标题\n\n结尾',
      '段落\n  续行\n\n后续',
    ]
    for (const content of cases) {
      const { stable, tail } = splitStablePrefix(content)
      expect(stable + tail).toBe(content)
    }
  })
})

/**
 * 冻结块累积的不变量。
 *
 * 这里锁的是一个**已经踩过的坑**：如果把「稳定前缀」当成一个整体字符串去 memo，
 * 边界每推进一次前缀字符串就变了，整篇会被重新解析（实测单次 346ms / 28.7k 字符），
 * 流式期间每秒仍会整篇重解析数次。正确做法是按块累积，边界推进时只解析新增块。
 */
describe('accumulateChunks（冻结块只增不改）', () => {
  const buildDoc = (): string => {
    const parts: string[] = []
    for (let i = 0; i < 300; i++) {
      parts.push(`## 小节 ${i}`)
      parts.push(`这是第 ${i} 段的正文内容，用于模拟流式长文。`)
    }
    return parts.join('\n\n') + '\n'
  }

  it('首次累积把整段稳定前缀作为单块', () => {
    const next = accumulateChunks({ text: '', chunks: [] }, '第一段\n\n')
    expect(next).toEqual({ text: '第一段\n\n', chunks: ['第一段\n\n'] })
  })

  it('前缀不变时返回同一引用（不产生新块、不触发重解析）', () => {
    const prev: FrozenChunks = { text: 'a\n\n', chunks: ['a\n\n'] }
    expect(accumulateChunks(prev, 'a\n\n')).toBe(prev)
  })

  it('边界推进时只追加新增部分，已有块原样保留', () => {
    const prev: FrozenChunks = { text: 'a\n\n', chunks: ['a\n\n'] }
    const next = accumulateChunks(prev, 'a\n\nb\n\n')
    expect(next.chunks).toEqual(['a\n\n', 'b\n\n'])
    expect(next.chunks[0]).toBe(prev.chunks[0])
  })

  it('内容被替换（前缀不再匹配）时整组重建', () => {
    const prev: FrozenChunks = { text: 'a\n\nb\n\n', chunks: ['a\n\n', 'b\n\n'] }
    const next = accumulateChunks(prev, '完全不同的内容\n\n')
    expect(next.chunks).toEqual(['完全不同的内容\n\n'])
  })

  it('流式全程只解析 O(文档长度) 的字符（而非 文档长度 × flush 次数）', () => {
    const doc = buildDoc()
    let acc: FrozenChunks = { text: '', chunks: [] }
    let chunkChars = 0
    let tailChars = 0
    let flushes = 0
    for (let i = 40; i <= doc.length; i += 40) {
      const content = doc.slice(0, i)
      const { stable, tail } = splitStablePrefix(content)
      const next = accumulateChunks(acc, stable)
      if (next !== acc) {
        const before = acc.chunks.reduce((a, c) => a + c.length, 0)
        const after = next.chunks.reduce((a, c) => a + c.length, 0)
        chunkChars += after - before
        acc = next
      }
      tailChars += tail.length
      flushes++
    }
    // 冻结块总量 ≈ 文档长度（不允许整篇反复重解析）
    expect(chunkChars).toBeLessThan(doc.length * 1.5)
    expect(chunkChars).toBeGreaterThan(doc.length * 0.5)
    // 尾部平均长度远小于文档长度（每个 flush 只解析这一小段）
    expect(tailChars / flushes).toBeLessThan(1000)
  })
})
