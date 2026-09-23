import React from 'react'
import TestRenderer from 'react-test-renderer'
import { View } from 'react-native'
import { MarkdownRenderer, TableAwareRenderer } from '../src/components/chat/MarkdownRenderer'

function textOf(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children) return textOf(node.children)
  return ''
}

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Hello World" />)
    expect(textOf(tree.toJSON())).toContain('Hello World')
  })

  it('renders headings', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="# Heading 1\n## Heading 2\n### Heading 3" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('Heading 1')
    expect(text).toContain('Heading 2')
    expect(text).toContain('Heading 3')
  })

  it('renders code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(textOf(tree.toJSON())).toContain('const x = 1;')
  })

  it('renders blockquotes', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="> This is a quote" />,
    )
    expect(textOf(tree.toJSON())).toContain('This is a quote')
  })

  it('renders unordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="- Item 1\n- Item 2\n- Item 3" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('Item 1')
    expect(text).toContain('Item 2')
    expect(text).toContain('Item 3')
  })

  it('renders ordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="1. First\n2. Second\n3. Third" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('First')
    expect(text).toContain('Second')
    expect(text).toContain('Third')
  })

  it('engine=native 分发到原生引擎（渲染 MarkdownStream）', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="# Hi" engine="native" />)
    expect(tree.root.findAll((n: any) => n.type === 'MarkdownStream').length).toBeGreaterThan(0)
  })

  it('engine=legacy 走冻结块路径（无 MarkdownStream）', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="# Hi" engine="legacy" />)
    expect(tree.root.findAll((n: any) => n.type === 'MarkdownStream').length).toBe(0)
  })

  it('renders horizontal rules', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="---" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders tables', () => {
    const table = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
    const tree = TestRenderer.create(<MarkdownRenderer content={table} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Header 1')
    expect(text).toContain('Cell 1')
  })

  it('renders inline code', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="Use `console.log()` for debugging" />,
    )
    expect(textOf(tree.toJSON())).toContain('console.log()')
  })

  it('renders bold text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is **bold** text" />,
    )
    expect(textOf(tree.toJSON())).toContain('bold')
  })

  it('renders italic text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is *italic* text" />,
    )
    expect(textOf(tree.toJSON())).toContain('italic')
  })

  it('renders links', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="[OpenCode](https://opencode.ai)" />,
    )
    expect(textOf(tree.toJSON())).toContain('OpenCode')
  })

  it('handles empty lines', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Line 1\n\nLine 2" />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Line 1')
    expect(text).toContain('Line 2')
  })

  it('renders code block with language label', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(textOf(tree.toJSON())).toContain('const x = 1')
  })

  it('renders code block without language', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'```\nhello\n```'} />)
    expect(textOf(tree.toJSON())).toContain('hello')
  })

  it('renders multiple code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```js\na\n```\n\n```python\nb\n```'} />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('a')
    expect(text).toContain('b')
  })

  it('renders nested markdown structures', () => {
    const content = `# Title\n\nSome text\n\n- Item 1\n- Item 2\n\n> A quote`
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Title')
    expect(text).toContain('Some text')
    expect(text).toContain('Item 1')
    expect(text).toContain('A quote')
  })

  it('handles empty string', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="" />)
    expect(textOf(tree.toJSON())).toBe('')
  })

  it('handles only whitespace', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="   \n\n  " />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders heading levels 1-6', () => {
    const mk = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
    const tree = TestRenderer.create(<MarkdownRenderer content={mk} />)
    const text = textOf(tree.toJSON())
    ;['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach(h => expect(text).toContain(h))
  })

  it('renders long content without crashing', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: some text here`)
    const content = lines.join('\n')
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    expect(textOf(tree.toJSON())).toContain('Line 50')
    expect(textOf(tree.toJSON())).toContain('Line 100')
  })

  it('renders content with special characters', () => {
    const content = 'Special chars: <>&"\'@#$%^()'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    expect(textOf(tree.toJSON())).toContain('Special chars:')
  })

  it('renders mixed inline formatting without crashing', () => {
    const content = '**bold** *italic* `code` and [link](https://x.com) all together'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('bold')
    expect(text).toContain('italic')
  })

  it('renders consecutive similar blocks', () => {
    const content = '```js\nconst a = 1\n```\n```js\nconst b = 2\n```'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('const a = 1')
    expect(text).toContain('const b = 2')
  })

  it('renders heading with no space after #', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="#Heading" />)
    const text = textOf(tree.toJSON())
    expect(text).not.toBe('')
  })

  // ── 位置键（性能回归防护）──────────────────────────────────────────────
  //
  // 背景：react-native-marked 的 Renderer.getKey() 用 github-slugger 的单调递增
  // slug 当 key，且 slugger 永不重置 —— 每次重新解析（流式每 80ms 一次）都产出全新
  // key，React 判定整棵 markdown 子树"全删全建"，Fabric 把每个节点重新
  // create + measure + layout（实测主线程卡在 View.<init>/View.measure 打满、
  // 点击无响应，slugger 内部 Set 还无界增长导致内存持续上涨）。
  //
  // 修复：覆盖 getKey() 为"单次解析内自增的位置键"（见 MarkdownRenderer.tsx）。
  // 注意：jest 环境下 react-native-marked 的 marked.lexer 不解析（返回整段原始
  // 文本），因此这里直接对渲染器契约做单测，而不是断言组件产出的 key。
  describe('位置键（性能回归防护）', () => {
    it('同一实例 resetKeys 后键序列可复现（前缀稳定，避免整树重建）', () => {
      const r = new TableAwareRenderer()
      r.resetKeys()
      const first = [r.getKey(), r.getKey(), r.getKey()]
      r.resetKeys()
      const second = [r.getKey(), r.getKey(), r.getKey()]
      expect(second).toEqual(first)
      // 单次解析内键必须唯一
      expect(new Set(first).size).toBe(first.length)
    })

    it('resetKeys 后首个键与上次相同（旧 slugger 实现会持续递增）', () => {
      const r = new TableAwareRenderer()
      r.resetKeys()
      const k1 = r.getKey()
      r.resetKeys()
      expect(r.getKey()).toBe(k1)
    })

    it('不同实例的键命名空间互不冲突', () => {
      const a = new TableAwareRenderer()
      const b = new TableAwareRenderer()
      a.resetKeys()
      b.resetKeys()
      expect(a.getKey()).not.toBe(b.getKey())
    })
  })
})

describe('MarkdownRenderer — 流式代码围栏增量渲染', () => {
  it('未闭合围栏直接走轻量代码块渲染（跳过 markdown 解析），内容可见', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```ts\nconst a = 1\nconst b = 2'} />,
    )
    const streamBlocks = tree.root.findAll((n: any) => n.props?.testID === 'md-stream-code')
    expect(streamBlocks.length).toBeGreaterThan(0)
    const text = textOf(tree.toJSON())
    expect(text).toContain('const a = 1')
    expect(text).toContain('const b = 2')
  })

  it('普通文本尾部不产生代码块（仍走 markdown 增量解析）', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'普通文本，没有围栏'} />)
    expect(tree.root.findAll((n: any) => n.props?.testID === 'md-stream-code').length).toBe(0)
    expect(tree.root.findAll((n: any) => n.props?.testID === 'md-code-block').length).toBe(0)
  })

  it('围栏闭合后不再走流式直渲染（切回 markdown 增量解析路径）', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```ts\nconst a = 1\n```'} />,
    )
    expect(tree.root.findAll((n: any) => n.props?.testID === 'md-stream-code').length).toBe(0)
    expect(textOf(tree.toJSON())).toContain('const a = 1')
  })

  it('纯文本尾部走单节点快速路径（md-plain-tail），内容一致', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'一段普通正文'} />)
    expect(tree.root.findAll((n: any) => n.props?.testID === 'md-plain-tail').length).toBeGreaterThan(0)
    expect(textOf(tree.toJSON())).toContain('一段普通正文')
  })

  it('含 markdown 语义的尾部不走纯文本快速路径', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'**加粗**'} />)
    expect(tree.root.findAll((n: any) => n.props?.testID === 'md-plain-tail').length).toBe(0)
    expect(textOf(tree.toJSON())).toContain('加粗')
  })
})
