/**
 * NativeMarkdown tests
 *
 * 覆盖：首帧 reset / 后缀追加只 append 差量 / 非前缀替换走 reset / append 抛错 reset 兜底。
 * 配合 __mocks__/react-native-nitro-markdown.js（node_modules 手工 mock 自动生效）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { NativeMarkdown } from '../src/components/chat/NativeMarkdown'

const nitro = require('react-native-nitro-markdown')
const mock = nitro.__mock

function render(content: string) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => { tree = TestRenderer.create(<NativeMarkdown content={content} />) })
  return tree
}
function streamNodes(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n: any) => n.type === 'MarkdownStream')
}

beforeEach(() => mock.resetAll())

describe('NativeMarkdown（原生引擎骨架）', () => {
  it('首帧 reset 全文（lastRef 从空开始）', () => {
    const tree = render('# Hello')
    expect(mock.resetTo).toBe('# Hello')
    expect(mock.appended).toEqual([])
    expect(streamNodes(tree).length).toBeGreaterThan(0)
  })

  it('后缀追加只把差量交给 session（增量 AST 复用路径）', () => {
    const tree = render('# Hello')
    act(() => { tree.update(<NativeMarkdown content="# Hello world" />) })
    expect(mock.appended).toEqual([' world'])
    expect(mock.resetTo).toBe('# Hello') // 没被覆盖
  })

  it('内容被替换（非前缀）→ 整篇 reset（历史加载/权威快照覆盖）', () => {
    const tree = render('# Hello')
    act(() => { tree.update(<NativeMarkdown content="完全不同的内容" />) })
    expect(mock.resetTo).toBe('完全不同的内容')
    expect(mock.appended).toEqual([])
  })

  it('append 抛错 → reset 兜底且不崩', () => {
    const orig = nitro.useMarkdownSession
    const tree = render('# Hello')
    nitro.useMarkdownSession = () => ({
      getSession: () => ({ append: () => { throw new Error('invalid_range') } }),
      reset: (t: string) => { mock.resetTo = t },
    })
    try {
      act(() => { tree.update(<NativeMarkdown content="# Hello+" />) })
      expect(mock.resetTo).toBe('# Hello+')
    } finally {
      nitro.useMarkdownSession = orig
    }
  })

  it('v2：把 renderMarkdown 定制点交给冻结块管线，并透传主题 styles', () => {
    const tree = render('# Hi')
    const node = streamNodes(tree)[0]
    expect(typeof node.props.renderMarkdown).toBe('function')
    expect(node.props.styles).toBeDefined()
    expect(node.props.styles.text).toBeDefined()
    expect(node.props.styles.code_block).toBeDefined()
  })

  /** 收集返回树里 FrozenChunk 元素的 text（按 themeKey 属性识别） */
  function frozenTexts(n: any): string[] {
    if (!n) return []
    if (Array.isArray(n)) return n.flatMap(frozenTexts)
    const out: string[] = []
    if (n.props && typeof n.props.text === 'string' && typeof n.props.themeKey === 'string') {
      out.push(n.props.text)
    }
    const children = n.props?.children
    if (Array.isArray(children)) out.push(...children.flatMap(frozenTexts))
    else if (children && typeof children === 'object') out.push(...frozenTexts(children))
    return out
  }

  it('v2：冻结块只增不改——前缀推进时旧块 text 引用级不变', () => {
    const tree = render('第一段\n\n第')
    const node = streamNodes(tree)[0]
    const rm = node.props.renderMarkdown as (p: unknown) => unknown
    const r1 = rm({ text: '第一段\n\n第', markdownProps: {} })
    const r2 = rm({ text: '第一段\n\n第二段继续写', markdownProps: {} })
    const t1 = frozenTexts(r1)
    const t2 = frozenTexts(r2)
    expect(t1.length).toBeGreaterThan(0)
    expect(t2[0]).toBe(t1[0]) // 已冻结的块 text 逐字不变
  })

  it('v2：未闭合围栏尾部走零解析快路（md-stream-code）', () => {
    const tree = render('x')
    const rm = (streamNodes(tree)[0].props.renderMarkdown as any)
    const out = rm({ text: '```ts\nconst a = 1', markdownProps: {} })
    const rendered = TestRenderer.create(<>{out as any}</>)
    expect(rendered.root.findAll((n: any) => n.props?.testID === 'md-stream-code').length).toBeGreaterThan(0)
  })

  it('v2：纯文本尾部走零解析快路（md-plain-tail），真 markdown 尾部才进 <Markdown>', () => {
    const tree = render('x')
    const rm = (streamNodes(tree)[0].props.renderMarkdown as any)

    const plainOut = rm({ text: '一段没有标记的普通文字', markdownProps: {} })
    const plainTree = TestRenderer.create(<>{plainOut as any}</>)
    expect(plainTree.root.findAll((n: any) => n.props?.testID === 'md-plain-tail').length).toBeGreaterThan(0)

    const mdOut = rm({ text: '正文\n\n**加粗**尾部', markdownProps: {} })
    const mdTree = TestRenderer.create(<>{mdOut as any}</>)
    expect(mdTree.root.findAll((n: any) => n.type === 'Markdown').length).toBeGreaterThan(0)
  })
})
