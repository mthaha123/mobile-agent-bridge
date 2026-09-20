import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, Text } from 'react-native'
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

/** 横向滚动落在共享原语内部的 ScrollView 上（testID 由原语透传） */
function horizontalScroll(tree: TestRenderer.ReactTestRenderer) {
  return tree.root
    .findAllByType(ScrollView)
    .find((n) => n.props.testID === 'md-code-block')
}

/** 真实代码文本节点 */
function codeText(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'md-code-text' })
}

/** 固有宽度探针节点 */
function probeText(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'md-code-probe' })
}

function styleOf(node: any): Record<string, unknown> {
  const arr = Array.isArray(node.props.style) ? node.props.style : [node.props.style]
  return Object.assign({}, ...arr.filter(Boolean))
}

function fireLayout(tree: TestRenderer.ReactTestRenderer, widths: number[]) {
  act(() => {
    probeText(tree).props.onTextLayout({
      nativeEvent: { lines: widths.map((w) => ({ width: w, height: 24 })) },
    })
  })
}

/** 复刻 react-native-marked 默认 theme 的 code 容器样式 */
const THEME_CODE_STYLE = {
  padding: 16,
  backgroundColor: '#123456',
  minWidth: '100%' as const,
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
    const scroll = horizontalScroll(tree)
    expect(scroll).toBeTruthy()
    expect(scroll!.props.horizontal).toBe(true)
    expect(scroll!.props.nestedScrollEnabled).toBe(true)
    tree.unmount()
  })

  it('content container 不得带确定宽度：主题 minWidth:"100%" 必须被剥离', () => {
    // 根因 4：minWidth:"100%" 会把 content container 撑成确定宽度。
    const tree = TestRenderer.create(
      <MarkdownCodeBlock text="const x = 1;" containerStyle={THEME_CODE_STYLE} />,
    )
    const ccs = (horizontalScroll(tree)!.props.contentContainerStyle ?? {}) as Record<string, unknown>
    expect(ccs.minWidth).toBeUndefined()
    expect(ccs.width).toBeUndefined()
    tree.unmount()
  })

  it('剥离 minWidth 的同时保留 padding，背景色上移到外层 View（短代码块仍铺满整行）', () => {
    const tree = TestRenderer.create(
      <MarkdownCodeBlock text="const x = 1;" containerStyle={THEME_CODE_STYLE} />,
    )
    const ccs = (horizontalScroll(tree)!.props.contentContainerStyle ?? {}) as Record<string, unknown>
    expect(ccs.padding).toBe(16)
    // 背景色由外层 View 承担（content container 不再需要 minWidth 撑满）
    expect(JSON.stringify(tree.toJSON())).toContain('#123456')
    tree.unmount()
  })

  it('探针必须是「绝对定位 + 固定超宽容器」：否则测量会被可用宽度钳制（根因 5 关键不变量）', () => {
    const tree = makeBlock('const x = 1;')
    const probe = probeText(tree)
    // 探针自身不得被 column 容器拉伸（否则量到的是容器宽度而非文本宽度）
    expect(styleOf(probe).alignSelf).toBe('flex-start')
    // 探针父容器：绝对定位（不参与布局）+ 足够大的显式宽度（保证不折行）+ 不可见
    const parent = probe.parent
    const parentStyle = styleOf(parent as any)
    expect(parentStyle.position).toBe('absolute')
    expect(typeof parentStyle.width).toBe('number')
    expect(parentStyle.width as number).toBeGreaterThanOrEqual(10000)
    expect(parentStyle.opacity).toBe(0)
    tree.unmount()
  })

  it('未测到宽度前，真实 Text 不设显式宽度（避免用被钳制的值锁死布局）', () => {
    const tree = makeBlock('const veryLongLine = "' + 'A'.repeat(200) + '";')
    expect(styleOf(codeText(tree)).width).toBeUndefined()
    tree.unmount()
  })

  it('探针 onTextLayout 后把「最大行宽 + 2」写成真实 Text 的显式 width（根因 5 的核心修复）', () => {
    // 根因 5：Fabric 下 Text 在 AT_MOST 里会撑满可用宽度，content 永远 == 视口宽
    // → 横向滚动量为 0。显式 width（EXACTLY 测量）才能让 content 真正溢出。
    const tree = makeBlock('const veryLongLine = "' + 'A'.repeat(200) + '";')
    fireLayout(tree, [300, 1734.4])
    expect(styleOf(codeText(tree)).width).toBe(1737)
    tree.unmount()
  })

  it('探针 onLayout 通道同样能写入显式 width（双通道容错）', () => {
    const tree = makeBlock('const x = 1;')
    act(() => {
      probeText(tree).props.onLayout({ nativeEvent: { layout: { width: 812.2, height: 24 } } })
    })
    expect(styleOf(codeText(tree)).width).toBe(815)
    tree.unmount()
  })

  it('探针取到容器满宽时忽略（说明拿到的是可用宽度而非固有宽度）', () => {
    const tree = makeBlock('const x = 1;')
    act(() => {
      probeText(tree).props.onLayout({ nativeEvent: { layout: { width: 20000, height: 24 } } })
    })
    expect(styleOf(codeText(tree)).width).toBeUndefined()
    tree.unmount()
  })

  it('行宽重复上报时保持稳定（不抖动 / 不无限 setState）', () => {
    const tree = makeBlock('const x = 1;')
    fireLayout(tree, [500])
    expect(styleOf(codeText(tree)).width).toBe(502)
    fireLayout(tree, [500])
    expect(styleOf(codeText(tree)).width).toBe(502)
    fireLayout(tree, [500])
    expect(styleOf(codeText(tree)).width).toBe(502)
    tree.unmount()
  })

  it('内容超出容器时才显示横向滚动指示条', () => {
    const tree = makeBlock('const veryLongLine = "' + 'A'.repeat(200) + '";')
    const scroll = horizontalScroll(tree)
    act(() => {
      scroll!.props.onContentSizeChange(2000)
      scroll!.props.onLayout({ nativeEvent: { layout: { width: 300 } } })
    })
    tree.update(<MarkdownCodeBlock text={'const veryLongLine = "' + 'A'.repeat(200) + '";'} />)
    expect(horizontalScroll(tree)!.props.showsHorizontalScrollIndicator).toBe(true)
    tree.unmount()
  })

  it('内容未超宽时不显示横向滚动指示条', () => {
    const tree = makeBlock('const x = 1;')
    const scroll = horizontalScroll(tree)
    act(() => {
      scroll!.props.onContentSizeChange(100)
      scroll!.props.onLayout({ nativeEvent: { layout: { width: 300 } } })
    })
    tree.update(<MarkdownCodeBlock text="const x = 1;" />)
    expect(horizontalScroll(tree)!.props.showsHorizontalScrollIndicator).toBe(false)
    tree.unmount()
  })

  it('容器宽度未知时不显示滚动指示条（避免闪条）', () => {
    const tree = makeBlock('const x = 1;')
    expect(horizontalScroll(tree)!.props.showsHorizontalScrollIndicator).toBe(false)
    tree.unmount()
  })

  it('空文本不崩溃', () => {
    const tree = makeBlock('')
    expect(tree.toJSON()).not.toBeNull()
    tree.unmount()
  })

  it('代码文本不可 selectable（Android 文本选择手势会抢横向 pan → 滑动难触发）', () => {
    const tree = makeBlock('const x = 1;')
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
