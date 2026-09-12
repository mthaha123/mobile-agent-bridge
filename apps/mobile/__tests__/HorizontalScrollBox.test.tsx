/**
 * HorizontalScrollBox 测试
 *
 * 横向滚动统一容器：必须带 `horizontal + nestedScrollEnabled`，
 * 否则 Android 上横向拖拽会被父纵向列表吞掉（表现为“只能上下滑”）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, Text } from 'react-native'
import { HorizontalScrollBox } from '../src/components/common/HorizontalScrollBox'

function render(children: React.ReactNode) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => { tree = TestRenderer.create(<HorizontalScrollBox>{children}</HorizontalScrollBox>) })
  return tree
}

describe('HorizontalScrollBox', () => {
  it('renders horizontal + nestedScrollEnabled', () => {
    const tree = render(<Text>hello</Text>)
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.horizontal).toBe(true)
    expect(sv.props.nestedScrollEnabled).toBe(true)
  })

  it('enables directional lock so diagonal gestures do not fall through to the parent list', () => {
    const tree = render(<Text>hello</Text>)
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.directionalLockEnabled).toBe(true)
  })

  it('forwards showsHorizontalScrollIndicator and contentContainerStyle', () => {
    let tree!: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(
        <HorizontalScrollBox showsIndicator={false} contentContainerStyle={{ padding: 4 }}>
          <Text>x</Text>
        </HorizontalScrollBox>,
      )
    })
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.showsHorizontalScrollIndicator).toBe(false)
    expect(sv.props.contentContainerStyle).toEqual({ padding: 4 })
  })

  it('forwards testID', () => {
    let tree!: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(
        <HorizontalScrollBox testID="h-scroll"><Text>x</Text></HorizontalScrollBox>,
      )
    })
    expect(tree.root.findAllByType(ScrollView)[0].props.testID).toBe('h-scroll')
  })
})
