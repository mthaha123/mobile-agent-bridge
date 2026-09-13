/**
 * ClampBox 测试
 *
 * 限高裁剪容器 —— 刻意不提供滚动（cell 内不得有纵向 ScrollView，
 * 纵向滚动只归列表/Modal 所有）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, Text, View } from 'react-native'
import { ClampBox } from '../src/components/chat/ClampBox'

function render(props: { maxHeight: number; children: React.ReactNode }) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => {
    tree = TestRenderer.create(<ClampBox {...props} />)
  })
  return tree
}

describe('ClampBox', () => {
  it('应用 maxHeight 与 overflow hidden', () => {
    const tree = render({ maxHeight: 120, children: <Text>long</Text> })
    const view = tree.root.findAllByType(View)[0]
    const style = Array.isArray(view.props.style)
      ? Object.assign({}, ...view.props.style)
      : view.props.style
    expect(style.maxHeight).toBe(120)
    expect(style.overflow).toBe('hidden')
  })

  it('不渲染任何 ScrollView（裁剪而非滚动）', () => {
    const tree = render({ maxHeight: 120, children: <Text>long</Text> })
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
  })

  it('渲染 children', () => {
    const tree = render({ maxHeight: 120, children: <Text>inner-content</Text> })
    expect(tree.root.findAllByType(Text).some((t) => t.props.children === 'inner-content')).toBe(true)
  })

  it('合并额外 style（不覆盖裁剪语义）', () => {
    let tree!: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(
        <ClampBox maxHeight={80} style={{ borderTopWidth: 1 }}>
          <Text>x</Text>
        </ClampBox>,
      )
    })
    const view = tree.root.findAllByType(View)[0]
    const style = Array.isArray(view.props.style)
      ? Object.assign({}, ...view.props.style)
      : view.props.style
    expect(style.maxHeight).toBe(80)
    expect(style.overflow).toBe('hidden')
    expect(style.borderTopWidth).toBe(1)
  })
})
