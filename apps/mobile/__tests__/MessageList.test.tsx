import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { MessageList, MessageListProps } from '../src/components/chat/MessageList'
import type { ChatMessage } from '../src/stores/chatStore'

function msg(id: string, content: string, role: ChatMessage['role'] = 'assistant'): ChatMessage {
  return { id, role, content, timestamp: 0, status: 'complete', parts: [] }
}

function buildProps(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [msg('m1', 'Hello'), msg('m2', 'World')],
    renderMessage: (item) => <Text key={item.id}>{item.content}</Text>,
    hasMoreHistory: false,
    historyLoading: false,
    onLoadMoreHistory: jest.fn(),
    onRefresh: jest.fn(),
    refreshing: false,
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

describe('MessageList', () => {
  it('renders every message via renderMessage and displays their content', () => {
    const renderMessage = jest.fn((item: ChatMessage) => <Text key={item.id}>{item.content}</Text>)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ renderMessage })} />)
    })
    expect(renderMessage).toHaveBeenCalledTimes(2)
    expect(renderMessage.mock.calls[0][0].id).toBe('m1')
    expect(renderMessage.mock.calls[1][0].id).toBe('m2')
    expect(textOf(tree)).toContain('Hello')
    expect(textOf(tree)).toContain('World')
  })

  it('renders an empty list safely', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [] })} />)
    })
    expect(flatListNode(tree)).toBeDefined()
  })

  it('refreshing state and onRefresh are wired to the FlatList', () => {
    const onRefresh = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ refreshing: true, onRefresh })} />,
      )
    })
    const list = flatListNode(tree)
    expect(list.props.refreshing).toBe(true)
    act(() => { list.props.onRefresh() })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('passes ListHeader/ListFooter through to the FlatList', () => {
    const header = <Text>header-hint</Text>
    const footer = <Text>footer-spinner</Text>
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ ListHeader: header, ListFooter: footer })} />,
      )
    })
    const list = flatListNode(tree)
    expect(list.props.ListHeaderComponent).toBe(header)
    expect(list.props.ListFooterComponent).toBe(footer)
  })

  it('loads more history when end reached and hasMore && !loading', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, historyLoading: false, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not load more history while historyLoading', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, historyLoading: true, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not load more history when no more history exists', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: false, historyLoading: false, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('renders with inverted prop', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    const list = flatListNode(tree)
    expect(list.props.inverted).toBe(true)
  })
})