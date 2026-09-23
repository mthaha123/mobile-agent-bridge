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
})
