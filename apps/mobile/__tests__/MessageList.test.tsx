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

/** mock FlatList 不转发 data prop，改用渲染出的 FlatList-Item 顺序验证展示序 */
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
  it('display data is newest-first (index 0 = newest message)', () => {
    const a = msg('older', NOW - DAY)
    const b = msg('newer', NOW - 1000)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [a, b] })} />)
    })
    // 渲染序 = 展示序：最新消息在首位；每天一个分隔符，最旧日的分隔符在末尾（视觉顶部）
    expect(itemTexts(tree)).toEqual(['newer', '今天', 'older', '昨天'])
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
      tree = TestRenderer.create(
        <MessageList {...buildProps({ messages: [msg('A', NOW - 10), msg('B', NOW - 5)] })} />,
      )
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

  it('keeps inverted prop true', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.inverted).toBe(true)
  })

  it('thinkingIndicator goes to ListHeaderComponent, historyHint to ListFooterComponent', () => {
    const shimmer = <Text>shimmer</Text>
    const hint = <Text>hint</Text>
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ thinkingIndicator: shimmer, historyHint: hint })} />,
      )
    })
    const list = flatListNode(tree)
    expect(list.props.ListHeaderComponent).toBe(shimmer)
    expect(list.props.ListFooterComponent).toBe(hint)
  })

  it('does not expose pull-to-refresh props anymore', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    const list = flatListNode(tree)
    expect(list.props.refreshing).toBeUndefined()
    expect(list.props.onRefresh).toBeUndefined()
  })

  it('loads more history when end reached and hasMore && !loading', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not load more while loading or when exhausted', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, historyLoading: true, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).not.toHaveBeenCalled()

    let tree2!: TestRenderer.ReactTestInstance
    act(() => {
      tree2 = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: false, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree2).props.onEndReached() })
    expect(onLoadMore).not.toHaveBeenCalled() // 两次都被抑制
  })

  it('FAB hidden by default, shown when scrolled >200 away, hides again near bottom', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [msg('A', NOW)] })} />)
    })
    const fabCount = () =>
      tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Scroll to latest').length
    expect(fabCount()).toBe(0)

    const list = flatListNode(tree)
    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 260 } } })
    })
    expect(fabCount()).toBeGreaterThan(0)

    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 30 } } })
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
})
