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

  it('代码文本不可 selectable（Android 文本选择手势会抢横向 pan → 滑动难触发）', () => {
    const tree = makeBlock('const x = 1;')
    const { Text } = require('react-native')
    const texts = tree.root.findAllByType(Text)
    expect(texts.length).toBeGreaterThan(0)
    const selectableOn = texts.filter((t: any) => t.props.selectable === true)
    expect(selectableOn).toHaveLength(0)
    tree.unmount()
  })

  it('复制按钮写入剪贴板（补偿移除 selectable 的复制能力）', () => {
    const { Clipboard } = require('react-native')
    ;(Clipboard.setString as jest.Mock).mockClear()
    const code = 'const x = 1;\nconsole.log(x);'
    const tree = makeBlock(code)

    const copyBtn = tree.root.findByProps({ testID: 'md-code-copy' })
    act(() => { copyBtn.props.onPress() })
    expect(Clipboard.setString).toHaveBeenCalledWith(code)
    tree.unmount()
  })
})
