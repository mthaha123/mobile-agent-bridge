import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MarkdownCodeBlock } from '../src/components/chat/MarkdownCodeBlock'

function textOf(node: any): string {
  if (!node) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children) return textOf(node.children)
  return ''
}

function makeBlock(text: string) {
  return TestRenderer.create(<MarkdownCodeBlock text={text} />)
}

describe('MarkdownCodeBlock', () => {
  it('渲染代码文本', () => {
    const tree = makeBlock('const x = 1;\nconsole.log(x);')
    expect(textOf(tree.toJSON())).toContain('const x = 1;')
    expect(textOf(tree.toJSON())).toContain('console.log(x);')
    tree.unmount()
  })

  it('横向 ScrollView + nestedScrollEnabled（Android 嵌套滚动标准修复）', () => {
    const tree = makeBlock('const x = 1;')
    const scroll = tree.root.findByProps({ testID: 'md-code-block' })
    expect(scroll.props.horizontal).toBe(true)
    expect(scroll.props.nestedScrollEnabled).toBe(true)
    tree.unmount()
  })

  it('内容超出容器时才显示横向滚动指示条', () => {
    const tree = makeBlock('const veryLongLine = "' + 'A'.repeat(200) + '";')
    const scroll = tree.root.findByProps({ testID: 'md-code-block' })
    act(() => {
      scroll.props.onContentSizeChange(2000)
      scroll.props.onLayout({ nativeEvent: { layout: { width: 300 } } })
    })
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(true)
    tree.unmount()
  })

  it('内容未超宽时不显示横向滚动指示条', () => {
    const tree = makeBlock('const x = 1;')
    const scroll = tree.root.findByProps({ testID: 'md-code-block' })
    act(() => {
      scroll.props.onContentSizeChange(100)
      scroll.props.onLayout({ nativeEvent: { layout: { width: 300 } } })
    })
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(false)
    tree.unmount()
  })

  it('容器宽度未知时不显示滚动指示条（避免闪条）', () => {
    const tree = makeBlock('const x = 1;')
    const scroll = tree.root.findByProps({ testID: 'md-code-block' })
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(false)
    tree.unmount()
  })

  it('空文本不崩溃', () => {
    const tree = makeBlock('')
    expect(tree.toJSON()).not.toBeNull()
    tree.unmount()
  })
})
