import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { MessageList, MessageListProps } from '../src/components/chat/MessageList'
import type { ChatMessage } from '../src/stores/chatStore'

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

let seq = 0
function msg(content: string, created: number, role: ChatMessage['role'] = 'assistant'): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, content, timestamp: created, status: 'complete', parts: [], created }
}

function buildProps(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [],
    renderMessage: (item) => <Text key={item.id}>{item.content}</Text>,
    hasMoreHistory: false,
    historyLoading: false,
    onLoadMoreHistory: jest.fn(),
    ...over,
  }
}

function flatListNode(tree: TestRenderer.ReactTestInstance) {
  return tree.root.findAll((n: any) => n.type === 'FlatList')[0]
}

function textOf(tree: TestRenderer.ReactTestInstance): string {
  let s = ''
  const walk = (node: any) => {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

/** mock FlatList 渲染出的 FlatList-Item 顺序验证展示序 */
function itemTexts(tree: TestRenderer.ReactTestInstance): string[] {
  const collect = (node: any): string => {
    let s = ''
    if (!node) return s
    if (typeof node === 'string') return node
    if (node.children) node.children.forEach((c: any) => { s += collect(c) })
    return s
  }
  return tree.root
    .findAll((n: any) => n.type === 'FlatList-Item')
    .map(collect)
}

describe('MessageList', () => {
  it('display data is oldest-first (index 0 = oldest message)', () => {
    const a = msg('older', NOW - DAY)
    const b = msg('newer', NOW - 1000)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [a, b] })} />)
    })
    // 正序：最旧在前，最新在后；每天一个分隔符，放在该天第一条消息之前
    expect(itemTexts(tree)).toEqual(['昨天', 'older', '今天', 'newer'])
  })

  it('calls renderMessage once per message, never for separators', () => {
    const renderMessage = jest.fn((item: ChatMessage) => <Text key={item.id}>{item.content}</Text>)
    const a = msg('A', NOW - DAY)
    const b = msg('B', NOW)
    act(() => {
      TestRenderer.create(
        <MessageList {...buildProps({ messages: [a, b], renderMessage })} />,
      )
    })
    expect(renderMessage).toHaveBeenCalledTimes(2)
    expect(renderMessage.mock.calls.every(([m]: any[]) => m.id !== undefined)).toBe(true)
  })

  it('renders date separator labels into the tree', () => {
    const a = msg('A', NOW - DAY)
    const b = msg('B', NOW)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [a, b] })} />)
    })
    expect(textOf(tree)).toContain('今天')
    expect(textOf(tree)).toContain('昨天')
  })

  it('labels even a single same-day group (今天) with no boundary separators', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [msg('A', NOW - 10), msg('B', NOW - 5)] })} />)
    })
    expect(textOf(tree)).toContain('今天')
    expect(textOf(tree)).not.toContain('昨天')
  })

  it('renders empty list safely', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree)).toBeDefined()
  })

  it('does not use inverted', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.inverted).toBeFalsy()
  })

  it('has nestedScrollEnabled so horizontal children can scroll', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.nestedScrollEnabled).toBe(true)
  })

  it('thinkingIndicator goes to ListFooterComponent (visual bottom), historyHint to ListHeaderComponent (visual top)', () => {
    const shimmer = <Text>shimmer</Text>
    const hint = <Text>hint</Text>
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ thinkingIndicator: shimmer, historyHint: hint })} />,
      )
    })
    const list = flatListNode(tree)
    // 正序：header = 视觉顶部（历史提示），footer = 视觉底部（思考指示）
    expect(list.props.ListHeaderComponent).toBe(hint)
    expect(list.props.ListFooterComponent).toBe(shimmer)
  })

  it('does not expose pull-to-refresh props', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    const list = flatListNode(tree)
    expect(list.props.refreshing).toBeUndefined()
    expect(list.props.onRefresh).toBeUndefined()
  })

  it('does not use onEndReached (history loaded via onScroll)', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    const list = flatListNode(tree)
    // 正序列表不用 onEndReached 触发历史加载，改由 onScroll 顶部检测
    expect(list.props.onEndReached).toBeUndefined()
  })

  it('FAB hidden by default, shown when scrolled >200 from bottom, hides again near bottom', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [msg('A', NOW)] })} />)
    })
    const fabCount = () =>
      tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Scroll to latest').length
    expect(fabCount()).toBe(0)

    const list = flatListNode(tree)
    // 模拟距底部 >200（内容高度 500, 可见 300, offset.y = 50 → distFromBottom = 150 → 不够）
    // distFromBottom = contentSize.height - layoutMeasurement.height - offset.y
    // 要 distFromBottom > 200: 500 - 300 - y > 200 → y < 0 不可能
    // 改为大内容：contentSize=800, layout=300, y=200 → dist=300 > 200 → 显示
    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 200 }, layoutMeasurement: { height: 300 }, contentSize: { height: 800 } } })
    })
    expect(fabCount()).toBeGreaterThan(0)

    // 回到底部附近：contentSize=800, layout=300, y=550 → dist=−50 ≤ 24 → 隐藏
    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 550 }, layoutMeasurement: { height: 300 }, contentSize: { height: 800 } } })
    })
    expect(fabCount()).toBe(0)
  })

  it('maintainVisibleContentPosition configured', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
  })

  it('wires onContentSizeChange so streaming text growth follows the bottom', () => {
    // 去 inverted 后不再天然贴底：流式条数不变、仅内容变高，
    // 必须由 onContentSizeChange → scrollToEndIfPinned 兜住跟随。
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(typeof flatListNode(tree).props.onContentSizeChange).toBe('function')
  })
})
